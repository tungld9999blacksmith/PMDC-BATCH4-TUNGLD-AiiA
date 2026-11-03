import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Response

from app.api.v1.deps import ADMIN, AnyUser, Db, Gateway
from app.core.pagination import PageParams, page_params
from app.core.security import require_roles
from app.domain.enums import AuditOutcome, QaStatus, RoleCode, UserStatus
from app.schemas.assistant import (
    AssistantLogOut,
    BlockedTopicInput,
    BlockedTopicOut,
    PolicyCreate,
    PolicyOut,
    PolicySimulateRequest,
    PolicySimulation,
    PolicyVersionCreate,
    PolicyVersionOut,
)
from app.schemas.common import Page
from app.schemas.me import AdminUser, AuditLogOut, OrgUnitOut, RoleAssignment, UserCreate, UserPatch
from app.services import assistant, policies, users

router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])


@router.get("/users", response_model=Page[AdminUser], summary="Danh sách người dùng (US24)")
def list_users(
    q: str | None = None,
    role: RoleCode | None = None,
    status: UserStatus | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    _=ADMIN,
):
    items, total = users.list_users(db, q, role, status, params)
    return Page.of(items, total, params)


@router.post("/users", response_model=AdminUser, status_code=201, summary="Tạo người dùng trước khi họ đăng nhập SSO lần đầu")
def create_user(body: UserCreate, db=Db, principal=ADMIN):
    return users.create_user(db, principal, body)


@router.patch("/users/{userId}", response_model=AdminUser, summary="Khóa / mở khóa, đổi đơn vị")
def update_user(userId: uuid.UUID, body: UserPatch, db=Db, principal=ADMIN):  # noqa: N803
    return users.update_user(db, principal, userId, body)


@router.put("/users/{userId}/roles", response_model=AdminUser, summary="Gán toàn bộ vai trò và phạm vi")
def set_user_roles(userId: uuid.UUID, body: list[RoleAssignment], db=Db, principal=ADMIN):  # noqa: N803
    return users.set_user_roles(db, principal, userId, body)


@router.get("/org-units", response_model=list[OrgUnitOut], summary="Cây đơn vị")
def list_org_units(db=Db, _=AnyUser):
    return users.list_org_units(db)


@router.get("/policies", response_model=list[PolicyOut], summary="Chính sách phân quyền dòng/cột (US33)")
def list_policies(db=Db, _=ADMIN):
    return policies.list_policies(db)


@router.post("/policies", response_model=PolicyOut, status_code=201, summary="Tạo chính sách (phiên bản 1)")
def create_policy(body: PolicyCreate, db=Db, principal=ADMIN):
    return policies.create_policy(db, principal, body)


@router.get("/policies/{policyId}/versions", response_model=list[PolicyVersionOut], summary="Lịch sử phiên bản chính sách")
def list_policy_versions(policyId: int, db=Db, _=ADMIN):  # noqa: N803
    return policies.list_versions(db, policyId)


@router.post("/policies/{policyId}/versions", response_model=PolicyVersionOut, status_code=201, summary="Lưu phiên bản mới / khôi phục (BR19)")
def create_policy_version(policyId: int, body: PolicyVersionCreate, db=Db, principal=ADMIN):  # noqa: N803
    return policies.create_version(db, principal, policyId, body)


@router.post("/policies/simulate", response_model=PolicySimulation, summary='Mô phỏng "Xem như người dùng X" (AC33)')
def simulate_policy(body: PolicySimulateRequest, db=Db, gateway=Gateway, principal=ADMIN):
    return policies.simulate(db, gateway, principal, body)


@router.get("/audit-logs", response_model=Page[AuditLogOut], summary="Nhật ký kiểm toán chỉ đọc (US25)")
def list_audit_logs(
    actorId: uuid.UUID | None = None,  # noqa: N803
    action: str | None = None,
    objectType: str | None = None,  # noqa: N803
    objectId: str | None = None,  # noqa: N803
    outcome: AuditOutcome | None = None,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    principal=Depends(require_roles(RoleCode.PLATFORM_ADMIN, RoleCode.DATA_STEWARD)),
):
    items, total = users.list_audit_logs(
        db, principal, actor_id=actorId, action=action, object_type=objectType, object_id=objectId,
        outcome=outcome, from_=from_, to=to, params=params,
    )  # fmt: skip
    return Page.of(items, total, params)


@router.get("/assistant-logs", response_model=Page[AssistantLogOut], summary="Nhật ký hỏi-đáp (US40)")
def list_assistant_logs(
    status: QaStatus | None = None,
    userId: uuid.UUID | None = None,  # noqa: N803
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    _=ADMIN,
):
    items, total = assistant.list_logs(db, status, userId, from_, to, params)
    return Page.of(items, total, params)


@router.get("/blocked-topics", response_model=list[BlockedTopicOut], summary="Chủ đề bị chặn")
def list_blocked_topics(db=Db, _=ADMIN):
    return assistant.list_topics(db)


@router.post("/blocked-topics", response_model=BlockedTopicOut, status_code=201, summary="Thêm chủ đề bị chặn")
def create_blocked_topic(body: BlockedTopicInput, db=Db, principal=ADMIN):
    return assistant.create_topic(db, principal, body)


@router.delete("/blocked-topics/{topicId}", status_code=204, summary="Xóa chủ đề bị chặn")
def delete_blocked_topic(topicId: int, db=Db, principal=ADMIN):  # noqa: N803
    assistant.delete_topic(db, principal, topicId)
    return Response(status_code=204)
