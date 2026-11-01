"""Schema cho cấp quyền, dashboard, semantic, báo cáo, cảnh báo, lineage."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.domain.enums import (
    AccessLevel,
    AccessRequestStatus,
    AlertSeverity,
    AlertStatus,
    DashboardStatus,
    DataLayer,
    DeliveryStatus,
    DetectorKind,
    LineageNodeType,
    MetricStatus,
    PrincipalType,
    ReportFormat,
    ResourceType,
    SubscriptionStatus,
)
from app.schemas.common import ApiModel, Filter, Freshness, QueryResult, SemanticQuery, UserRef

DashboardTopic = Literal["TRAINING", "HR", "RESEARCH", "FINANCE", "DATA_QUALITY"]
WidgetType = Literal["KPI", "BAR", "LINE", "PIE", "HEATMAP", "TABLE"]


# ── Access ──
class AccessRequestInput(ApiModel):
    resource_type: ResourceType
    resource_id: str = Field(min_length=1, max_length=128)
    access_level: AccessLevel = AccessLevel.READ
    purpose: str = Field(min_length=10)
    scope: dict[str, Any] = {}
    requested_days: int = Field(ge=1, le=180)


class AccessRequestOut(AccessRequestInput):
    id: int
    resource_name: str
    requester: UserRef | None
    status: AccessRequestStatus
    reviewer: UserRef | None
    review_note: str | None
    created_at: datetime
    decided_at: datetime | None
    expires_at: datetime | None


class AccessDecision(ApiModel):
    decision: Literal["APPROVE", "REJECT"]
    granted_days: int | None = Field(None, ge=1, le=180)
    note: str | None = None


# ── Dashboards ──
class Position(ApiModel):
    x: int = 0
    y: int = 0
    w: int = 4
    h: int = 3


class WidgetQuerySpec(SemanticQuery):
    drill_path: list[str] = []


class Widget(ApiModel):
    id: int | None = None
    type: WidgetType
    title: str = Field(min_length=1, max_length=255)
    query_spec: WidgetQuerySpec
    position: Position


class DashboardInput(ApiModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    topic: DashboardTopic
    global_filters: list[str] = []
    widgets: list[Widget] = []


class DashboardSummary(ApiModel):
    id: int
    title: str
    description: str | None
    topic: DashboardTopic
    status: DashboardStatus
    owner: UserRef | None
    favorite: bool
    freshness: Freshness


class Share(ApiModel):
    principal_type: PrincipalType
    principal_id: str = Field(min_length=1, max_length=128)


class DashboardOut(DashboardSummary):
    global_filters: list[str]
    widgets: list[Widget]
    version: int
    shares: list[Share]
    can_edit: bool


class ExportRequest(ApiModel):
    format: Literal["PDF", "CSV"]
    widget_id: int | None = None
    filters: list[Filter] = []


class ExportJobOut(ApiModel):
    id: uuid.UUID
    status: Literal["PENDING", "READY", "FAILED"]
    format: Literal["PDF", "CSV"]
    download_url: str | None
    expires_at: datetime | None
    watermark: str
    excluded_columns: list[str]


# ── Semantic ──
class MetricInput(ApiModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=64)
    name: str = Field(min_length=1, max_length=255)
    definition: str = Field(min_length=1)
    expression: str = Field(min_length=1)
    base_dataset_id: int
    allowed_dimensions: list[str] = []
    unit: str | None = Field(None, max_length=32)
    glossary_term_id: int | None = None


class MetricOut(MetricInput):
    id: int
    status: MetricStatus
    version: int
    owner: UserRef | None
    certified_by: UserRef | None
    certified_at: datetime | None


class MetricVersionOut(ApiModel):
    version: int
    expression: str
    changed_by: UserRef | None
    changed_at: datetime


class MetricDetail(MetricOut):
    versions: list[MetricVersionOut]
    used_by_dashboards: int


class MetricCertification(ApiModel):
    status: Literal["CERTIFIED", "DEPRECATED"]


class MetricValidation(ApiModel):
    valid: bool
    errors: list[str] = []
    preview: QueryResult | None = None


class DimensionOut(ApiModel):
    code: str
    name: str
    description: str | None


# ── Reports ──
class DeliveryOut(ApiModel):
    id: int
    recipient: UserRef | None
    status: DeliveryStatus
    ai_summary: str | None
    artifact_url: str | None
    sent_at: datetime


class SubscriptionInput(ApiModel):
    dashboard_id: int
    cron: str = Field(min_length=9, max_length=64)
    format: ReportFormat = ReportFormat.PDF
    filters: list[Filter] = []
    include_ai_summary: bool = True
    recipient_ids: list[uuid.UUID] = []
    status: SubscriptionStatus | None = None


class SubscriptionOut(ApiModel):
    id: int
    dashboard_id: int
    cron: str
    format: ReportFormat
    filters: list[Filter]
    include_ai_summary: bool
    recipient_ids: list[uuid.UUID]
    status: SubscriptionStatus
    next_run_at: datetime | None
    last_delivery: DeliveryOut | None


# ── Alerts ──
class AlertTarget(ApiModel):
    type: Literal["DATASET", "METRIC"]
    id: str
    name: str


class AlertOut(ApiModel):
    id: int
    kind: DetectorKind
    target: AlertTarget
    observed_value: float
    expected_low: float | None
    expected_high: float | None
    severity: AlertSeverity
    status: AlertStatus
    detected_at: datetime
    acknowledged_by: UserRef | None
    note: str | None


class AlertPoint(ApiModel):
    at: datetime
    value: float
    low: float | None
    high: float | None
    anomalous: bool


class AlertDetail(AlertOut):
    series: list[AlertPoint]
    run_id: uuid.UUID | None


class AlertTransition(ApiModel):
    to: Literal["ACKNOWLEDGED", "RESOLVED", "DISMISSED"]
    note: str | None = None


# ── Lineage ──
class LineageNode(ApiModel):
    id: int
    type: LineageNodeType
    ref_id: str
    name: str
    layer: DataLayer | None = None


class LineageEdgeOut(ApiModel):
    from_: int = Field(alias="from")
    to: int
    transform_ref: str | None


class LineageGraph(ApiModel):
    center: LineageNode
    nodes: list[LineageNode]
    edges: list[LineageEdgeOut]
