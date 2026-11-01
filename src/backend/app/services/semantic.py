"""Semantic model: truy vấn ngữ nghĩa, metric có phiên bản (US36, BR19), chứng nhận, dimension."""

from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.errors import ProblemError, conflict, forbidden, not_found, unprocessable
from app.core.security import Principal
from app.domain.enums import MetricStatus, RoleCode
from app.domain.models import (
    DashboardWidget,
    Dataset,
    GlossaryTerm,
    SemanticDimension,
    SemanticMetric,
    SemanticMetricVersion,
)
from app.query.gateway import LakehouseGateway
from app.schemas.bi import DimensionOut, MetricDetail, MetricInput, MetricOut, MetricValidation, MetricVersionOut
from app.schemas.common import QueryResult, SemanticQuery, UserRef
from app.semantic import compiler
from app.semantic.validator import validate_expression
from app.services.access import DASHBOARD_ROLES, data_scope


def run_query(db: Session, gateway: LakehouseGateway | None, principal: Principal, query: SemanticQuery) -> QueryResult:
    scope = data_scope(db, principal, DASHBOARD_ROLES)
    compiled = compiler.compile_query(db, principal, query, scope)
    return compiler.execute(gateway, principal, compiled)


def metric_out(m: SemanticMetric) -> MetricOut:
    return MetricOut(
        id=m.id,
        code=m.code,
        name=m.name,
        definition=m.definition,
        expression=m.expression,
        base_dataset_id=m.base_dataset_id,
        allowed_dimensions=m.allowed_dimensions,
        unit=m.unit,
        glossary_term_id=m.glossary_term_id,
        status=m.status,
        version=m.version,
        owner=UserRef.of(m.owner),
        certified_by=UserRef.of(m.certifier),
        certified_at=m.certified_at,
    )


def list_metrics(db: Session, principal: Principal, q: str | None, status: MetricStatus | None) -> list[MetricOut]:
    stmt = select(SemanticMetric)
    if not principal.has_role(RoleCode.BI_ANALYST, RoleCode.DATA_STEWARD):
        # Người dùng khác chỉ thấy metric đã chứng nhận và metric của mình.
        stmt = stmt.where(or_(SemanticMetric.status == MetricStatus.CERTIFIED, SemanticMetric.owner_id == principal.id))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(SemanticMetric.code.ilike(like), SemanticMetric.name.ilike(like), SemanticMetric.definition.ilike(like)))
    if status:
        stmt = stmt.where(SemanticMetric.status == status)
    return [metric_out(m) for m in db.scalars(stmt.order_by(SemanticMetric.code)).all()]


def _get_metric(db: Session, code: str) -> SemanticMetric:
    metric = db.scalar(select(SemanticMetric).where(SemanticMetric.code == code))
    if metric is None:
        raise not_found()
    return metric


def _validate_metric(db: Session, body: MetricInput) -> tuple[Dataset | None, list[str]]:
    dataset = db.get(Dataset, body.base_dataset_id)
    if dataset is None:
        return None, ["Dataset gốc không tồn tại"]
    errors = validate_expression(body.expression, {c.name for c in dataset.columns}, allow_aggregates=True)
    available = set(compiler.dimension_columns(db, dataset))
    errors += [f"Dimension không dùng được với dataset gốc: {d}" for d in body.allowed_dimensions if d not in available]
    if body.glossary_term_id is not None and db.get(GlossaryTerm, body.glossary_term_id) is None:
        errors.append("Thuật ngữ glossary không tồn tại")
    return dataset, errors


def get_metric(db: Session, principal: Principal, code: str) -> MetricDetail:
    metric = _get_metric(db, code)
    if metric.status != MetricStatus.CERTIFIED and not (
        metric.owner_id == principal.id or principal.has_role(RoleCode.BI_ANALYST, RoleCode.DATA_STEWARD)
    ):
        raise not_found()
    versions = db.scalars(
        select(SemanticMetricVersion)
        .where(SemanticMetricVersion.metric_id == metric.id)
        .order_by(SemanticMetricVersion.version.desc())
    ).all()
    used = {
        dashboard_id
        for dashboard_id, spec in db.execute(select(DashboardWidget.dashboard_id, DashboardWidget.query_spec)).all()
        if code in (spec or {}).get("metrics", [])
    }
    return MetricDetail(
        **metric_out(metric).model_dump(),
        versions=[
            MetricVersionOut(version=v.version, expression=v.expression, changed_by=UserRef.of(v.changer), changed_at=v.changed_at)
            for v in versions
        ],
        used_by_dashboards=len(used),
    )


