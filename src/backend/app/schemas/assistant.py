"""Schema cho hồ sơ 360°, trợ lý hỏi-đáp và quản trị chính sách."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.domain.enums import QaStatus, RoleCode, SubjectType
from app.schemas.common import (
    ApiModel,
    Filter,
    Freshness,
    MaskableValue,
    OrgUnitRef,
    QueryResult,
    SemanticQuery,
    TabularResult,
    UserRef,
)

FacetCode = Literal[
    "OVERVIEW", "ACADEMIC", "FINANCE", "CONDUCT", "ACTIVITY", "OUTCOME",
    "TEACHING", "RESEARCH", "EVALUATION", "HR", "DEVELOPMENT", "RECOGNITION",
]  # fmt: skip


# ── Profiles ──
class ProfileSummary(ApiModel):
    person_id: uuid.UUID
    full_name: str
    code: str | None
    roles: list[SubjectType]
    org_unit: OrgUnitRef | None
    status: str | None
    completeness: float | None


class ProfileKpi(ApiModel):
    code: str
    label: str
    value: MaskableValue


class ProfileFacetRef(ApiModel):
    code: FacetCode
    label: str
    allowed: bool
    freshness: Freshness


class Profile360(ApiModel):
    person_id: uuid.UUID
    active_role: SubjectType
    available_roles: list[SubjectType]
    header: dict[str, MaskableValue]
    kpis: list[ProfileKpi]
    facets: list[ProfileFacetRef]


class NamedTable(TabularResult):
    code: str
    title: str


class SeriesPoint(ApiModel):
    x: str
    y: float | None


class Series(ApiModel):
    code: str
    points: list[SeriesPoint]


class FacetData(ApiModel):
    facet: FacetCode
    freshness: Freshness
    fields: dict[str, MaskableValue] = {}
    tables: list[NamedTable] = []
    series: list[Series] = []


class TimelineEvent(ApiModel):
    event_id: str
    time: datetime
    type: str
    facet: FacetCode
    source: str
    title: str


class TimelinePage(ApiModel):
    items: list[TimelineEvent]
    next_before: datetime | None


class ProvenanceCandidate(ApiModel):
    source: str
    value: Any = None
    updated_at: datetime | None


class AttributeProvenance(ApiModel):
    attribute: str
    value: MaskableValue
    winning_source: str | None
    source_updated_at: datetime | None
    survivorship_rule: str | None
    candidates: list[ProvenanceCandidate] = []


# ── Assistant ──
class ConversationCreate(ApiModel):
    dashboard_id: int | None = None


class ConversationOut(ApiModel):
    id: uuid.UUID
    title: str | None
    dashboard_id: int | None
    created_at: datetime


class ChartSpec(ApiModel):
    type: Literal["BAR", "LINE", "PIE", "TABLE"]
    x: str | None = None
    y: list[str] = []


class ClarifyOption(ApiModel):
    label: str
    patch: dict[str, Any]


class Clarify(ApiModel):
    question: str
    options: list[ClarifyOption]


class AssistantMessageOut(ApiModel):
    id: int
    role: Literal["USER", "ASSISTANT"]
    content: str
    status: QaStatus | None
    ai_generated: bool
    metric_codes: list[str]
    applied_filters: list[Filter]
    data_as_of: datetime | None
    result: QueryResult | None
    chart: ChartSpec | None
    semantic_query: SemanticQuery | None
    sql: str | None
    refusal_reason: str | None
    clarify: Clarify | None
    feedback: int | None
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[AssistantMessageOut]


class AskRequest(ApiModel):
    message: str = Field(min_length=2, max_length=1000)
    clarification: dict[str, Any] | None = None


class FeedbackRequest(ApiModel):
    rating: Literal[-1, 1]
    comment: str | None = None


class AssistantLogOut(AssistantMessageOut):
    question: str | None
    user: UserRef | None
    compiled_sql: str | None


class BlockedTopicInput(ApiModel):
    pattern: str = Field(min_length=2, max_length=255)
    description: str | None = None


class BlockedTopicOut(ApiModel):
    id: int
    pattern: str
    description: str | None
    created_by: UserRef | None
    created_at: datetime


# ── Policies ──
class ColumnRule(ApiModel):
    column: str = Field(min_length=1)
    action: Literal["MASK_PARTIAL", "HASH", "DENY"]


class PolicyRules(ApiModel):
    row_filter: str | None = None
    column_rules: list[ColumnRule] = []


class PolicyCreate(PolicyRules):
    name: str = Field(min_length=1, max_length=255)
    dataset_id: int
    role_code: RoleCode


class PolicyVersionCreate(PolicyRules):
    change_note: str | None = None


class PolicyVersionOut(PolicyRules):
    version: int
    change_note: str | None
    created_by: UserRef | None
    created_at: datetime


class PolicyOut(ApiModel):
    id: int
    name: str
    dataset_id: int
    role_code: RoleCode
    current_version: PolicyVersionOut | None
    active: bool


class PolicySimulateRequest(PolicyRules):
    dataset_id: int
    as_user_id: uuid.UUID


class PolicySimulation(TabularResult):
    visible_row_count: int
    total_row_count: int
