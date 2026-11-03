"""Yêu cầu và cấp quyền truy cập (US23, BR09): có mục đích, thời hạn ≤ 180 ngày, Steward phụ trách duyệt,
không tự duyệt, quyền tự hết hạn (worker gọi expire_access())."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import String, and_, cast, or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.errors import conflict, forbidden, not_found, unprocessable
from app.core.pagination import PageParams, paginate
from app.core.security import Principal
from app.domain.enums import AccessLevel, AccessRequestStatus, ResourceType, RoleCode, UserStatus
from app.domain.models import AccessGrant, AccessRequest, Dataset, User, UserRole
from app.schemas.bi import AccessDecision, AccessRequestInput, AccessRequestOut
from app.schemas.common import UserRef
from app.schemas.me import AccessGrantOut
from app.services.access import active_grants
from app.services.resources import resource_name
from app.services.users import notify


def _grant_for_request(db: Session, request_id: int) -> AccessGrant | None:
    return db.scalar(select(AccessGrant).where(AccessGrant.request_id == request_id).order_by(AccessGrant.id.desc()).limit(1))


def request_out(db: Session, r: AccessRequest) -> AccessRequestOut:
    grant = _grant_for_request(db, r.id) if r.status in (AccessRequestStatus.APPROVED, AccessRequestStatus.EXPIRED, AccessRequestStatus.REVOKED) else None
    return AccessRequestOut(
        id=r.id,
        resource_type=r.resource_type,
        resource_id=r.resource_id,
        resource_name=resource_name(db, r.resource_type, r.resource_id) or r.resource_id,
        access_level=r.access_level,
        purpose=r.purpose,
        scope=r.scope,
        requested_days=r.requested_days,
        requester=UserRef.of(r.requester),
        status=r.status,
        reviewer=UserRef.of(r.reviewer),
        review_note=r.review_note,
        created_at=r.created_at,
        decided_at=r.decided_at,
        expires_at=grant.valid_to if grant else None,
    )


def grant_out(db: Session, g: AccessGrant) -> AccessGrantOut:
    return AccessGrantOut(
        id=g.id,
        resource_type=g.resource_type,
        resource_id=g.resource_id,
        resource_name=resource_name(db, g.resource_type, g.resource_id) or g.resource_id,
        access_level=g.access_level,
        valid_from=g.valid_from,
        valid_to=g.valid_to,
        granted_by=UserRef.of(g.granter),
    )


def my_grants(db: Session, principal: Principal) -> list[AccessGrantOut]:
    return [grant_out(db, g) for g in active_grants(db, principal)]


def reviewable_filter(principal: Principal):  # noqa: ANN202
    """Yêu cầu Steward này được duyệt: dataset do mình phụ trách (hoặc chưa có Steward) và tài nguyên khác."""
    stewarded = select(cast(Dataset.id, String)).where(
        or_(Dataset.steward_user_id == principal.id, Dataset.steward_user_id.is_(None))
    )
    return and_(
        AccessRequest.requester_id != principal.id,
        or_(AccessRequest.resource_type != ResourceType.DATASET, AccessRequest.resource_id.in_(stewarded)),
    )


def can_review(db: Session, principal: Principal, request: AccessRequest) -> bool:
    if not principal.has_role(RoleCode.DATA_STEWARD) or request.requester_id == principal.id:
        return False
    if request.resource_type == ResourceType.DATASET and request.resource_id.isdigit():
        dataset = db.get(Dataset, int(request.resource_id))
        return dataset is not None and dataset.steward_user_id in (None, principal.id)
    return True


def list_requests(db: Session, principal: Principal, box: str, status: AccessRequestStatus | None, params: PageParams):
    if box == "review":
        if not principal.has_role(RoleCode.DATA_STEWARD):
            raise forbidden("Chỉ Data Steward duyệt yêu cầu truy cập")
        stmt = select(AccessRequest).where(reviewable_filter(principal))
    else:
        stmt = select(AccessRequest).where(AccessRequest.requester_id == principal.id)
    if status:
        stmt = stmt.where(AccessRequest.status == status)
    items, total = paginate(db, stmt.order_by(AccessRequest.created_at.desc()), params)
    return [request_out(db, r) for r in items], total


def _reviewers(db: Session, request: AccessRequest) -> list[User]:
    if request.resource_type == ResourceType.DATASET and request.resource_id.isdigit():
        dataset = db.get(Dataset, int(request.resource_id))
        if dataset and dataset.steward_user_id:
            return [dataset.steward]
    return list(
        db.scalars(
            select(User)
            .join(UserRole, UserRole.user_id == User.id)
            .where(UserRole.role_code == RoleCode.DATA_STEWARD, User.status == UserStatus.ACTIVE, User.id != request.requester_id)
            .distinct()
        ).all()
    )


def create_request(db: Session, principal: Principal, body: AccessRequestInput) -> AccessRequestOut:
    if resource_name(db, body.resource_type, body.resource_id, default=None) is None:
        raise unprocessable("Tài nguyên không tồn tại", [{"field": "resourceId", "message": "Không tồn tại"}])
    pending = db.scalar(
        select(AccessRequest.id).where(
            AccessRequest.requester_id == principal.id,
            AccessRequest.resource_type == body.resource_type,
            AccessRequest.resource_id == body.resource_id,
            AccessRequest.status == AccessRequestStatus.PENDING,
        )
    )
    if pending:
        raise conflict("Đã có yêu cầu đang chờ duyệt cho tài nguyên này", type_="duplicate-request")
    for grant in active_grants(db, principal, body.resource_type):
        if grant.resource_id == body.resource_id and (
            body.access_level == AccessLevel.READ or grant.access_level == AccessLevel.EXPORT
        ):
            raise conflict("Bạn đang có quyền còn hiệu lực cho tài nguyên này", type_="already-granted")
    request = AccessRequest(
        requester_id=principal.id,
        resource_type=body.resource_type,
        resource_id=body.resource_id,
        access_level=body.access_level,
        purpose=body.purpose.strip(),
        scope=body.scope,
        requested_days=body.requested_days,
    )
    db.add(request)
    db.flush()
    db.refresh(request)
    for reviewer in _reviewers(db, request):
        notify(db, reviewer.id, "ACCESS_REQUESTED", f"{principal.full_name} yêu cầu quyền truy cập", f"/access/review/{request.id}")
    audit(
        db, principal, "ACCESS_REQUEST", body.resource_type.value, body.resource_id,
        {"requestId": request.id, "level": body.access_level.value, "days": body.requested_days},
    )  # fmt: skip
    db.commit()
    return request_out(db, request)


def _get_request(db: Session, request_id: int) -> AccessRequest:
    request = db.scalar(select(AccessRequest).where(AccessRequest.id == request_id).with_for_update())
    if request is None:
        raise not_found()
    return request


def cancel_request(db: Session, principal: Principal, request_id: int) -> None:
    request = _get_request(db, request_id)
    if request.requester_id != principal.id:
        raise not_found()
    if request.status != AccessRequestStatus.PENDING:
        raise conflict("Chỉ hủy được yêu cầu đang chờ duyệt")
    request.status = AccessRequestStatus.CANCELLED
    audit(db, principal, "ACCESS_CANCEL", request.resource_type.value, request.resource_id, {"requestId": request.id})
    db.commit()


def decide(db: Session, principal: Principal, request_id: int, body: AccessDecision) -> AccessRequestOut:
    request = _get_request(db, request_id)
    if request.requester_id == principal.id:
        raise forbidden("Không được tự duyệt yêu cầu của mình")
    if not can_review(db, principal, request):
        raise forbidden("Bạn không phụ trách tài nguyên này")
    if request.status != AccessRequestStatus.PENDING:
        raise conflict("Yêu cầu đã được xử lý", type_="already-decided")
    now = datetime.now(UTC)
    request.reviewer_id, request.decided_at = principal.id, now
    request.review_note = (body.note or "").strip() or None
    if body.decision == "REJECT":
        if not request.review_note:
            raise unprocessable("Từ chối phải nêu lý do", [{"field": "note", "message": "Bắt buộc khi REJECT"}])
        request.status = AccessRequestStatus.REJECTED
        notify(db, request.requester_id, "ACCESS_REJECTED", "Yêu cầu truy cập bị từ chối", f"/access/requests/{request.id}")
    else:
        days = body.granted_days or request.requested_days
        if days > request.requested_days:
            raise unprocessable("Thời hạn cấp không được dài hơn thời hạn yêu cầu", [{"field": "grantedDays", "message": "Vượt thời hạn yêu cầu"}])
        request.status = AccessRequestStatus.APPROVED
        db.add(
            AccessGrant(
                user_id=request.requester_id,
                resource_type=request.resource_type,
                resource_id=request.resource_id,
                access_level=request.access_level,
                scope=request.scope,
                request_id=request.id,
                granted_by=principal.id,
                valid_from=now,
                valid_to=now + timedelta(days=days),
            )
        )
        notify(db, request.requester_id, "ACCESS_APPROVED", f"Yêu cầu truy cập được duyệt ({days} ngày)", f"/access/requests/{request.id}")
    db.flush()
    audit(
        db, principal, "ACCESS_" + ("APPROVE" if body.decision == "APPROVE" else "REJECT"),
        request.resource_type.value, request.resource_id,
        {"requestId": request.id, "grantedDays": body.granted_days, "note": request.review_note},
    )  # fmt: skip
    db.commit()
    db.refresh(request)
    return request_out(db, request)


def revoke_grant(db: Session, principal: Principal, grant_id: int) -> None:
    grant = db.scalar(select(AccessGrant).where(AccessGrant.id == grant_id).with_for_update())
    if grant is None or grant.revoked_at is not None:
        raise not_found()
    if not principal.has_role(RoleCode.PLATFORM_ADMIN) and grant.resource_type == ResourceType.DATASET:
        dataset = db.get(Dataset, int(grant.resource_id)) if grant.resource_id.isdigit() else None
        if dataset is not None and dataset.steward_user_id not in (None, principal.id):
            raise forbidden("Bạn không phụ trách dataset này")
    grant.revoked_at = datetime.now(UTC)
    if grant.request_id:
        request = db.get(AccessRequest, grant.request_id)
        if request.status == AccessRequestStatus.APPROVED:
            request.status = AccessRequestStatus.REVOKED
    notify(db, grant.user_id, "ACCESS_REVOKED", "Quyền truy cập đã bị thu hồi", "/me/grants")
    audit(db, principal, "ACCESS_REVOKE", grant.resource_type.value, grant.resource_id, {"grantId": grant.id, "userId": str(grant.user_id)})
    db.commit()
