"""Biên dịch SemanticQuery → SQL Trino (US27) và hậu xử lý kết quả.

- Metric và dimension lấy từ registry (semantic_metrics, semantic_dimensions); không nhận SQL tự do.
- Dimension "dùng chung": cột của dimension phải có trong dataset gốc của metric (VD faculty_code).
- Bộ lọc phạm vi đơn vị và chính sách dòng/cột được thêm vào WHERE (BR08, BR11).
- Ô có nhóm < ngưỡng (mặc định 5) bị ẩn thành {"suppressed": true} (BR12).
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import forbidden, unprocessable
from app.core.security import Principal
from app.domain.enums import MetricStatus, Sensitivity
from app.domain.models import Dataset, SemanticDimension, SemanticMetric
from app.policy.engine import active_rules, compile_policy
from app.query.gateway import LakehouseGateway, quote_ident, require, table_ref
from app.schemas.common import Filter, QueryColumn, QueryResult, SemanticQuery
from app.services.access import dataset_accessible, metric_queryable
from app.services.catalog import is_stale

GROUP_SIZE = "_group_size"
# Cột đếm số người trong mart tổng hợp; không có thì đếm số dòng.
GROUP_SIZE_COLUMNS = ("n_students", "n_persons", "n_staff", "headcount")


@dataclass
class CompiledQuery:
    sql: str
    params: list[Any]
    columns: list[QueryColumn]
    dataset: Dataset
    metrics: list[SemanticMetric]
    filters: list[Filter] = field(default_factory=list)


def _metric_by_code(db: Session, codes: list[str]) -> list[SemanticMetric]:
    found = {m.code: m for m in db.scalars(select(SemanticMetric).where(SemanticMetric.code.in_(codes))).all()}
    missing = [c for c in codes if c not in found]
    if missing:
        raise unprocessable("Metric không tồn tại", [{"field": "metrics", "message": c} for c in missing], type_="unknown-metric")
    return [found[c] for c in codes]


def dimension_columns(db: Session, dataset: Dataset) -> dict[str, tuple[SemanticDimension, Sensitivity]]:
    """Dimension dùng được trên dataset: mã → (dimension, mức nhạy cảm của cột)."""
    columns = {c.name: c.sensitivity for c in dataset.columns}
    out = {}
    for dim in db.scalars(select(SemanticDimension)).all():
        if dim.column_name in columns:
            out[dim.code] = (dim, columns[dim.column_name])
    return out


def compile_query(
    db: Session,
    principal: Principal,
    query: SemanticQuery,
    scope: set[str] | None,
    *,
    require_certified: bool = False,
    adhoc_metric: SemanticMetric | None = None,
) -> CompiledQuery:
    metrics = [adhoc_metric] if adhoc_metric else _metric_by_code(db, list(dict.fromkeys(query.metrics)))
    for metric in metrics:
        if require_certified and metric.status != MetricStatus.CERTIFIED:
            raise unprocessable(f"Metric {metric.code} chưa được chứng nhận", type_="metric-not-certified")
        if adhoc_metric is None and not metric_queryable(principal, metric):
            raise forbidden(f"Không có quyền dùng metric {metric.code}")
    base_ids = {m.base_dataset_id for m in metrics}
    if len(base_ids) != 1:
        raise unprocessable("Các metric trong một truy vấn phải cùng dataset gốc", type_="mixed-datasets")
    dataset = db.get(Dataset, base_ids.pop())
    available = dimension_columns(db, dataset)
    has_grant = dataset_accessible(db, principal, dataset)

    dims: list[SemanticDimension] = []
    for code in dict.fromkeys(query.dimensions):
        if code not in available:
            raise unprocessable(f"Dimension {code} không dùng được với metric đã chọn", type_="unknown-dimension")
        for metric in metrics:
            if metric.allowed_dimensions and code not in metric.allowed_dimensions:
                raise unprocessable(f"Metric {metric.code} không cho phép phân tích theo {code}", type_="dimension-not-allowed")
        dim, sensitivity = available[code]
        if sensitivity == Sensitivity.RESTRICTED or (sensitivity == Sensitivity.CONFIDENTIAL and not has_grant):
            raise forbidden(f"Không có quyền phân tích theo {code} (dữ liệu {sensitivity.value})")
        dims.append(dim)

    alias = "t"
    versions = [(v.row_filter, v.column_rules) for v in active_rules(db, dataset.id, principal)]
    policy = compile_policy(dataset, principal, scope, versions, alias=alias)
    where, params = list(policy.where), list(policy.params)
    for flt in query.filters:
        if flt.dimension not in available:
            raise unprocessable(f"Không lọc được theo {flt.dimension}", type_="unknown-dimension")
        clause, args = _filter_sql(f"{alias}.{quote_ident(available[flt.dimension][0].column_name)}", flt)
        where.append(clause)
        params += args

    columns = [quote_ident(c.name) for c in dataset.columns]
    group_col = next((c for c in GROUP_SIZE_COLUMNS if quote_ident(c) in columns), None)
    select_parts = [f"{alias}.{quote_ident(d.column_name)} AS {quote_ident(d.code)}" for d in dims]
    select_parts += [f"({m.expression}) AS {quote_ident(m.code)}" for m in metrics]
    select_parts.append(f"{f'sum({alias}.{quote_ident(group_col)})' if group_col else 'count(*)'} AS {GROUP_SIZE}")
    sql = f"SELECT {', '.join(select_parts)} FROM {table_ref(dataset.schema_name, dataset.table_name)} {alias}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    if dims:
        sql += " GROUP BY " + ", ".join(str(i + 1) for i in range(len(dims)))
    output_names = [d.code for d in dims] + [m.code for m in metrics]
    order = []
    for item in query.order_by:
        if item.field not in output_names:
            raise unprocessable(f"Không sắp xếp được theo {item.field}", type_="invalid-order")
        order.append(f"{quote_ident(item.field)} {'DESC' if item.direction == 'desc' else 'ASC'}")
    if order:
        sql += " ORDER BY " + ", ".join(order)
    sql += f" LIMIT {int(query.limit)}"

    out_columns = [QueryColumn(name=d.code, kind="DIMENSION") for d in dims]
    out_columns += [QueryColumn(name=m.code, kind="METRIC", unit=m.unit) for m in metrics]
    return CompiledQuery(sql, params, out_columns, dataset, metrics, list(query.filters))


def _filter_sql(column: str, flt: Filter) -> tuple[str, list[Any]]:
    match flt.op:
        case "eq":
            return f"{column} = ?", [flt.value]
        case "neq":
            return f"{column} <> ?", [flt.value]
        case "gte":
            return f"{column} >= ?", [flt.value]
        case "lte":
            return f"{column} <= ?", [flt.value]
        case "in":
            values = flt.values if flt.values is not None else (flt.value if isinstance(flt.value, list) else [flt.value])
            if not values:
                return "1 = 0", []
            return f"{column} IN ({', '.join('?' for _ in values)})", list(values)
        case "between":
            values = flt.values or (flt.value if isinstance(flt.value, list) else None)
            if not values or len(values) != 2:
                raise unprocessable(f"Bộ lọc between trên {flt.dimension} cần đúng 2 giá trị", type_="invalid-filter")
            return f"{column} BETWEEN ? AND ?", list(values)
    raise unprocessable("Toán tử lọc không hỗ trợ", type_="invalid-filter")


def execute(gateway: LakehouseGateway | None, principal: Principal, compiled: CompiledQuery) -> QueryResult:
    output = require(gateway).execute(compiled.sql, compiled.params, principal.email)
    threshold = settings.suppression_threshold
    n_dims = sum(1 for c in compiled.columns if c.kind == "DIMENSION")
    suppressed = 0
    rows: list[list[Any]] = []
    for raw in output.rows:
        group_size = raw[-1]
        values = list(raw[:-1])
        if group_size is not None and group_size < threshold:
            for i in range(n_dims, len(values)):
                values[i] = {"suppressed": True}
                suppressed += 1
        rows.append([_json_value(v) for v in values])
    dataset = compiled.dataset
    return QueryResult(
        columns=compiled.columns,
        rows=rows,
        data_as_of=dataset.last_updated_at,
        stale=is_stale(dataset),
        suppressed_cells=suppressed,
    )


def _json_value(value: Any) -> Any:
    from decimal import Decimal

    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value
