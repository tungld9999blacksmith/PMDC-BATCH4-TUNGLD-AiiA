"""Dashboard (US26, US28, US30): thư viện theo quyền xem, thiết kế có khóa lạc quan, publish, chia sẻ."""

import uuid
from collections.abc import Iterable

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.errors import ProblemError, conflict, forbidden, not_found, unprocessable
from app.core.security import Principal
from app.domain.enums import DashboardStatus, PrincipalType, RoleCode
from app.domain.models import (
    Dashboard,
    DashboardFavorite,
    DashboardShare,
    DashboardWidget,
    Dataset,
    SemanticDimension,
    SemanticMetric,
    User,
)
from app.schemas.bi import DashboardInput, DashboardOut, DashboardSummary, Share, Widget
from app.schemas.common import Freshness, UserRef
from app.services.access import dashboard_visible, now, org_unit_by_code
from app.services.catalog import is_stale


def _freshness(db: Session, dashboards: Iterable[Dashboard]) -> dict[int, Freshness]:
    dashboards = list(dashboards)
    codes = {c for d in dashboards for w in d.widgets for c in (w.query_spec or {}).get("metrics", [])}
    datasets: dict[str, Dataset] = {}
    if codes:
        for metric in db.scalars(select(SemanticMetric).where(SemanticMetric.code.in_(codes))).all():
            datasets[metric.code] = metric.base_dataset
    out = {}
    for d in dashboards:
        used = {datasets[c].id: datasets[c] for w in d.widgets for c in (w.query_spec or {}).get("metrics", []) if c in datasets}
        if not used:
            out[d.id] = Freshness()
            continue
        times = [ds.last_updated_at for ds in used.values() if ds.last_updated_at]
        scores = [float(ds.dq_score) for ds in used.values() if ds.dq_score is not None]
        out[d.id] = Freshness(
            sources=sorted({ds.source.code.removeprefix("SRC-") for ds in used.values() if ds.source}),
            updated_at=min(times) if times else None,
            stale=any(is_stale(ds) for ds in used.values()),
            dq_score=min(scores) if scores else None,
        )
    return out


def _favorites(db: Session, principal: Principal) -> set[int]:
    return set(db.scalars(select(DashboardFavorite.dashboard_id).where(DashboardFavorite.user_id == principal.id)))


def dashboard_summaries(
    db: Session, principal: Principal, dashboards: list[Dashboard], *, visible_only: bool = False
) -> list[DashboardSummary]:
    if visible_only:
        dashboards = [d for d in dashboards if dashboard_visible(db, principal, d)]
    fresh, favs = _freshness(db, dashboards), _favorites(db, principal)
    return [
        DashboardSummary(
            id=d.id,
            title=d.title,
            description=d.description,
            topic=d.topic,
            status=d.status,
            owner=UserRef.of(d.owner),
            favorite=d.id in favs,
            freshness=fresh[d.id],
        )
        for d in dashboards
    ]


def _widget_out(w: DashboardWidget) -> Widget:
    return Widget(id=w.id, type=w.type, title=w.title, query_spec=w.query_spec, position=w.position)


def dashboard_out(db: Session, principal: Principal, d: Dashboard) -> DashboardOut:
    summary = dashboard_summaries(db, principal, [d])[0]
    return DashboardOut(
        **summary.model_dump(),
        global_filters=list(d.global_filters or []),
        widgets=[_widget_out(w) for w in d.widgets],
        version=d.version,
        shares=[Share(principal_type=s.principal_type, principal_id=s.principal_id) for s in d.shares],
        can_edit=d.owner_id == principal.id and principal.has_role(RoleCode.BI_ANALYST) and d.status != DashboardStatus.ARCHIVED,
    )


