"""Enum nghiệp vụ — giá trị trùng enum PostgreSQL trong schema app."""

from enum import StrEnum


class UserStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class RoleCode(StrEnum):
    PLATFORM_ADMIN = "PLATFORM_ADMIN"
    DATA_ENGINEER = "DATA_ENGINEER"
    DATA_STEWARD = "DATA_STEWARD"
    BI_ANALYST = "BI_ANALYST"
    REPORT_VIEWER = "REPORT_VIEWER"


class OrgUnitType(StrEnum):
    UNIVERSITY = "UNIVERSITY"
    FACULTY = "FACULTY"
    DEPARTMENT = "DEPARTMENT"
    OFFICE = "OFFICE"
    CENTER = "CENTER"


class SourceType(StrEnum):
    FILE = "FILE"
    JDBC = "JDBC"
    API = "API"


class SourceStatus(StrEnum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    ARCHIVED = "ARCHIVED"


class Sensitivity(StrEnum):
    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"
    CONFIDENTIAL = "CONFIDENTIAL"
    RESTRICTED = "RESTRICTED"


SENSITIVITY_RANK = {Sensitivity.PUBLIC: 0, Sensitivity.INTERNAL: 1, Sensitivity.CONFIDENTIAL: 2, Sensitivity.RESTRICTED: 3}


class SubjectType(StrEnum):
    STUDENT = "STUDENT"
    LECTURER = "LECTURER"
    STAFF = "STAFF"


class RunTrigger(StrEnum):
    MANUAL = "MANUAL"
    SCHEDULE = "SCHEDULE"
    RERUN = "RERUN"
    REPROCESS = "REPROCESS"


class RunStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class DataLayer(StrEnum):
    BRONZE = "BRONZE"
    SILVER = "SILVER"
    GOLD = "GOLD"
    QUARANTINE = "QUARANTINE"


class DqRuleType(StrEnum):
    NOT_NULL = "NOT_NULL"
    UNIQUE = "UNIQUE"
    RANGE = "RANGE"
    REGEX = "REGEX"
    REFERENCE = "REFERENCE"
    FRESHNESS = "FRESHNESS"
    CUSTOM_SQL = "CUSTOM_SQL"


class DqDimension(StrEnum):
    COMPLETENESS = "COMPLETENESS"
    UNIQUENESS = "UNIQUENESS"
    VALIDITY = "VALIDITY"
    CONSISTENCY = "CONSISTENCY"
    TIMELINESS = "TIMELINESS"


class DqSeverity(StrEnum):
    BLOCKING = "BLOCKING"
    WARNING = "WARNING"


class DqRuleStatus(StrEnum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"


class DqResultStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    ERROR = "ERROR"


class DqIssueStatus(StrEnum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    WONT_FIX = "WONT_FIX"


class MatchStatus(StrEnum):
    PENDING = "PENDING"
    AUTO_MERGED = "AUTO_MERGED"
    MERGED = "MERGED"
    REJECTED = "REJECTED"
    UNMERGED = "UNMERGED"


class MergeEventAction(StrEnum):
    MERGE = "MERGE"
    UNMERGE = "UNMERGE"


class ResourceType(StrEnum):
    DATASET = "DATASET"
    DASHBOARD = "DASHBOARD"
    PROFILE_FACET = "PROFILE_FACET"
    METRIC = "METRIC"


class AccessLevel(StrEnum):
    READ = "READ"
    EXPORT = "EXPORT"


class AccessRequestStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"


class DashboardStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"


class PrincipalType(StrEnum):
    ROLE = "ROLE"
    ORG_UNIT = "ORG_UNIT"
    USER = "USER"


class MetricStatus(StrEnum):
    DRAFT = "DRAFT"
    CERTIFIED = "CERTIFIED"
    DEPRECATED = "DEPRECATED"


class ReportFormat(StrEnum):
    PDF = "PDF"
    LINK = "LINK"


class SubscriptionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"


class DeliveryStatus(StrEnum):
    SENT = "SENT"
    SKIPPED_NO_ACCESS = "SKIPPED_NO_ACCESS"
    FAILED = "FAILED"


class DetectorKind(StrEnum):
    VOLUME = "VOLUME"
    FRESHNESS = "FRESHNESS"
    METRIC_DRIFT = "METRIC_DRIFT"


class AlertSeverity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class AlertStatus(StrEnum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"


class LineageNodeType(StrEnum):
    SOURCE = "SOURCE"
    DATASET = "DATASET"
    COLUMN = "COLUMN"
    METRIC = "METRIC"
    DASHBOARD = "DASHBOARD"


class QaRole(StrEnum):
    USER = "USER"
    ASSISTANT = "ASSISTANT"


class QaStatus(StrEnum):
    ANSWERED = "ANSWERED"
    CLARIFYING = "CLARIFYING"
    REFUSED = "REFUSED"
    FAILED = "FAILED"


class AuditOutcome(StrEnum):
    ALLOW = "ALLOW"
    DENY = "DENY"


class ExportStatus(StrEnum):
    PENDING = "PENDING"
    READY = "READY"
    FAILED = "FAILED"


class ExportFormat(StrEnum):
    PDF = "PDF"
    CSV = "CSV"


# Thứ tự tạo enum trong migration (tên kiểu PostgreSQL → lớp Python).
PG_ENUMS: dict[str, type[StrEnum]] = {
    "user_status": UserStatus,
    "role_code": RoleCode,
    "org_unit_type": OrgUnitType,
    "source_type": SourceType,
    "source_status": SourceStatus,
    "sensitivity_level": Sensitivity,
    "subject_type": SubjectType,
    "run_trigger": RunTrigger,
    "run_status": RunStatus,
    "data_layer": DataLayer,
    "dq_rule_type": DqRuleType,
    "dq_dimension": DqDimension,
    "dq_severity": DqSeverity,
    "dq_rule_status": DqRuleStatus,
    "dq_result_status": DqResultStatus,
    "dq_issue_status": DqIssueStatus,
    "match_status": MatchStatus,
    "merge_event_action": MergeEventAction,
    "resource_type": ResourceType,
    "access_level": AccessLevel,
    "access_request_status": AccessRequestStatus,
    "dashboard_status": DashboardStatus,
    "principal_type": PrincipalType,
    "metric_status": MetricStatus,
    "report_format": ReportFormat,
    "subscription_status": SubscriptionStatus,
    "delivery_status": DeliveryStatus,
    "detector_kind": DetectorKind,
    "alert_severity": AlertSeverity,
    "alert_status": AlertStatus,
    "lineage_node_type": LineageNodeType,
    "qa_role": QaRole,
    "qa_status": QaStatus,
    "audit_outcome": AuditOutcome,
}
