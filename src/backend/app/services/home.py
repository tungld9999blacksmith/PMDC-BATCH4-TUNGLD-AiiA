"""Dữ liệu widget trang chủ theo vai trò (P02)."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.security import Principal
from app.domain.enums import AccessRequestStatus, AlertStatus, DqIssueStatus, MatchStatus, RoleCode, RunStatus
from app.domain.models import AccessRequest, AnomalyAlert, AuditLog, Dashboard, DashboardFavorite, Dataset, DqIssue, MatchCandidate, PipelineRun
from app.schemas.me import DataHealth, HomeSummary, RecentItem
from app.services.access_requests import reviewable_filter
from app.services.dashboards import dashboard_summaries
from app.services.sources import run_out

RECENT_ACTIONS = {"PROFILE_VIEW": "PROFILE", "DASHBOARD_VIEW": "DASHBOARD", "DATASET_VIEW": "DATASET"}
OPS_ROLES = (RoleCode.DATA_ENGINEER, RoleCode.DATA_STEWARD, RoleCode.PLATFORM_ADMIN)


def summary(db: Session, principal: Principal) -> HomeSummary:
    favorites = db.scalars(
        select(Dashboard)
        .join(DashboardFavorite, DashboardFavorite.dashboard_id == Dashboard.id)
        .where(DashboardFavorite.user_id == principal.id)
        .order_by(DashboardFavorite.created_at.desc())
    ).all()

    avg_score = db.scalar(select(func.avg(Dataset.dq_score)))
    health = DataHealth(
        dq_score=round(float(avg_score), 1) if avg_score is not None else None,
        stale_datasets=db.scalar(text("SELECT count(*) FROM app.v_stale_datasets")) or 0,
        open_alerts=db.scalar(
            select(func.count()).select_from(AnomalyAlert).where(AnomalyAlert.status.in_((AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED)))
        )
        or 0,
    )

    failed_runs = []
    if principal.has_role(*OPS_ROLES):
        failed_runs = [
            run_out(r)
            for r in db.scalars(
                select(PipelineRun)
                .where(PipelineRun.status == RunStatus.FAILED, PipelineRun.queued_at >= datetime.now(UTC) - timedelta(days=7))
                .order_by(PipelineRun.queued_at.desc())
                .limit(5)
            ).all()
        ]

    is_steward = principal.has_role(RoleCode.DATA_STEWARD)
    open_issues = 0
    if principal.has_role(RoleCode.DATA_STEWARD, RoleCode.DATA_ENGINEER):
        open_issues = db.scalar(
            select(func.count()).select_from(DqIssue).where(DqIssue.status.in_((DqIssueStatus.OPEN, DqIssueStatus.IN_PROGRESS)))
        ) or 0
    pending_matches = (
        db.scalar(select(func.count()).select_from(MatchCandidate).where(MatchCandidate.status == MatchStatus.PENDING)) or 0
        if is_steward
        else 0
    )
    pending_reviews = (
        db.scalar(
            select(func.count())
            .select_from(AccessRequest)
            .where(AccessRequest.status == AccessRequestStatus.PENDING, reviewable_filter(principal))
        )
        or 0
        if is_steward
        else 0
    )

    # Mục xem gần đây lấy từ audit log của chính người dùng (mỗi đối tượng một lần, mới nhất trước).
    recent: list[RecentItem] = []
    seen: set[tuple[str, str]] = set()
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.actor_id == principal.id, AuditLog.action.in_(RECENT_ACTIONS))
        .order_by(AuditLog.occurred_at.desc())
        .limit(100)
    ).all()
    for log in rows:
        key = (RECENT_ACTIONS[log.action], log.object_id or "")
        if key in seen or not log.object_id:
            continue
        seen.add(key)
        recent.append(RecentItem(kind=key[0], id=key[1], title=str(log.details.get("title") or key[1]), viewed_at=log.occurred_at))
        if len(recent) == 10:
            break

    return HomeSummary(
        favorite_dashboards=dashboard_summaries(db, principal, list(favorites), visible_only=True),
        data_health=health,
        failed_runs=failed_runs,
        open_issues=open_issues,
        pending_matches=pending_matches,
        pending_access_reviews=pending_reviews,
        recent=recent,
    )
