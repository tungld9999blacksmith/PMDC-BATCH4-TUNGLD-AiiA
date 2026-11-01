import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import EmailStr, Field

from app.domain.enums import (
    AccessLevel,
    AuditOutcome,
    OrgUnitType,
    ResourceType,
    RoleCode,
    UserStatus,
)
from app.schemas.bi import DashboardSummary
from app.schemas.common import ApiModel, OrgUnitRef, UserRef
from app.schemas.sources import PipelineRunOut


class RoleAssignment(ApiModel):
    role: RoleCode
    scope_org_unit: str | None = None


class Me(ApiModel):
    id: uuid.UUID
    email: str
    full_name: str
    org_unit: OrgUnitRef | None
    roles: list[RoleAssignment]


class AccessGrantOut(ApiModel):
    id: int
    resource_type: ResourceType
    resource_id: str
    resource_name: str
    access_level: AccessLevel
    valid_from: datetime
    valid_to: datetime
    granted_by: UserRef | None


class DataHealth(ApiModel):
    dq_score: float | None = None
    stale_datasets: int = 0
    open_alerts: int = 0


class RecentItem(ApiModel):
    kind: Literal["PROFILE", "DASHBOARD", "DATASET"]
    id: str
    title: str
    viewed_at: datetime


class HomeSummary(ApiModel):
    favorite_dashboards: list[DashboardSummary]
    data_health: DataHealth
    failed_runs: list[PipelineRunOut]
    open_issues: int
    pending_matches: int
    pending_access_reviews: int
    recent: list[RecentItem]


class NotificationOut(ApiModel):
    id: int
    type: str
    title: str
    link: str | None
    read_at: datetime | None
    created_at: datetime


class OrgUnitOut(ApiModel):
    code: str
    name: str
    type: OrgUnitType
    parent_code: str | None


class AdminUser(ApiModel):
    id: uuid.UUID
    email: str
    full_name: str
    org_unit: OrgUnitRef | None
    status: UserStatus
    roles: list[RoleAssignment]
    last_login_at: datetime | None


class UserCreate(ApiModel):
    email: EmailStr
    full_name: str = Field(min_length=1)
    org_unit_code: str
    roles: list[RoleAssignment] = []


class UserPatch(ApiModel):
    status: UserStatus | None = None
    org_unit_code: str | None = None


class AuditLogOut(ApiModel):
    id: int
    occurred_at: datetime
    actor: UserRef | None
    action: str
    object_type: str
    object_id: str | None
    outcome: AuditOutcome
    ip: str | None
    details: dict[str, Any]
