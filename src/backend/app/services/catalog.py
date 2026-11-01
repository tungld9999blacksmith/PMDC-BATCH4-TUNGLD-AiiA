"""Catalog: dataset, cột, phân loại nhạy cảm (US22), glossary, xem trước có che (US09, AC09)."""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.errors import bad_request, conflict, not_found
from app.core.pagination import PageParams, paginate
from app.core.security import Principal
from app.domain.enums import DataLayer, Sensitivity
from app.domain.models import (
    Dashboard,
    DashboardWidget,
    DataSource,
    Dataset,
    DatasetColumn,
    GlossaryTerm,
    SemanticMetric,
)
from app.policy.engine import CompiledPolicy, active_rules, apply_column_action, compile_policy
from app.query.gateway import LakehouseGateway, require, table_ref
from app.schemas.catalog import (
    DatasetColumnOut,
    DatasetColumnPatch,
    DatasetDetail,
    DatasetOut,
    GlossaryTermInput,
    GlossaryTermOut,
    UsedBy,
)
from app.schemas.common import Freshness, TabularColumn, TabularResult, UserRef
from app.services.access import accessible_dataset_ids, column_visible, data_scope, dataset_accessible, mask_value


def is_stale(dataset: Dataset, at: datetime | None = None) -> bool:
    if dataset.freshness_sla_minutes is None:
        return False
    if dataset.last_updated_at is None:
        return True
    return dataset.last_updated_at < (at or datetime.now(UTC)) - timedelta(minutes=dataset.freshness_sla_minutes)


def freshness(dataset: Dataset) -> Freshness:
    return Freshness(
        sources=[dataset.source.code.removeprefix("SRC-")] if dataset.source else [],
        updated_at=dataset.last_updated_at,
        stale=is_stale(dataset),
        dq_score=float(dataset.dq_score) if dataset.dq_score is not None else None,
    )


def term_out(term: GlossaryTerm | None) -> GlossaryTermOut | None:
    if term is None:
        return None
    return GlossaryTermOut(id=term.id, name=term.name, definition=term.definition, owner=UserRef.of(term.owner))


def column_out(col: DatasetColumn) -> DatasetColumnOut:
    return DatasetColumnOut(
        id=col.id,
        name=col.name,
        data_type=col.data_type,
        description=col.description,
        sensitivity=col.sensitivity,
        glossary_term=term_out(col.glossary_term),
    )


def dataset_out(dataset: Dataset, accessible: bool) -> DatasetOut:
    return DatasetOut(
        id=dataset.id,
        layer=dataset.layer,
        schema_name=dataset.schema_name,
        table_name=dataset.table_name,
        display_name=dataset.display_name,
        description=dataset.description,
        owner=UserRef.of(dataset.owner),
        steward=UserRef.of(dataset.steward),
        tags=dataset.tags,
        freshness=freshness(dataset),
        accessible=accessible,
    )


def search_datasets(
    db: Session,
    principal: Principal,
    *,
    q: str | None,
    layer: DataLayer | None,
    source_id: int | None,
    tag: str | None,
    sensitivity: Sensitivity | None,
    accessible: bool | None,
    params: PageParams,
):
    # US21: metadata hiển thị cho mọi người dùng, kể cả khi chưa có quyền dữ liệu.
    stmt = select(Dataset)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Dataset.display_name.ilike(like),
                Dataset.table_name.ilike(like),
                Dataset.description.ilike(like),
                Dataset.id.in_(select(DatasetColumn.dataset_id).where(DatasetColumn.name.ilike(like))),
            )
        )
    if layer:
        stmt = stmt.where(Dataset.layer == layer)
    if source_id:
        stmt = stmt.where(Dataset.source_id == source_id)
    if tag:
        stmt = stmt.where(Dataset.tags.any(tag))
    if sensitivity:
        stmt = stmt.where(Dataset.id.in_(select(DatasetColumn.dataset_id).where(DatasetColumn.sensitivity == sensitivity)))
    mine = accessible_dataset_ids(db, principal)
    if accessible is True:
        stmt = stmt.where(Dataset.id.in_(mine or {-1}))
    elif accessible is False:
        stmt = stmt.where(Dataset.id.not_in(mine or {-1}))
    items, total = paginate(db, stmt.order_by(Dataset.layer, Dataset.display_name), params)
    return [dataset_out(d, d.id in mine) for d in items], total


