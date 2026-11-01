"""Mô hình ORM của control plane (schema `app`).

Đây là mô tả schema ở revision mới nhất mà Alembic dùng để autogenerate và kiểm tra sai lệch
(`alembic check`). Tên ràng buộc check/unique trùng tên PostgreSQL tự sinh khi chạy `aiia.sql`,
để CSDL dựng từ file SQL cũ (đã `alembic stamp`) và CSDL dựng bằng migration giống hệt nhau.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, CHAR, ENUM, INET, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.domain import enums as e

SCHEMA = "app"

# Khóa chính và khóa ngoại theo quy ước đặt tên mặc định của PostgreSQL.
NAMING_CONVENTION = {
    "pk": "%(table_name)s_pkey",
    "fk": "%(table_name)s_%(column_0_name)s_fkey",
}


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA, naming_convention=NAMING_CONVENTION)


def pg_enum(enum_cls: type[StrEnum], name: str) -> ENUM:
    # Kiểu enum do migration tạo/xóa tường minh; ORM chỉ tham chiếu.
    return ENUM(
        enum_cls,
        name=name,
        schema=SCHEMA,
        create_type=False,
        values_callable=lambda members: [m.value for m in members],
    )


UserStatusT = pg_enum(e.UserStatus, "user_status")
RoleCodeT = pg_enum(e.RoleCode, "role_code")
OrgUnitTypeT = pg_enum(e.OrgUnitType, "org_unit_type")
SourceTypeT = pg_enum(e.SourceType, "source_type")
SourceStatusT = pg_enum(e.SourceStatus, "source_status")
SensitivityT = pg_enum(e.Sensitivity, "sensitivity_level")
SubjectTypeT = pg_enum(e.SubjectType, "subject_type")
RunTriggerT = pg_enum(e.RunTrigger, "run_trigger")
RunStatusT = pg_enum(e.RunStatus, "run_status")
DataLayerT = pg_enum(e.DataLayer, "data_layer")
DqRuleTypeT = pg_enum(e.DqRuleType, "dq_rule_type")
DqDimensionT = pg_enum(e.DqDimension, "dq_dimension")
DqSeverityT = pg_enum(e.DqSeverity, "dq_severity")
DqRuleStatusT = pg_enum(e.DqRuleStatus, "dq_rule_status")
DqResultStatusT = pg_enum(e.DqResultStatus, "dq_result_status")
DqIssueStatusT = pg_enum(e.DqIssueStatus, "dq_issue_status")
MatchStatusT = pg_enum(e.MatchStatus, "match_status")
MergeEventActionT = pg_enum(e.MergeEventAction, "merge_event_action")
ResourceTypeT = pg_enum(e.ResourceType, "resource_type")
AccessLevelT = pg_enum(e.AccessLevel, "access_level")
AccessRequestStatusT = pg_enum(e.AccessRequestStatus, "access_request_status")
DashboardStatusT = pg_enum(e.DashboardStatus, "dashboard_status")
PrincipalTypeT = pg_enum(e.PrincipalType, "principal_type")
MetricStatusT = pg_enum(e.MetricStatus, "metric_status")
ReportFormatT = pg_enum(e.ReportFormat, "report_format")
SubscriptionStatusT = pg_enum(e.SubscriptionStatus, "subscription_status")
DeliveryStatusT = pg_enum(e.DeliveryStatus, "delivery_status")
DetectorKindT = pg_enum(e.DetectorKind, "detector_kind")
AlertSeverityT = pg_enum(e.AlertSeverity, "alert_severity")
AlertStatusT = pg_enum(e.AlertStatus, "alert_status")
LineageNodeTypeT = pg_enum(e.LineageNodeType, "lineage_node_type")
QaRoleT = pg_enum(e.QaRole, "qa_role")
QaStatusT = pg_enum(e.QaStatus, "qa_status")
AuditOutcomeT = pg_enum(e.AuditOutcome, "audit_outcome")
ExportStatusT = pg_enum(e.ExportStatus, "export_status")
ExportFormatT = pg_enum(e.ExportFormat, "export_format")

TS = DateTime(timezone=True)
NOW = text("now()")
GEN_UUID = text("gen_random_uuid()")


def users_fk(**kw: Any) -> ForeignKey:
    return ForeignKey(f"{SCHEMA}.users.id", **kw)


# ───────────────────────── 1. Định danh & tổ chức ─────────────────────────
class OrgUnit(Base):
    __tablename__ = "org_units"
    __table_args__ = (
        UniqueConstraint("code", name="org_units_code_key"),
        CheckConstraint("parent_id IS NULL OR parent_id <> id", name="org_units_check"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[e.OrgUnitType] = mapped_column(OrgUnitTypeT)
    parent_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.org_units.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("sso_subject", name="users_sso_subject_key"),
        UniqueConstraint("email", name="users_email_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID)
    sso_subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    org_unit_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.org_units.id"))
    status: Mapped[e.UserStatus] = mapped_column(UserStatusT, server_default=text("'ACTIVE'"))
    last_login_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    org_unit: Mapped[OrgUnit | None] = relationship(lazy="joined")
    roles: Mapped[list["UserRole"]] = relationship(
        lazy="selectin", foreign_keys="UserRole.user_id", cascade="all, delete-orphan", passive_deletes=True
    )


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (
        # NULL scope = toàn trường; NULLS NOT DISTINCT để không gán trùng vai trò toàn trường.
        Index("uq_user_roles", "user_id", "role_code", "scope_org_unit_id", unique=True, postgresql_nulls_not_distinct=True),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk(ondelete="CASCADE"))
    role_code: Mapped[e.RoleCode] = mapped_column(RoleCodeT)
    scope_org_unit_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.org_units.id"))
    granted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    granted_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    scope_org_unit: Mapped[OrgUnit | None] = relationship(lazy="joined")


# ───────────────────────── 2. Nguồn & ingest ─────────────────────────
class DataSource(Base):
    __tablename__ = "data_sources"
    __table_args__ = (
        UniqueConstraint("code", name="data_sources_code_key"),
        # BR01: nguồn chỉ hoạt động khi khai báo đủ mục đích và căn cứ cho phép.
        CheckConstraint(
            "length(trim(purpose)) > 0 AND length(trim(legal_basis_ref)) > 0", name="chk_source_legal_basis"
        ),
        CheckConstraint("cardinality(subject_types) > 0", name="chk_source_subjects"),
        CheckConstraint("type <> 'FILE' OR file_template IS NOT NULL", name="chk_source_file_template"),
        CheckConstraint("type = 'FILE' OR status = 'DRAFT' OR secret_ref IS NOT NULL", name="chk_source_secret"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[e.SourceType] = mapped_column(SourceTypeT)
    status: Mapped[e.SourceStatus] = mapped_column(SourceStatusT, server_default=text("'DRAFT'"))
    owner_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    business_owner: Mapped[str] = mapped_column(String(255))
    purpose: Mapped[str] = mapped_column(Text)
    legal_basis_ref: Mapped[str] = mapped_column(String(255))
    legal_doc_uri: Mapped[str | None] = mapped_column(Text)
    sensitivity: Mapped[e.Sensitivity] = mapped_column(SensitivityT)
    subject_types: Mapped[list[e.SubjectType]] = mapped_column(ARRAY(SubjectTypeT))
    connection_config: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    secret_ref: Mapped[str | None] = mapped_column(String(255))
    file_template: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    schedule_cron: Mapped[str | None] = mapped_column(String(64))
    schedule_paused: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    # 0002: lần kiểm tra kết nối thành công gần nhất — điều kiện kích hoạt nguồn (AC04).
    connection_tested_at: Mapped[datetime | None] = mapped_column(TS)

    owner: Mapped[User] = relationship(lazy="joined", foreign_keys=[owner_user_id])


class IngestionBatch(Base):
    __tablename__ = "ingestion_batches"
    __table_args__ = (
        CheckConstraint("row_count >= 0", name="ingestion_batches_row_count_check"),
        # Không unique: AC05 cho phép ingest lại file trùng khi người dùng xác nhận.
        Index("ix_batches_checksum", "source_id", "checksum_sha256"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.data_sources.id"))
    file_name: Mapped[str | None] = mapped_column(String(255))
    checksum_sha256: Mapped[str] = mapped_column(CHAR(64))
    row_count: Mapped[int | None] = mapped_column(Integer)
    bronze_path: Mapped[str] = mapped_column(Text)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)


class SourceUpload(Base):
    """0002: file đã upload và kiểm tra header, chờ người dùng xác nhận ingest (US05)."""

    __tablename__ = "source_uploads"
    __table_args__ = (
        CheckConstraint("row_count >= 0", name="source_uploads_row_count_check"),
        CheckConstraint("size_bytes >= 0", name="source_uploads_size_bytes_check"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID)
    source_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.data_sources.id"))
    file_name: Mapped[str] = mapped_column(String(255))
    checksum_sha256: Mapped[str] = mapped_column(CHAR(64))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    row_count: Mapped[int] = mapped_column(Integer)
    storage_uri: Mapped[str] = mapped_column(Text)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    batch_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.ingestion_batches.id"))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"
    __table_args__ = (
        CheckConstraint("rows_read >= 0", name="pipeline_runs_rows_read_check"),
        CheckConstraint("rows_written >= 0", name="pipeline_runs_rows_written_check"),
        CheckConstraint("rows_quarantined >= 0", name="pipeline_runs_rows_quarantined_check"),
        CheckConstraint(
            "trigger NOT IN ('RERUN', 'REPROCESS') OR parent_run_id IS NOT NULL", name="pipeline_runs_check"
        ),
        CheckConstraint(
            "finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at", name="pipeline_runs_check1"
        ),
        CheckConstraint("status <> 'PARTIAL' OR rows_quarantined > 0", name="pipeline_runs_check2"),
        Index("ix_runs_source_time", "source_id", text("queued_at DESC")),
        Index("ix_runs_active", "status", postgresql_where=text("status IN ('QUEUED', 'RUNNING')")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID)
    source_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.data_sources.id"))
    batch_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.ingestion_batches.id"))
    parent_run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.pipeline_runs.id"))
    trigger: Mapped[e.RunTrigger] = mapped_column(RunTriggerT)
    status: Mapped[e.RunStatus] = mapped_column(RunStatusT, server_default=text("'QUEUED'"))
    orchestrator_run_id: Mapped[str | None] = mapped_column(String(64))
    rows_read: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    rows_written: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    rows_quarantined: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'"))
    error_message: Mapped[str | None] = mapped_column(Text)
    triggered_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    queued_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    started_at: Mapped[datetime | None] = mapped_column(TS)
    finished_at: Mapped[datetime | None] = mapped_column(TS)

    source: Mapped[DataSource] = relationship(lazy="joined")


# ───────────────────────── 3. Catalog & glossary ─────────────────────────
class GlossaryTerm(Base):
    __tablename__ = "glossary_terms"
    __table_args__ = (UniqueConstraint("name", name="glossary_terms_name_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    definition: Mapped[str] = mapped_column(Text)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    owner: Mapped[User | None] = relationship(lazy="joined")


class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (
        UniqueConstraint("layer", "schema_name", "table_name", name="datasets_layer_schema_name_table_name_key"),
        CheckConstraint("freshness_sla_minutes > 0", name="datasets_freshness_sla_minutes_check"),
        CheckConstraint("row_count >= 0", name="datasets_row_count_check"),
        CheckConstraint("dq_score BETWEEN 0 AND 100", name="datasets_dq_score_check"),
        Index("ix_datasets_tags", "tags", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    layer: Mapped[e.DataLayer] = mapped_column(DataLayerT)
    schema_name: Mapped[str] = mapped_column(String(64))
    table_name: Mapped[str] = mapped_column(String(128))
    display_name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    source_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.data_sources.id"))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    steward_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    freshness_sla_minutes: Mapped[int | None] = mapped_column(Integer)
    last_updated_at: Mapped[datetime | None] = mapped_column(TS)
    row_count: Mapped[int | None] = mapped_column(BigInteger)
    dq_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))

    owner: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[owner_user_id])
    steward: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[steward_user_id])
    source: Mapped[DataSource | None] = relationship(lazy="joined")
    columns: Mapped[list["DatasetColumn"]] = relationship(
        lazy="selectin", order_by="DatasetColumn.ordinal", passive_deletes=True
    )


class DatasetColumn(Base):
    __tablename__ = "dataset_columns"
    __table_args__ = (UniqueConstraint("dataset_id", "name", name="dataset_columns_dataset_id_name_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.datasets.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(128))
    data_type: Mapped[str] = mapped_column(String(64))
    ordinal: Mapped[int] = mapped_column(SmallInteger)
    description: Mapped[str | None] = mapped_column(Text)
    # BR07: chưa phân loại xử lý như CONFIDENTIAL.
    sensitivity: Mapped[e.Sensitivity] = mapped_column(SensitivityT, server_default=text("'CONFIDENTIAL'"))
    glossary_term_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.glossary_terms.id"))

    glossary_term: Mapped[GlossaryTerm | None] = relationship(lazy="joined")


class SchemaMapping(Base):
    __tablename__ = "schema_mappings"
    __table_args__ = (
        UniqueConstraint(
            "source_id", "target_dataset_id", "version", name="schema_mappings_source_id_target_dataset_id_version_key"
        ),
        CheckConstraint("version > 0", name="schema_mappings_version_check"),
        CheckConstraint("jsonb_typeof(mapping) = 'array'", name="schema_mappings_mapping_check"),
        # Mỗi cặp nguồn–dataset chỉ có một phiên bản mapping đang dùng.
        Index("uq_mapping_active", "source_id", "target_dataset_id", unique=True, postgresql_where=text("is_active")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.data_sources.id"))
    target_dataset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.datasets.id"))
    version: Mapped[int] = mapped_column(Integer)
    mapping: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    creator: Mapped[User] = relationship(lazy="joined")


# ───────────────────────── 4. Chất lượng dữ liệu ─────────────────────────
class DqRule(Base):
    __tablename__ = "dq_rules"
    __table_args__ = (
        CheckConstraint("rule_type <> 'CUSTOM_SQL' OR params ? 'sql'", name="dq_rules_check"),
        CheckConstraint("rule_type <> 'REGEX' OR params ? 'pattern'", name="dq_rules_check1"),
        CheckConstraint(
            "rule_type <> 'REFERENCE' OR (params ? 'ref_dataset' AND params ? 'ref_column')", name="dq_rules_check2"
        ),
        CheckConstraint(
            "rule_type IN ('CUSTOM_SQL', 'FRESHNESS') OR column_id IS NOT NULL", name="dq_rules_check3"
        ),
        Index("ix_dq_rules_dataset", "dataset_id", postgresql_where=text("status = 'ACTIVE'")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.datasets.id"))
    column_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.dataset_columns.id"))
    rule_type: Mapped[e.DqRuleType] = mapped_column(DqRuleTypeT)
    dimension: Mapped[e.DqDimension] = mapped_column(DqDimensionT)
    severity: Mapped[e.DqSeverity] = mapped_column(DqSeverityT)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[e.DqRuleStatus] = mapped_column(DqRuleStatusT, server_default=text("'DRAFT'"))
    version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    # 0002: phiên bản đã chạy thử thành công gần nhất — điều kiện kích hoạt (AC17).
    last_dry_run_version: Mapped[int | None] = mapped_column(Integer)


class DqRuleResult(Base):
    __tablename__ = "dq_rule_results"
    __table_args__ = (
        UniqueConstraint("rule_id", "run_id", name="dq_rule_results_rule_id_run_id_key"),
        CheckConstraint("evaluated_count >= 0", name="dq_rule_results_evaluated_count_check"),
        CheckConstraint("failed_count >= 0", name="dq_rule_results_failed_count_check"),
        CheckConstraint("failed_count <= evaluated_count", name="dq_rule_results_check"),
        Index("ix_dq_results_rule_time", "rule_id", text("evaluated_at DESC")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rule_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.dq_rules.id"))
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.pipeline_runs.id"))
    rule_version: Mapped[int] = mapped_column(Integer)
    evaluated_count: Mapped[int] = mapped_column(BigInteger)
    failed_count: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[e.DqResultStatus] = mapped_column(DqResultStatusT)
    sample_ref: Mapped[str | None] = mapped_column(Text)
    evaluated_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)


class DqIssue(Base):
    __tablename__ = "dq_issues"
    __table_args__ = (
        CheckConstraint("affected_rows >= 0", name="dq_issues_affected_rows_check"),
        CheckConstraint("(status IN ('RESOLVED', 'WONT_FIX')) = (resolved_at IS NOT NULL)", name="dq_issues_check"),
        Index("ix_dq_issues_open", "dataset_id", "status"),
        # Một quy tắc chỉ có một issue đang mở; lần chạy sau cập nhật last_run_id.
        Index(
            "uq_dq_issue_open_per_rule",
            "rule_id",
            unique=True,
            postgresql_where=text("status IN ('OPEN', 'IN_PROGRESS')"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rule_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.dq_rules.id"))
    dataset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.datasets.id"))
    first_run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.pipeline_runs.id"))
    last_run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.pipeline_runs.id"))
    affected_rows: Mapped[int] = mapped_column(BigInteger)
    severity: Mapped[e.DqSeverity] = mapped_column(DqSeverityT)
    status: Mapped[e.DqIssueStatus] = mapped_column(DqIssueStatusT, server_default=text("'OPEN'"))
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    resolved_at: Mapped[datetime | None] = mapped_column(TS)

    rule: Mapped[DqRule] = relationship(lazy="joined")
    assignee: Mapped[User | None] = relationship(lazy="joined")
    comments: Mapped[list["DqIssueComment"]] = relationship(
        lazy="selectin", order_by="DqIssueComment.created_at", passive_deletes=True
    )


class DqIssueComment(Base):
    __tablename__ = "dq_issue_comments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    issue_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.dq_issues.id", ondelete="CASCADE"))
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    author: Mapped[User] = relationship(lazy="joined")


# ───────────────────────── 5. Đối soát danh tính ─────────────────────────
class MatchCandidate(Base):
    __tablename__ = "match_candidates"
    __table_args__ = (
        UniqueConstraint(
            "left_source_code",
            "left_source_key",
            "right_source_code",
            "right_source_key",
            name="match_candidates_left_source_code_left_source_key_right_sou_key",
        ),
        CheckConstraint("score BETWEEN 0 AND 1", name="match_candidates_score_check"),
        CheckConstraint("left_person_id <> right_person_id", name="match_candidates_check"),
        # BR05: chỉ tự gộp khi điểm ≥ 0,95; vùng xám phải có người quyết định.
        CheckConstraint("status <> 'AUTO_MERGED' OR score >= 0.95", name="match_candidates_check1"),
        CheckConstraint("status NOT IN ('MERGED', 'REJECTED') OR decided_by IS NOT NULL", name="match_candidates_check2"),
        Index("ix_match_pending", text("score DESC"), postgresql_where=text("status = 'PENDING'")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    left_source_code: Mapped[str] = mapped_column(String(32))
    left_source_key: Mapped[str] = mapped_column(String(128))
    right_source_code: Mapped[str] = mapped_column(String(32))
    right_source_key: Mapped[str] = mapped_column(String(128))
    left_person_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    right_person_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    score: Mapped[Decimal] = mapped_column(Numeric(4, 3))
    feature_scores: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[e.MatchStatus] = mapped_column(MatchStatusT, server_default=text("'PENDING'"))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    decided_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)


class PersonMergeEvent(Base):
    __tablename__ = "person_merge_events"
    __table_args__ = (Index("ix_merge_events_person", "survivor_person_id", text("created_at DESC")),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    action: Mapped[e.MergeEventAction] = mapped_column(MergeEventActionT)
    survivor_person_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    merged_person_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    candidate_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.match_candidates.id"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    actor: Mapped[User | None] = relationship(lazy="joined")


# ───────────────────────── 6. Cấp quyền & chính sách ─────────────────────────
class AccessRequest(Base):
    __tablename__ = "access_requests"
    __table_args__ = (
        CheckConstraint("length(trim(purpose)) >= 10", name="access_requests_purpose_check"),
        CheckConstraint("requested_days BETWEEN 1 AND 180", name="access_requests_requested_days_check"),
        CheckConstraint("reviewer_id IS NULL OR reviewer_id <> requester_id", name="access_requests_check"),
        CheckConstraint(
            "status <> 'REJECTED' OR length(trim(coalesce(review_note, ''))) > 0", name="access_requests_check1"
        ),
        Index("ix_access_requests_queue", "resource_type", "resource_id", postgresql_where=text("status = 'PENDING'")),
        Index("ix_access_requests_requester", "requester_id", text("created_at DESC")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    requester_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    resource_type: Mapped[e.ResourceType] = mapped_column(ResourceTypeT)
    resource_id: Mapped[str] = mapped_column(String(128))
    access_level: Mapped[e.AccessLevel] = mapped_column(AccessLevelT, server_default=text("'READ'"))
    purpose: Mapped[str] = mapped_column(Text)
    scope: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    requested_days: Mapped[int] = mapped_column(SmallInteger)
    status: Mapped[e.AccessRequestStatus] = mapped_column(AccessRequestStatusT, server_default=text("'PENDING'"))
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    review_note: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    requester: Mapped[User] = relationship(lazy="joined", foreign_keys=[requester_id])
    reviewer: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[reviewer_id])


class AccessGrant(Base):
    __tablename__ = "access_grants"
    __table_args__ = (
        CheckConstraint(
            "valid_to > valid_from AND valid_to <= valid_from + interval '180 days'", name="access_grants_check"
        ),
        Index(
            "ix_grants_lookup", "user_id", "resource_type", "resource_id", postgresql_where=text("revoked_at IS NULL")
        ),
        Index("ix_grants_expiry", "valid_to", postgresql_where=text("revoked_at IS NULL")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    resource_type: Mapped[e.ResourceType] = mapped_column(ResourceTypeT)
    resource_id: Mapped[str] = mapped_column(String(128))
    access_level: Mapped[e.AccessLevel] = mapped_column(AccessLevelT)
    scope: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    request_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.access_requests.id"))
    granted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    valid_from: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    valid_to: Mapped[datetime] = mapped_column(TS)
    revoked_at: Mapped[datetime | None] = mapped_column(TS)

    granter: Mapped[User] = relationship(lazy="joined", foreign_keys=[granted_by])


class AccessPolicy(Base):
    __tablename__ = "access_policies"
    __table_args__ = (UniqueConstraint("name", name="access_policies_name_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    dataset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.datasets.id"))
    role_code: Mapped[e.RoleCode] = mapped_column(RoleCodeT)
    current_version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)


class AccessPolicyVersion(Base):
    __tablename__ = "access_policy_versions"
    __table_args__ = (
        CheckConstraint("version > 0", name="access_policy_versions_version_check"),
        CheckConstraint("jsonb_typeof(column_rules) = 'array'", name="access_policy_versions_column_rules_check"),
    )

    policy_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.access_policies.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    row_filter: Mapped[str | None] = mapped_column(Text)
    column_rules: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'"))
    change_note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    creator: Mapped[User] = relationship(lazy="joined")


# ───────────────────────── 7. BI & semantic model ─────────────────────────
class SemanticDimension(Base):
    __tablename__ = "semantic_dimensions"
    __table_args__ = (UniqueConstraint("code", name="semantic_dimensions_code_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(255))
    dataset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.datasets.id"))
    column_name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text)


class SemanticMetric(Base):
    __tablename__ = "semantic_metrics"
    __table_args__ = (
        UniqueConstraint("code", name="semantic_metrics_code_key"),
        CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name="semantic_metrics_code_check"),
        CheckConstraint(
            "status <> 'CERTIFIED' OR (certified_by IS NOT NULL AND certified_at IS NOT NULL)",
            name="semantic_metrics_check",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(255))
    definition: Mapped[str] = mapped_column(Text)
    expression: Mapped[str] = mapped_column(Text)
    base_dataset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.datasets.id"))
    allowed_dimensions: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))
    unit: Mapped[str | None] = mapped_column(String(32))
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    glossary_term_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.glossary_terms.id"))
    status: Mapped[e.MetricStatus] = mapped_column(MetricStatusT, server_default=text("'DRAFT'"))
    version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    certified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    certified_at: Mapped[datetime | None] = mapped_column(TS)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    owner: Mapped[User] = relationship(lazy="joined", foreign_keys=[owner_id])
    certifier: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[certified_by])
    base_dataset: Mapped[Dataset] = relationship(lazy="joined")


class SemanticMetricVersion(Base):
    __tablename__ = "semantic_metric_versions"

    metric_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.semantic_metrics.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    expression: Mapped[str] = mapped_column(Text)
    definition: Mapped[str] = mapped_column(Text)
    changed_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    changed_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    changer: Mapped[User] = relationship(lazy="joined")


class Dashboard(Base):
    __tablename__ = "dashboards"
    __table_args__ = (
        CheckConstraint(
            "topic IN ('TRAINING', 'HR', 'RESEARCH', 'FINANCE', 'DATA_QUALITY')", name="dashboards_topic_check"
        ),
        CheckConstraint("status <> 'PUBLISHED' OR published_at IS NOT NULL", name="dashboards_check"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    topic: Mapped[str] = mapped_column(String(64))
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    status: Mapped[e.DashboardStatus] = mapped_column(DashboardStatusT, server_default=text("'DRAFT'"))
    global_filters: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'"))
    version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    published_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    owner: Mapped[User] = relationship(lazy="joined")
    widgets: Mapped[list["DashboardWidget"]] = relationship(
        lazy="selectin", order_by="DashboardWidget.id", cascade="all, delete-orphan", passive_deletes=True
    )
    shares: Mapped[list["DashboardShare"]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )


class DashboardWidget(Base):
    __tablename__ = "dashboard_widgets"
    __table_args__ = (
        CheckConstraint(
            "type IN ('KPI', 'BAR', 'LINE', 'PIE', 'HEATMAP', 'TABLE')", name="dashboard_widgets_type_check"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    dashboard_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.dashboards.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(255))
    query_spec: Mapped[dict[str, Any]] = mapped_column(JSONB)
    position: Mapped[dict[str, Any]] = mapped_column(JSONB)


class DashboardShare(Base):
    __tablename__ = "dashboard_shares"

    dashboard_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.dashboards.id", ondelete="CASCADE"), primary_key=True
    )
    principal_type: Mapped[e.PrincipalType] = mapped_column(PrincipalTypeT, primary_key=True)
    principal_id: Mapped[str] = mapped_column(String(128), primary_key=True)


class DashboardFavorite(Base):
    __tablename__ = "dashboard_favorites"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk(ondelete="CASCADE"), primary_key=True)
    dashboard_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.dashboards.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)


class ExportJob(Base):
    """0002: tác vụ export dashboard bất đồng bộ (US29); file hết hạn sau 15 phút."""

    __tablename__ = "export_jobs"
    __table_args__ = (Index("ix_export_jobs_requester", "requested_by", text("created_at DESC")),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID)
    dashboard_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.dashboards.id", ondelete="CASCADE"))
    widget_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.dashboard_widgets.id", ondelete="SET NULL"))
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    format: Mapped[e.ExportFormat] = mapped_column(ExportFormatT)
    status: Mapped[e.ExportStatus] = mapped_column(ExportStatusT, server_default=text("'PENDING'"))
    filters: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'"))
    watermark: Mapped[str] = mapped_column(String(255))
    excluded_columns: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))
    storage_uri: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)


class ReportSubscription(Base):
    __tablename__ = "report_subscriptions"
    __table_args__ = (Index("ix_subscriptions_due", "next_run_at", postgresql_where=text("status = 'ACTIVE'")),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    dashboard_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.dashboards.id"))
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    cron: Mapped[str] = mapped_column(String(64))
    format: Mapped[e.ReportFormat] = mapped_column(ReportFormatT, server_default=text("'PDF'"))
    filters: Mapped[Any] = mapped_column(JSONB, server_default=text("'{}'"))
    include_ai_summary: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    status: Mapped[e.SubscriptionStatus] = mapped_column(SubscriptionStatusT, server_default=text("'ACTIVE'"))
    next_run_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    recipients: Mapped[list["SubscriptionRecipient"]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )


class SubscriptionRecipient(Base):
    __tablename__ = "subscription_recipients"

    subscription_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.report_subscriptions.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk(), primary_key=True)


class ReportDelivery(Base):
    __tablename__ = "report_deliveries"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.report_subscriptions.id", ondelete="CASCADE")
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    status: Mapped[e.DeliveryStatus] = mapped_column(DeliveryStatusT)
    artifact_uri: Mapped[str | None] = mapped_column(Text)
    ai_summary: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    recipient: Mapped[User] = relationship(lazy="joined")


# ───────────────────────── 8. Bất thường & lineage ─────────────────────────
class AnomalyDetector(Base):
    __tablename__ = "anomaly_detectors"
    __table_args__ = (
        CheckConstraint("num_nonnulls(dataset_id, metric_id) = 1", name="anomaly_detectors_check"),
        CheckConstraint("kind <> 'METRIC_DRIFT' OR metric_id IS NOT NULL", name="anomaly_detectors_check1"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[e.DetectorKind] = mapped_column(DetectorKindT)
    dataset_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.datasets.id"))
    metric_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.semantic_metrics.id"))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    dataset: Mapped[Dataset | None] = relationship(lazy="joined")
    metric: Mapped[SemanticMetric | None] = relationship(lazy="joined")


class AnomalyAlert(Base):
    __tablename__ = "anomaly_alerts"
    __table_args__ = (
        CheckConstraint(
            "status = 'OPEN' OR status = 'DISMISSED' OR acknowledged_by IS NOT NULL", name="anomaly_alerts_check"
        ),
        CheckConstraint(
            "(status IN ('RESOLVED', 'DISMISSED')) = (closed_at IS NOT NULL)", name="anomaly_alerts_check1"
        ),
        Index("ix_alerts_open", text("detected_at DESC"), postgresql_where=text("status IN ('OPEN', 'ACKNOWLEDGED')")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    detector_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.anomaly_detectors.id"))
    run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.pipeline_runs.id"))
    observed_value: Mapped[Decimal] = mapped_column(Numeric)
    expected_low: Mapped[Decimal | None] = mapped_column(Numeric)
    expected_high: Mapped[Decimal | None] = mapped_column(Numeric)
    severity: Mapped[e.AlertSeverity] = mapped_column(AlertSeverityT)
    status: Mapped[e.AlertStatus] = mapped_column(AlertStatusT, server_default=text("'OPEN'"))
    note: Mapped[str | None] = mapped_column(Text)
    detected_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    acknowledged_at: Mapped[datetime | None] = mapped_column(TS)
    closed_at: Mapped[datetime | None] = mapped_column(TS)

    detector: Mapped[AnomalyDetector] = relationship(lazy="joined")
    acknowledger: Mapped[User | None] = relationship(lazy="joined")


class LineageNode(Base):
    __tablename__ = "lineage_nodes"
    __table_args__ = (UniqueConstraint("node_type", "ref_id", name="lineage_nodes_node_type_ref_id_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    node_type: Mapped[e.LineageNodeType] = mapped_column(LineageNodeTypeT)
    ref_id: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(255))


class LineageEdge(Base):
    __tablename__ = "lineage_edges"
    __table_args__ = (
        UniqueConstraint("from_node_id", "to_node_id", name="lineage_edges_from_node_id_to_node_id_key"),
        CheckConstraint("from_node_id <> to_node_id", name="lineage_edges_check"),
        Index("ix_lineage_to", "to_node_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    from_node_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.lineage_nodes.id", ondelete="CASCADE"))
    to_node_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.lineage_nodes.id", ondelete="CASCADE"))
    transform_ref: Mapped[str | None] = mapped_column(String(255))
    observed_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)


# ───────────────────────── 9. Hỏi-đáp, thông báo, audit ─────────────────────────
class QaConversation(Base):
    __tablename__ = "qa_conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    title: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    # 0002: ngữ cảnh dashboard khi mở trợ lý từ một dashboard.
    dashboard_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.dashboards.id", ondelete="SET NULL")
    )


class QaMessage(Base):
    __tablename__ = "qa_messages"
    __table_args__ = (
        CheckConstraint("latency_ms >= 0", name="qa_messages_latency_ms_check"),
        CheckConstraint("feedback IN (-1, 1)", name="qa_messages_feedback_check"),
        CheckConstraint("(role = 'USER') = (status IS NULL)", name="qa_messages_check"),
        CheckConstraint("status <> 'REFUSED' OR refusal_reason IS NOT NULL", name="qa_messages_check1"),
        # BR16: câu trả lời luôn kèm metric và thời điểm dữ liệu.
        CheckConstraint(
            "status <> 'ANSWERED' OR (cardinality(metric_codes) > 0 AND data_as_of IS NOT NULL)",
            name="qa_messages_check2",
        ),
        Index("ix_qa_messages_conv", "conversation_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.qa_conversations.id", ondelete="CASCADE")
    )
    role: Mapped[e.QaRole] = mapped_column(QaRoleT)
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[e.QaStatus | None] = mapped_column(QaStatusT)
    semantic_query: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    compiled_sql: Mapped[str | None] = mapped_column(Text)
    metric_codes: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))
    data_as_of: Mapped[datetime | None] = mapped_column(TS)
    refusal_reason: Mapped[str | None] = mapped_column(String(64))
    model: Mapped[str | None] = mapped_column(String(64))
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    feedback: Mapped[int | None] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)
    # 0002: phần còn lại của câu trả lời (kết quả, biểu đồ, câu hỏi làm rõ) và ghi chú phản hồi.
    extras: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    feedback_comment: Mapped[str | None] = mapped_column(Text)


class QaBlockedTopic(Base):
    __tablename__ = "qa_blocked_topics"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    pattern: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk())
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)

    creator: Mapped[User] = relationship(lazy="joined")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_unread", "user_id", text("created_at DESC"), postgresql_where=text("read_at IS NULL")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), users_fk(ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    link: Mapped[str | None] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=NOW)


class AuditLog(Base):
    """BR10: audit log bất biến (trigger chặn UPDATE/DELETE), phân vùng theo tháng."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_actor", "actor_id", text("occurred_at DESC")),
        Index("ix_audit_object", "object_type", "object_id"),
        {"postgresql_partition_by": "RANGE (occurred_at)"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(TS, primary_key=True, server_default=NOW)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), users_fk())
    action: Mapped[str] = mapped_column(String(64))
    object_type: Mapped[str] = mapped_column(String(64))
    object_id: Mapped[str | None] = mapped_column(String(128))
    outcome: Mapped[e.AuditOutcome] = mapped_column(AuditOutcomeT)
    ip: Mapped[str | None] = mapped_column(INET)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))

    actor: Mapped[User | None] = relationship(lazy="joined")


# View chỉ đọc (tạo bằng migration, không quản lý bởi autogenerate).
VIEWS = ("v_effective_grants", "v_stale_datasets")