def list_dashboards(
    db: Session, principal: Principal, q: str | None, topic: str | None, favorite: bool | None, mine: bool | None
) -> list[DashboardSummary]:
    condition = Dashboard.status == DashboardStatus.PUBLISHED
    if mine:
        condition = or_(condition, and_(Dashboard.owner_id == principal.id, Dashboard.status == DashboardStatus.DRAFT))
    stmt = select(Dashboard).where(condition)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Dashboard.title.ilike(like), Dashboard.description.ilike(like)))
    if topic:
        stmt = stmt.where(Dashboard.topic == topic)
    if favorite:
        stmt = stmt.where(Dashboard.id.in_(select(DashboardFavorite.dashboard_id).where(DashboardFavorite.user_id == principal.id)))
    dashboards = [d for d in db.scalars(stmt.order_by(Dashboard.title)).all() if dashboard_visible(db, principal, d)]
    return dashboard_summaries(db, principal, dashboards)


def get_visible(db: Session, principal: Principal, dashboard_id: int) -> Dashboard:
    dashboard = db.get(Dashboard, dashboard_id)
    # AC11: dashboard ngoài quyền xem trả 404 như không tồn tại.
    if dashboard is None or not dashboard_visible(db, principal, dashboard):
        raise not_found()
    return dashboard


def get_owned(db: Session, principal: Principal, dashboard_id: int) -> Dashboard:
    dashboard = get_visible(db, principal, dashboard_id)
    if dashboard.owner_id != principal.id:
        raise forbidden("Chỉ người tạo được sửa dashboard")
    if dashboard.status == DashboardStatus.ARCHIVED:
        raise conflict("Dashboard đã lưu trữ")
    return dashboard


def get_dashboard(db: Session, principal: Principal, dashboard_id: int) -> DashboardOut:
    dashboard = get_visible(db, principal, dashboard_id)
    audit(db, principal, "DASHBOARD_VIEW", "DASHBOARD", dashboard.id, {"title": dashboard.title})
    db.commit()
    return dashboard_out(db, principal, dashboard)


def _validate_widgets(db: Session, body: DashboardInput) -> None:
    metric_codes = {c for w in body.widgets for c in w.query_spec.metrics}
    dim_codes = {c for w in body.widgets for c in [*w.query_spec.dimensions, *w.query_spec.drill_path]}
    dim_codes |= set(body.global_filters) | {f.dimension for w in body.widgets for f in w.query_spec.filters}
    known_metrics = set(db.scalars(select(SemanticMetric.code).where(SemanticMetric.code.in_(metric_codes or {""}))))
    known_dims = set(db.scalars(select(SemanticDimension.code).where(SemanticDimension.code.in_(dim_codes or {""}))))
    errors = [{"field": "widgets", "message": f"Metric không tồn tại: {c}"} for c in sorted(metric_codes - known_metrics)]
    errors += [{"field": "widgets", "message": f"Dimension không tồn tại: {c}"} for c in sorted(dim_codes - known_dims)]
    if errors:
        raise unprocessable("Widget không hợp lệ", errors, type_="invalid-widget")


def _set_widgets(dashboard: Dashboard, widgets: list[Widget]) -> None:
    dashboard.widgets.clear()
    for w in widgets:
        dashboard.widgets.append(
            DashboardWidget(
                type=w.type,
                title=w.title,
                query_spec=w.query_spec.model_dump(by_alias=True),
                position=w.position.model_dump(),
            )
        )


def create_dashboard(db: Session, principal: Principal, body: DashboardInput) -> DashboardOut:
    _validate_widgets(db, body)
    dashboard = Dashboard(
        title=body.title,
        description=body.description,
        topic=body.topic,
        owner_id=principal.id,
        status=DashboardStatus.DRAFT,
        global_filters=body.global_filters,
        version=1,
    )
    _set_widgets(dashboard, body.widgets)
    db.add(dashboard)
    db.flush()
    audit(db, principal, "DASHBOARD_CREATE", "DASHBOARD", dashboard.id, {"title": dashboard.title})
    db.commit()
    db.refresh(dashboard)
    return dashboard_out(db, principal, dashboard)