def get_dataset_or_404(db: Session, dataset_id: int) -> Dataset:
    dataset = db.get(Dataset, dataset_id)
    if dataset is None:
        raise not_found()
    return dataset


def get_dataset(db: Session, principal: Principal, dataset_id: int) -> DatasetDetail:
    from app.services.dashboards import dashboard_summaries

    dataset = get_dataset_or_404(db, dataset_id)
    metrics = db.scalars(select(SemanticMetric).where(SemanticMetric.base_dataset_id == dataset.id)).all()
    codes = {m.code for m in metrics}
    dashboards: list[Dashboard] = []
    if codes:
        widget_rows = db.execute(select(DashboardWidget.dashboard_id, DashboardWidget.query_spec)).all()
        ids = {d for d, spec in widget_rows if codes & set((spec or {}).get("metrics", []))}
        if ids:
            dashboards = list(db.scalars(select(Dashboard).where(Dashboard.id.in_(ids))).all())
    audit(db, principal, "DATASET_VIEW", "DATASET", dataset.id, {"title": dataset.display_name})
    db.commit()
    base = dataset_out(dataset, dataset_accessible(db, principal, dataset))
    return DatasetDetail(
        **base.model_dump(),
        columns=[column_out(c) for c in dataset.columns],
        row_count=dataset.row_count,
        freshness_sla_minutes=dataset.freshness_sla_minutes,
        used_by=UsedBy(dashboards=dashboard_summaries(db, principal, dashboards, visible_only=True), metrics=sorted(codes)),
    )


def update_column(db: Session, principal: Principal, dataset_id: int, column_id: int, body: DatasetColumnPatch) -> DatasetColumnOut:
    column = db.get(DatasetColumn, column_id)
    if column is None or column.dataset_id != dataset_id:
        raise not_found()
    data = body.model_dump(exclude_unset=True)
    before = {"sensitivity": column.sensitivity.value, "glossaryTermId": column.glossary_term_id}
    if "glossary_term_id" in data and data["glossary_term_id"] is not None and db.get(GlossaryTerm, data["glossary_term_id"]) is None:
        raise not_found("Thuật ngữ không tồn tại")
    for field, value in data.items():
        if field == "sensitivity" and value is None:
            continue
        setattr(column, field, value)
    audit(
        db,
        principal,
        "COLUMN_CLASSIFY",
        "DATASET",
        dataset_id,
        {"column": column.name, "before": before, "after": {k: str(v) for k, v in data.items()}},
    )
    db.commit()
    db.refresh(column)
    return column_out(column)


# ───────────────────────── Glossary ─────────────────────────
def list_terms(db: Session, q: str | None) -> list[GlossaryTermOut]:
    stmt = select(GlossaryTerm)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(GlossaryTerm.name.ilike(like), GlossaryTerm.definition.ilike(like)))
    return [term_out(t) for t in db.scalars(stmt.order_by(GlossaryTerm.name)).all()]


def create_term(db: Session, principal: Principal, body: GlossaryTermInput) -> GlossaryTermOut:
    if db.scalar(select(GlossaryTerm.id).where(func.lower(GlossaryTerm.name) == body.name.lower())):
        raise conflict("Thuật ngữ đã tồn tại", type_="duplicate")
    term = GlossaryTerm(name=body.name, definition=body.definition, owner_user_id=principal.id)
    db.add(term)
    db.flush()
    audit(db, principal, "GLOSSARY_CREATE", "GLOSSARY_TERM", term.id, {"name": term.name})
    db.commit()
    db.refresh(term)
    return term_out(term)


