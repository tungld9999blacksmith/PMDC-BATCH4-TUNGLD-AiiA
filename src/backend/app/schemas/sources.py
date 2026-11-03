import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import AnyUrl, Field

from app.domain.enums import RunStatus, RunTrigger, Sensitivity, SourceStatus, SourceType, SubjectType
from app.schemas.bi import LineageNode
from app.schemas.common import ApiModel, TabularResult, UserRef


class FileTemplate(ApiModel):
    required_columns: list[str] = []


class Schedule(ApiModel):
    cron: str
    paused: bool = False


class ScheduleOut(Schedule):
    next_run_at: datetime | None = None


class DataSourceInput(ApiModel):
    code: str = Field(pattern=r"^SRC-[A-Z0-9]{2,20}$")
    name: str = Field(min_length=1, max_length=255)
    type: SourceType
    business_owner: str = Field(min_length=1, max_length=255)
    purpose: str = Field(min_length=10)
    legal_basis_ref: str = Field(min_length=3, max_length=255)
    legal_doc_uri: AnyUrl | None = None
    sensitivity: Sensitivity
    subject_types: list[SubjectType] = Field(min_length=1)
    connection_config: dict[str, Any] = {}
    file_template: FileTemplate | None = None


class DataSourcePatch(ApiModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    business_owner: str | None = Field(None, min_length=1, max_length=255)
    purpose: str | None = Field(None, min_length=10)
    legal_basis_ref: str | None = Field(None, min_length=3, max_length=255)
    sensitivity: Sensitivity | None = None
    connection_config: dict[str, Any] | None = None
    file_template: dict[str, Any] | None = None
    status: SourceStatus | None = None


class PipelineRunOut(ApiModel):
    id: uuid.UUID
    source_id: int
    source_code: str
    trigger: RunTrigger
    status: RunStatus
    rows_read: int
    rows_written: int
    rows_quarantined: int
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class RunStep(ApiModel):
    name: Literal["BRONZE", "DQ", "SILVER", "GOLD"]
    status: RunStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None


class RunDqResult(ApiModel):
    rule_id: int
    description: str
    severity: Literal["BLOCKING", "WARNING"]
    evaluated: int
    failed: int
    status: Literal["PASS", "FAIL", "ERROR"]


class PipelineRunDetail(PipelineRunOut):
    steps: list[RunStep] = []
    dq_results: list[RunDqResult] = []
    error_message: str | None = None


class DataSourceOut(ApiModel):
    id: int
    code: str
    name: str
    type: SourceType
    business_owner: str
    purpose: str
    legal_basis_ref: str
    legal_doc_uri: str | None
    sensitivity: Sensitivity
    subject_types: list[SubjectType]
    connection_config: dict[str, Any]
    file_template: dict[str, Any] | None
    status: SourceStatus
    owner: UserRef | None
    has_secret: bool
    schedule: Schedule | None
    last_run: PipelineRunOut | None


class ConnectionTestRequest(ApiModel):
    secret: str | None = None


class ConnectionTestResult(ApiModel):
    ok: bool
    latency_ms: int
    message: str
    discovered_tables: list[str] = []


class UploadResult(ApiModel):
    upload_id: uuid.UUID
    file_name: str
    row_count: int
    checksum_sha256: str
    duplicate_of_batch_id: int | None
    preview: TabularResult


class MappingRule(ApiModel):
    source_column: str | None = None
    target_column: str
    transform: str | None = None


class SchemaMappingInput(ApiModel):
    target_dataset_id: int
    rules: list[MappingRule]


class SchemaMappingOut(SchemaMappingInput):
    id: int
    version: int
    active: bool
    created_by: UserRef | None
    created_at: datetime


class MappingError(ApiModel):
    target_column: str
    message: str


class MappingPreview(ApiModel):
    valid: bool
    errors: list[MappingError] = []
    preview: TabularResult = TabularResult()
    impacted: list[LineageNode] = []


class TriggerRunRequest(ApiModel):
    upload_id: uuid.UUID | None = None
    confirm_duplicate: bool = False


class RerunRequest(ApiModel):
    mode: Literal["RERUN", "REPROCESS_QUARANTINE"] = "RERUN"