def _parse_if_match(value: str) -> int | None:
    value = value.strip().removeprefix("W/").strip('"')
    return int(value) if value.isdigit() else None


def save_dashboard(db: Session, principal: Principal, dashboard_id: int, if_match: str, body: DashboardInput) -> DashboardOut:
    dashboard = get_owned(db, principal, dashboard_id)
    expected = _parse_if_match(if_match)
    if expected is None or expected != dashboard.version:
        raise ProblemError(412, "Phiên bản đã thay đổi", "Dashboard đã bị sửa ở phiên khác — tải lại trước khi lưu", type_="version-mismatch")
    _validate_widgets(db, body)
    dashboard.title, dashboard.description, dashboard.topic = body.title, body.description, body.topic
    dashboard.global_filters = body.global_filters
    _set_widgets(dashboard, body.widgets)
    dashboard.version += 1
    audit(db, principal, "DASHBOARD_SAVE", "DASHBOARD", dashboard.id, {"version": dashboard.version})
    db.commit()
    db.refresh(dashboard)
    return dashboard_out(db, principal, dashboard)


def publish(db: Session, principal: Principal, dashboard_id: int) -> DashboardOut:
    dashboard = get_owned(db, principal, dashboard_id)
    if dashboard.status != DashboardStatus.DRAFT:
        raise conflict("Chỉ publish được dashboard nháp", type_="invalid-transition")
    if not dashboard.widgets:
        raise conflict("Dashboard chưa có widget nào", type_="empty-dashboard")
    dashboard.status, dashboard.published_at = DashboardStatus.PUBLISHED, now()
    audit(db, principal, "DASHBOARD_PUBLISH", "DASHBOARD", dashboard.id, {"version": dashboard.version})
    db.commit()
    db.refresh(dashboard)
    return dashboard_out(db, principal, dashboard)


def set_shares(db: Session, principal: Principal, dashboard_id: int, shares: list[Share]) -> list[Share]:
    dashboard = get_owned(db, principal, dashboard_id)
    errors = []
    for i, share in enumerate(shares):
        if share.principal_type == PrincipalType.ROLE and share.principal_id not in RoleCode.__members__:
            errors.append({"field": f"[{i}].principalId", "message": "Vai trò không tồn tại"})
        elif share.principal_type == PrincipalType.ORG_UNIT and org_unit_by_code(db, share.principal_id) is None:
            errors.append({"field": f"[{i}].principalId", "message": "Đơn vị không tồn tại"})
        elif share.principal_type == PrincipalType.USER:
            try:
                exists = db.get(User, uuid.UUID(share.principal_id)) is not None
            except ValueError:
                exists = False
            if not exists:
                errors.append({"field": f"[{i}].principalId", "message": "Người dùng không tồn tại"})
    if errors:
        raise unprocessable("Đối tượng chia sẻ không hợp lệ", errors)
    unique = {(s.principal_type, s.principal_id) for s in shares}
    dashboard.shares.clear()
    db.flush()
    for ptype, pid in sorted(unique):
        dashboard.shares.append(DashboardShare(principal_type=ptype, principal_id=pid))
    audit(db, principal, "DASHBOARD_SHARE", "DASHBOARD", dashboard.id, {"shares": [f"{t.value}:{p}" for t, p in sorted(unique)]})
    db.commit()
    return [Share(principal_type=t, principal_id=p) for t, p in sorted(unique)]


def set_favorite(db: Session, principal: Principal, dashboard_id: int, favorite: bool) -> None:
    dashboard = get_visible(db, principal, dashboard_id)
    existing = db.get(DashboardFavorite, (principal.id, dashboard.id))
    if favorite and existing is None:
        db.add(DashboardFavorite(user_id=principal.id, dashboard_id=dashboard.id))
    elif not favorite and existing is not None:
        db.delete(existing)
    db.commit()