def update_term(db: Session, principal: Principal, term_id: int, body: GlossaryTermInput) -> GlossaryTermOut:
    term = db.get(GlossaryTerm, term_id)
    if term is None:
        raise not_found()
    clash = db.scalar(
        select(GlossaryTerm.id).where(func.lower(GlossaryTerm.name) == body.name.lower(), GlossaryTerm.id != term.id)
    )
    if clash:
        raise conflict("Thuật ngữ đã tồn tại", type_="duplicate")
    term.name, term.definition = body.name, body.definition
    audit(db, principal, "GLOSSARY_UPDATE", "GLOSSARY_TERM", term.id, {"name": term.name})
    db.commit()
    db.refresh(term)
    return term_out(term)


# ───────────────────────── Đọc dữ liệu có che ─────────────────────────
def masked_rows(
    db: Session,
    gateway: LakehouseGateway | None,
    principal: Principal,
    dataset: Dataset,
    *,
    limit: int,
    has_grant: bool,
    policy: CompiledPolicy,
    extra_where: list[str] | None = None,
    extra_params: list[Any] | None = None,
    snapshot_id: str | None = None,
    as_user: str | None = None,
) -> tuple[TabularResult, int]:
    """Đọc tối đa `limit` dòng: chỉ cột đã có trong catalog, che theo mức nhạy cảm và chính sách cột."""
    gateway = require(gateway)
    columns = [c for c in dataset.columns if policy.column_actions.get(c.name) != "DENY"]
    if not columns:
        return TabularResult(), 0
    select_list = ", ".join(f'"{c.name}"' for c in columns)
    source = table_ref(dataset.schema_name, dataset.table_name)
    if snapshot_id:
        if not snapshot_id.isdigit():
            raise bad_request("snapshotId phải là số", [{"field": "snapshotId", "message": "Sai định dạng"}])
        source += f" FOR VERSION AS OF {int(snapshot_id)}"
    where = policy.where + (extra_where or [])
    params = policy.params + (extra_params or [])
    sql = f"SELECT {select_list} FROM {source}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += f" LIMIT {int(limit)}"
    output = gateway.execute(sql, params, as_user or principal.email)

    visible = [column_visible(c.sensitivity, has_grant) for c in columns]
    actions = [policy.column_actions.get(c.name) for c in columns]
    result_rows = []
    for row in output.rows:
        out_row = []
        for value, show, action in zip(row, visible, actions, strict=False):
            if not show:
                out_row.append(mask_value(value))
                continue
            value, _ = apply_column_action(action, value)
            out_row.append(value.isoformat() if isinstance(value, datetime) else value)
        result_rows.append(out_row)
    tab_columns = [
        TabularColumn(name=c.name, type=c.data_type, masked=not show or action is not None)
        for c, show, action in zip(columns, visible, actions, strict=False)
    ]
    return TabularResult(columns=tab_columns, rows=result_rows), len(result_rows)


def preview_dataset(
    db: Session,
    gateway: LakehouseGateway | None,
    principal: Principal,
    dataset_id: int,
    limit: int,
    snapshot_id: str | None,
    batch_id: int | None,
) -> TabularResult:
    dataset = get_dataset_or_404(db, dataset_id)
    scope = data_scope(db, principal, tuple(r.role for r in principal.roles))
    versions = [(v.row_filter, v.column_rules) for v in active_rules(db, dataset.id, principal)]
    policy = compile_policy(dataset, principal, scope, versions)
    extra_where, extra_params = [], []
    if batch_id is not None:
        if "_batch_id" not in {c.name for c in dataset.columns} and dataset.layer != DataLayer.BRONZE:
            raise bad_request("Dataset không lưu batch_id", [{"field": "batchId", "message": "Chỉ dùng với Bronze"}])
        extra_where.append('"_batch_id" = ?')
        extra_params.append(batch_id)
    result, rows = masked_rows(
        db,
        gateway,
        principal,
        dataset,
        limit=limit,
        has_grant=dataset_accessible(db, principal, dataset),
        policy=policy,
        extra_where=extra_where,
        extra_params=extra_params,
        snapshot_id=snapshot_id,
    )
    audit(db, principal, "DATASET_PREVIEW", "DATASET", dataset.id, {"rows": rows, "snapshotId": snapshot_id, "batchId": batch_id})
    db.commit()
    return result


def source_code(db: Session, source_id: int | None) -> str | None:
    if source_id is None:
        return None
    return db.scalar(select(DataSource.code).where(DataSource.id == source_id))