def create_metric(db: Session, principal: Principal, body: MetricInput) -> MetricOut:
    if db.scalar(select(SemanticMetric.id).where(SemanticMetric.code == body.code)):
        raise conflict(f"Metric {body.code} đã tồn tại", type_="duplicate")
    _, errors = _validate_metric(db, body)
    if errors:
        raise unprocessable("Metric không hợp lệ", [{"field": "expression", "message": e} for e in errors], type_="invalid-metric")
    metric = SemanticMetric(**body.model_dump(), owner_id=principal.id, status=MetricStatus.DRAFT, version=1)
    db.add(metric)
    db.flush()
    db.add(SemanticMetricVersion(metric_id=metric.id, version=1, expression=metric.expression, definition=metric.definition, changed_by=principal.id))
    audit(db, principal, "METRIC_CREATE", "METRIC", metric.code, {"version": 1})
    db.commit()
    db.refresh(metric)
    return metric_out(metric)


def update_metric(db: Session, principal: Principal, code: str, body: MetricInput) -> MetricOut:
    metric = _get_metric(db, code)
    if body.code != code:
        raise unprocessable("Không đổi được mã metric", [{"field": "code", "message": "Phải trùng mã trên đường dẫn"}])
    if metric.owner_id != principal.id:
        raise forbidden("Chỉ người định nghĩa metric được sửa")
    _, errors = _validate_metric(db, body)
    if errors:
        raise unprocessable("Metric không hợp lệ", [{"field": "expression", "message": e} for e in errors], type_="invalid-metric")
    for field, value in body.model_dump(exclude={"code"}).items():
        setattr(metric, field, value)
    # BR19: mỗi lần sửa là một phiên bản; metric đã chứng nhận quay về DRAFT để chứng nhận lại.
    metric.version += 1
    if metric.status == MetricStatus.CERTIFIED:
        metric.status, metric.certified_by, metric.certified_at = MetricStatus.DRAFT, None, None
    db.add(
        SemanticMetricVersion(
            metric_id=metric.id, version=metric.version, expression=metric.expression, definition=metric.definition, changed_by=principal.id
        )
    )
    audit(db, principal, "METRIC_UPDATE", "METRIC", metric.code, {"version": metric.version})
    db.commit()
    db.refresh(metric)
    return metric_out(metric)


def certify(db: Session, principal: Principal, code: str, status: str) -> MetricOut:
    metric = _get_metric(db, code)
    target = MetricStatus(status)
    if metric.owner_id == principal.id:
        raise forbidden("Không tự chứng nhận metric do mình định nghĩa")
    if target == MetricStatus.CERTIFIED:
        if metric.status != MetricStatus.DRAFT:
            raise conflict(f"Chỉ chứng nhận được metric DRAFT (hiện {metric.status.value})", type_="invalid-transition")
        metric.status, metric.certified_by, metric.certified_at = target, principal.id, datetime.now(UTC)
    else:
        if metric.status == MetricStatus.DEPRECATED:
            raise conflict("Metric đã ngừng dùng", type_="invalid-transition")
        metric.status = target
    audit(db, principal, "METRIC_" + target.value, "METRIC", metric.code, {"version": metric.version})
    db.commit()
    db.refresh(metric)
    return metric_out(metric)


def validate_metric(db: Session, gateway: LakehouseGateway | None, principal: Principal, body: MetricInput) -> MetricValidation:
    dataset, errors = _validate_metric(db, body)
    if errors or gateway is None:
        return MetricValidation(valid=not errors, errors=errors, preview=None)
    adhoc = SemanticMetric(
        code=body.code, name=body.name, definition=body.definition, expression=body.expression,
        base_dataset_id=dataset.id, allowed_dimensions=body.allowed_dimensions, unit=body.unit,
        owner_id=principal.id, status=MetricStatus.DRAFT, version=0,
    )  # fmt: skip
    query = SemanticQuery(metrics=[body.code], limit=1)
    compiled = compiler.compile_query(db, principal, query, data_scope(db, principal, DASHBOARD_ROLES), adhoc_metric=adhoc)
    try:
        preview = compiler.execute(gateway, principal, compiled)
    except ProblemError as exc:
        # Lỗi cú pháp/kiểu do Trino báo được trả như lỗi kiểm tra công thức.
        return MetricValidation(valid=False, errors=[exc.detail or exc.title], preview=None)
    return MetricValidation(valid=True, errors=[], preview=preview)


def list_dimensions(db: Session) -> list[DimensionOut]:
    dims = db.scalars(select(SemanticDimension).order_by(SemanticDimension.code)).all()
    return [DimensionOut(code=d.code, name=d.name, description=d.description) for d in dims]
