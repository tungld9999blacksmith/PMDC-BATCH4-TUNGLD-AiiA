"""Người dùng, vai trò, đơn vị, thông báo, audit log."""

import uuid
from datetime import datetime

from psycopg import errors as pg_errors
from sqlalchemy import String, cast, or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.errors import conflict, not_found, unprocessable
from app.core.pagination import PageParams, paginate
from app.core.security import Principal
from app.domain.enums import AuditOutcome, RoleCode, UserStatus
from app.domain.models import AuditLog, Dataset, Notification, OrgUnit, User, UserRole
from app.schemas.common import OrgUnitRef, UserRef
from app.schemas.me import AdminUser, AuditLogOut, Me, NotificationOut, OrgUnitOut, RoleAssignment, UserCreate, UserPatch
from app.services.access import now, org_unit_by_code


def role_assignments(user: User) -> list[RoleAssignment]:
    return [
        RoleAssignment(role=r.role_code, scope_org_unit=r.scope_org_unit.code if r.scope_org_unit else None)
        for r in sorted(user.roles, key=lambda r: (r.role_code.value, r.scope_org_unit_id or 0))
    ]


def me(db: Session, principal: Principal) -> Me:
    user = db.get(User, principal.id)
    return Me(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        org_unit=OrgUnitRef.of(user.org_unit),
        roles=role_assignments(user),
    )


def to_admin_user(user: User) -> AdminUser:
    return AdminUser(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        org_unit=OrgUnitRef.of(user.org_unit),
        status=user.status,
        roles=role_assignments(user),
        last_login_at=user.last_login_at,
    )


# ───────────────────────── Thông báo ─────────────────────────
def notify(db: Session, user_id: uuid.UUID, type_: str, title: str, link: str | None = None) -> None:
    db.add(Notification(user_id=user_id, type=type_, title=title[:255], link=link))


def list_notifications(db: Session, principal: Principal, unread: bool | None, params: PageParams):
    stmt = select(Notification).where(Notification.user_id == principal.id)
    if unread is True:
        stmt = stmt.where(Notification.read_at.is_(None))
    elif unread is False:
        stmt = stmt.where(Notification.read_at.is_not(None))
    items, total = paginate(db, stmt.order_by(Notification.created_at.desc(), Notification.id.desc()), params)
    return [NotificationOut.model_validate(n) for n in items], total


def mark_notification_read(db: Session, principal: Principal, notification_id: int) -> None:
    notification = db.get(Notification, notification_id)
    if notification is None or notification.user_id != principal.id:
        raise not_found()
    if notification.read_at is None:
        notification.read_at = now()
    db.commit()


# ───────────────────────── Quản trị người dùng ─────────────────────────
def list_users(db: Session, q: str | None, role: RoleCode | None, status: UserStatus | None, params: PageParams):
    stmt = select(User).where(User.sso_subject != "system")
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(like), User.email.ilike(like)))
    if role:
        stmt = stmt.where(User.id.in_(select(UserRole.user_id).where(UserRole.role_code == role)))
    if status:
        stmt = stmt.where(User.status == status)
    items, total = paginate(db, stmt.order_by(User.full_name), params)
    return [to_admin_user(u) for u in items], total


def _org_unit_or_422(db: Session, code: str | None, field: str) -> OrgUnit | None:
    if code is None:
        return None
    unit = org_unit_by_code(db, code)
    if unit is None:
        raise unprocessable(f"Không có đơn vị {code}", [{"field": field, "message": "Mã đơn vị không tồn tại"}])
    return unit


def _replace_roles(db: Session, principal: Principal, user: User, roles: list[RoleAssignment]) -> None:
    wanted: set[tuple[RoleCode, int | None]] = set()
    for i, assignment in enumerate(roles):
        unit = _org_unit_or_422(db, assignment.scope_org_unit, f"[{i}].scopeOrgUnit")
        wanted.add((assignment.role, unit.id if unit else None))
    current = {(r.role_code, r.scope_org_unit_id): r for r in user.roles}
    try:
        for key, role in current.items():
            if key not in wanted:
                db.delete(role)
        db.flush()
    except DBAPIError as exc:
        # Trigger trg_user_roles_last_admin (AC24) chặn gỡ PLATFORM_ADMIN cuối cùng.
        if isinstance(exc.orig, pg_errors.CheckViolation):
            db.rollback()
            raise conflict("Không thể gỡ vai trò PLATFORM_ADMIN cuối cùng", type_="last-admin") from exc
        raise
    for role_code, unit_id in wanted - current.keys():
        db.add(UserRole(user_id=user.id, role_code=role_code, scope_org_unit_id=unit_id, granted_by=principal.id))
    db.flush()
    db.refresh(user)


