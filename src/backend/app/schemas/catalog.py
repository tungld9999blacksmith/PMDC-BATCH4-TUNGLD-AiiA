import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.domain.enums import (
    DataLayer,
    DqDimension,
    DqIssueStatus,
    DqRuleStatus,
    DqRuleType,
    DqSeverity,
    MatchStatus,
    Sensitivity,
)
from app.schemas.common import ApiModel, Freshness, MaskableValue, TabularResult, UserRef


# ── Catalog ──
class GlossaryTermInput(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    definition: str = Field(min_length=1)


class GlossaryTermOut(GlossaryTermInput):
    id: int
    owner: UserRef | None


class DatasetOut(ApiModel):
    id: int
    layer: DataLayer
    schema_name: str
    table_name: str
    display_name: str
    description: str | None
    owner: UserRef | None
    steward: UserRef | None
    tags: list[str]
    freshness: Freshness
    accessible: bool


class DatasetColumnOut(ApiModel):
    id: int
    name: str
    data_type: str
    description: str | None
    sensitivity: Sensitivity
    glossary_term: GlossaryTermOut | None


class DatasetColumnPatch(ApiModel):
    sensitivity: Sensitivity | None = None
    description: str | None = None
    glossary_term_id: int | None = None


class UsedBy(ApiModel):
    dashboards: list[Any] = []
    metrics: list[str] = []


class DatasetDetail(DatasetOut):
    columns: list[DatasetColumnOut]
    row_count: int | None
    freshness_sla_minutes: int | None
    used_by: UsedBy


# ── Data quality ──
class DqRuleInput(ApiModel):
    dataset_id: int
    column_id: int | None = None
    rule_type: DqRuleType
    dimension: DqDimension
    severity: DqSeverity
    params: dict[str, Any] = {}
    description: str = Field(min_length=1)


class DqRulePatch(ApiModel):
    dataset_id: int | None = None
    column_id: int | None = None
    rule_type: DqRuleType | None = None
    dimension: DqDimension | None = None
    severity: DqSeverity | None = None
    params: dict[str, Any] | None = None
    description: str | None = Field(None, min_length=1)
    status: DqRuleStatus | None = None


class DqRuleOut(DqRuleInput):
    id: int
    status: DqRuleStatus
    version: int
    last_pass_rate: float | None
    last_dry_run_version: int | None


class DryRunResult(ApiModel):
    evaluated: int
    failed: int
    sample: TabularResult


class DqScoreRow(ApiModel):
    key: str
    score: float
    by_dimension: dict[str, float]


class DqTrendPoint(ApiModel):
    date: str
    score: float


class DqScoreBoard(ApiModel):
    overall: float | None
    by_dimension: dict[str, float]
    rows: list[DqScoreRow]
    trend: list[DqTrendPoint]


class CommentOut(ApiModel):
    id: int
    author: UserRef | None
    body: str
    created_at: datetime


class CommentInput(ApiModel):
    body: str = Field(min_length=1)


class DqIssueOut(ApiModel):
    id: int
    rule: DqRuleOut
    dataset_id: int
    affected_rows: int
    severity: DqSeverity
    status: DqIssueStatus
    assignee: UserRef | None
    last_run_id: uuid.UUID
    created_at: datetime
    comments: list[CommentOut]


class DqIssuePatch(ApiModel):
    status: DqIssueStatus | None = None
    assignee_id: uuid.UUID | None = None


# ── Identity ──
class MatchRecord(ApiModel):
    source_code: str
    source_key: str
    person_id: uuid.UUID
    fields: dict[str, MaskableValue] = {}


class MatchCandidateOut(ApiModel):
    id: int
    score: float
    status: MatchStatus
    left: MatchRecord
    right: MatchRecord
    comparison: dict[str, Literal["MATCH", "PARTIAL", "DIFFERENT", "MISSING"]]
    created_at: datetime


class MatchDecision(ApiModel):
    decision: Literal["MERGE", "NOT_MATCH", "SKIP"]
    note: str | None = None


class MergeEventOut(ApiModel):
    id: int
    action: Literal["MERGE", "UNMERGE"]
    survivor_person_id: uuid.UUID
    merged_person_id: uuid.UUID
    actor: UserRef | None
    automatic: bool
    created_at: datetime


class UnmergeRequest(ApiModel):
    reason: str = Field(min_length=5)