def create_user(db: Session, principal: Principal, body: UserCreate) -> AdminUser:
    if db.scalar(select(User).where(User.email == body.email)):
        raise conflict("Email đã có tài khoản", type_="duplicate")
    unit = _org_unit_or_422(db, body.org_unit_code, "orgUnitCode")
    # sso_subject tạm; gắn subject thật ở lần đăng nhập SSO đầu tiên (core.security).
    user = User(sso_subject=f"pending:{body.email}", email=body.email, full_name=body.full_name, org_unit_id=unit.id)
    db.add(user)
    db.flush()
    db.refresh(user)
    _replace_roles(db, principal, user, body.roles)
    audit(db, principal, "USER_CREATE", "USER", user.id, {"email": body.email, "roles": _roles_json(body.roles)})
    db.commit()
    return to_admin_user(db.get(User, user.id))


def update_user(db: Session, principal: Principal, user_id: uuid.UUID, body: UserPatch) -> AdminUser:
    user = db.get(User, user_id)
    if user is None or user.sso_subject == "system":
        raise not_found()
    changes: dict[str, str] = {}
    if body.org_unit_code is not None:
        user.org_unit_id = _org_unit_or_422(db, body.org_unit_code, "orgUnitCode").id
        changes["orgUnit"] = body.org_unit_code
    if body.status is not None and body.status != user.status:
        if body.status == UserStatus.INACTIVE and _is_last_active_admin(db, user):
            raise conflict("Không thể khóa PLATFORM_ADMIN cuối cùng", type_="last-admin")
        if user.id == principal.id and body.status == UserStatus.INACTIVE:
            raise conflict("Không thể tự khóa tài khoản của mình")
        user.status = body.status
        changes["status"] = body.status.value
    audit(db, principal, "USER_UPDATE", "USER", user.id, changes)
    db.commit()
    db.refresh(user)
    return to_admin_user(user)


def _is_last_active_admin(db: Session, user: User) -> bool:
    if not any(r.role_code == RoleCode.PLATFORM_ADMIN for r in user.roles):
        return False
    others = db.scalar(
        select(UserRole.id)
        .join(User, User.id == UserRole.user_id)
        .where(UserRole.role_code == RoleCode.PLATFORM_ADMIN, User.id != user.id, User.status == UserStatus.ACTIVE)
        .limit(1)
    )
    return others is None


def set_user_roles(db: Session, principal: Principal, user_id: uuid.UUID, roles: list[RoleAssignment]) -> AdminUser:
    user = db.get(User, user_id)
    if user is None or user.sso_subject == "system":
        raise not_found()
    before = _roles_json(role_assignments(user))
    _replace_roles(db, principal, user, roles)
    audit(db, principal, "ROLE_CHANGE", "USER", user.id, {"before": before, "after": _roles_json(roles)})
    db.commit()
    return to_admin_user(db.get(User, user.id))


def _roles_json(roles: list[RoleAssignment]) -> list[dict[str, str | None]]:
    return [{"role": r.role.value, "scopeOrgUnit": r.scope_org_unit} for r in roles]


def list_org_units(db: Session) -> list[OrgUnitOut]:
    units = db.scalars(select(OrgUnit).where(OrgUnit.is_active).order_by(OrgUnit.id)).all()
    by_id = {u.id: u.code for u in units}
    return [OrgUnitOut(code=u.code, name=u.name, type=u.type, parent_code=by_id.get(u.parent_id)) for u in units]


# ───────────────────────── Audit log ─────────────────────────
def list_audit_logs(
    db: Session,
    principal: Principal,
    *,
    actor_id: uuid.UUID | None,
    action: str | None,
    object_type: str | None,
    object_id: str | None,
    outcome: AuditOutcome | None,
    from_: datetime | None,
    to: datetime | None,
    params: PageParams,
):
    stmt = select(AuditLog)
    if not principal.has_role(RoleCode.PLATFORM_ADMIN):
        # Steward chỉ xem audit của dataset mình phụ trách (ma trận phân quyền).
        mine = select(cast(Dataset.id, String)).where(Dataset.steward_user_id == principal.id)
        stmt = stmt.where(AuditLog.object_type == "DATASET", AuditLog.object_id.in_(mine))
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if object_type:
        stmt = stmt.where(AuditLog.object_type == object_type)
    if object_id:
        stmt = stmt.where(AuditLog.object_id == object_id)
    if outcome:
        stmt = stmt.where(AuditLog.outcome == outcome)
    if from_:
        stmt = stmt.where(AuditLog.occurred_at >= from_)
    if to:
        stmt = stmt.where(AuditLog.occurred_at <= to)
    items, total = paginate(db, stmt.order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc()), params)
    out = [
        AuditLogOut(
            id=a.id,
            occurred_at=a.occurred_at,
            actor=UserRef.of(a.actor),
            action=a.action,
            object_type=a.object_type,
            object_id=a.object_id,
            outcome=a.outcome,
            ip=str(a.ip) if a.ip else None,
            details=a.details,
        )
        for a in items
    ]
    return out, total
