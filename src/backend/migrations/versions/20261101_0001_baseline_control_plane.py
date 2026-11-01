"""Baseline control plane: toàn bộ schema app tương đương src/database/aiia.sql.

CSDL đã dựng bằng aiia.sql (volume Postgres cũ) không chạy lại revision này mà đánh dấu:
    uv run alembic stamp 0001_baseline && uv run alembic upgrade head

Migration là ảnh chụp bất biến: giá trị enum, hàm, view được ghi trực tiếp ở đây,
không import từ mã ứng dụng (mã có thể đổi về sau).

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENUMS: dict[str, tuple[str, ...]] = {
    "user_status": ("ACTIVE", "INACTIVE"),
    "role_code": ("PLATFORM_ADMIN", "DATA_ENGINEER", "DATA_STEWARD", "BI_ANALYST", "REPORT_VIEWER"),
    "org_unit_type": ("UNIVERSITY", "FACULTY", "DEPARTMENT", "OFFICE", "CENTER"),
    "source_type": ("FILE", "JDBC", "API"),
    "source_status": ("DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"),
    "sensitivity_level": ("PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"),
    "subject_type": ("STUDENT", "LECTURER", "STAFF"),
    "run_trigger": ("MANUAL", "SCHEDULE", "RERUN", "REPROCESS"),
    "run_status": ("QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"),
    "data_layer": ("BRONZE", "SILVER", "GOLD", "QUARANTINE"),
    "dq_rule_type": ("NOT_NULL", "UNIQUE", "RANGE", "REGEX", "REFERENCE", "FRESHNESS", "CUSTOM_SQL"),
    "dq_dimension": ("COMPLETENESS", "UNIQUENESS", "VALIDITY", "CONSISTENCY", "TIMELINESS"),
    "dq_severity": ("BLOCKING", "WARNING"),
    "dq_rule_status": ("DRAFT", "ACTIVE", "DISABLED"),
    "dq_result_status": ("PASS", "FAIL", "ERROR"),
    "dq_issue_status": ("OPEN", "IN_PROGRESS", "RESOLVED", "WONT_FIX"),
    "match_status": ("PENDING", "AUTO_MERGED", "MERGED", "REJECTED", "UNMERGED"),
    "merge_event_action": ("MERGE", "UNMERGE"),
    "resource_type": ("DATASET", "DASHBOARD", "PROFILE_FACET", "METRIC"),
    "access_level": ("READ", "EXPORT"),
    "access_request_status": ("PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "REVOKED"),
    "dashboard_status": ("DRAFT", "PUBLISHED", "ARCHIVED"),
    "principal_type": ("ROLE", "ORG_UNIT", "USER"),
    "metric_status": ("DRAFT", "CERTIFIED", "DEPRECATED"),
    "report_format": ("PDF", "LINK"),
    "subscription_status": ("ACTIVE", "PAUSED"),
    "delivery_status": ("SENT", "SKIPPED_NO_ACCESS", "FAILED"),
    "detector_kind": ("VOLUME", "FRESHNESS", "METRIC_DRIFT"),
    "alert_severity": ("LOW", "MEDIUM", "HIGH"),
    "alert_status": ("OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"),
    "lineage_node_type": ("SOURCE", "DATASET", "COLUMN", "METRIC", "DASHBOARD"),
    "qa_role": ("USER", "ASSISTANT"),
    "qa_status": ("ANSWERED", "CLARIFYING", "REFUSED", "FAILED"),
    "audit_outcome": ("ALLOW", "DENY"),
}

# Bảng có cột updated_at tự cập nhật: (bảng, tên trigger).
UPDATED_AT_TRIGGERS = (
    ("users", "trg_users_updated"),
    ("data_sources", "trg_sources_updated"),
    ("glossary_terms", "trg_glossary_updated"),
    ("dq_rules", "trg_dq_rules_updated"),
    ("semantic_metrics", "trg_metrics_updated"),
    ("dashboards", "trg_dashboards_updated"),
)


def _create_enums() -> None:
    for name, values in ENUMS.items():
        labels = ", ".join(f"'{v}'" for v in values)
        op.execute(f"CREATE TYPE app.{name} AS ENUM ({labels})")


def _drop_enums() -> None:
    for name in reversed(ENUMS):
        op.execute(f"DROP TYPE app.{name}")


def _create_sql_objects() -> None:
    # Cập nhật updated_at tự động.
    op.execute(
        """
        CREATE FUNCTION app.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          NEW.updated_at := now();
          RETURN NEW;
        END $$
        """
    )
    for table, trigger in UPDATED_AT_TRIGGERS:
        op.execute(
            f"CREATE TRIGGER {trigger} BEFORE UPDATE ON app.{table} "
            "FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()"
        )

    # AC24: không được gỡ vai trò của PLATFORM_ADMIN cuối cùng.
    op.execute(
        """
        CREATE FUNCTION app.guard_last_admin() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.role_code = 'PLATFORM_ADMIN' AND NOT EXISTS (
               SELECT 1 FROM app.user_roles r JOIN app.users u ON u.id = r.user_id
               WHERE r.role_code = 'PLATFORM_ADMIN' AND r.id <> OLD.id AND u.status = 'ACTIVE') THEN
            RAISE EXCEPTION 'Không thể gỡ vai trò PLATFORM_ADMIN cuối cùng' USING ERRCODE = 'check_violation';
          END IF;
          RETURN OLD;
        END $$
        """
    )
    op.execute(
        "CREATE TRIGGER trg_user_roles_last_admin BEFORE DELETE ON app.user_roles "
        "FOR EACH ROW EXECUTE FUNCTION app.guard_last_admin()"
    )

    # BR10: audit log bất biến, phân vùng theo tháng (worker tạo partition tháng kế tiếp).
    op.execute(
        "CREATE TABLE app.audit_logs_2026_11 PARTITION OF app.audit_logs "
        "FOR VALUES FROM ('2026-11-01') TO ('2026-12-01')"
    )
    op.execute(
        "CREATE TABLE app.audit_logs_2026_12 PARTITION OF app.audit_logs "
        "FOR VALUES FROM ('2026-12-01') TO ('2027-01-01')"
    )
    op.execute("CREATE TABLE app.audit_logs_default PARTITION OF app.audit_logs DEFAULT")
    op.execute(
        """
        CREATE FUNCTION app.forbid_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'audit_logs chỉ cho phép INSERT' USING ERRCODE = 'insufficient_privilege';
        END $$
        """
    )
    op.execute(
        "CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON app.audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION app.forbid_audit_change()"
    )

    # Quyền dữ liệu đang hiệu lực (AC03, BR08).
    op.execute(
        """
        CREATE VIEW app.v_effective_grants AS
        SELECT g.id, g.user_id, g.resource_type, g.resource_id, g.access_level, g.scope, g.valid_from, g.valid_to
        FROM app.access_grants g
        JOIN app.users u ON u.id = g.user_id AND u.status = 'ACTIVE'
        WHERE g.revoked_at IS NULL AND now() BETWEEN g.valid_from AND g.valid_to
        """
    )
    # Dataset vượt SLA độ mới (BR15).
    op.execute(
        """
        CREATE VIEW app.v_stale_datasets AS
        SELECT d.id, d.layer, d.schema_name, d.table_name, d.last_updated_at, d.freshness_sla_minutes
        FROM app.datasets d
        WHERE d.freshness_sla_minutes IS NOT NULL
          AND (d.last_updated_at IS NULL OR d.last_updated_at < now() - make_interval(mins => d.freshness_sla_minutes))
        """
    )
    # Worker gọi hằng giờ: đánh dấu yêu cầu đã hết hạn (BR09). Trả về số yêu cầu được cập nhật.
    op.execute(
        """
        CREATE FUNCTION app.expire_access() RETURNS integer LANGUAGE plpgsql AS $$
        DECLARE n integer;
        BEGIN
          UPDATE app.access_requests r SET status = 'EXPIRED'
          FROM app.access_grants g
          WHERE g.request_id = r.id AND r.status = 'APPROVED' AND g.revoked_at IS NULL AND g.valid_to < now();
          GET DIAGNOSTICS n = ROW_COUNT;
          RETURN n;
        END $$
        """
    )


def _drop_sql_objects() -> None:
    op.execute("DROP FUNCTION app.expire_access()")
    op.execute("DROP VIEW app.v_stale_datasets")
    op.execute("DROP VIEW app.v_effective_grants")
    op.execute("DROP TRIGGER trg_audit_immutable ON app.audit_logs")
    op.execute("DROP FUNCTION app.forbid_audit_change()")
    op.execute("DROP TABLE app.audit_logs_default, app.audit_logs_2026_12, app.audit_logs_2026_11")
    op.execute("DROP TRIGGER trg_user_roles_last_admin ON app.user_roles")
    op.execute("DROP FUNCTION app.guard_last_admin()")
    for table, trigger in UPDATED_AT_TRIGGERS:
        op.execute(f"DROP TRIGGER {trigger} ON app.{table}")
    op.execute("DROP FUNCTION app.set_updated_at()")


def _seed_reference_data() -> None:
    # Dữ liệu tham chiếu tối thiểu: cây đơn vị mẫu, tài khoản hệ thống, chủ đề chặn mặc định.
    op.execute("INSERT INTO app.org_units (code, name, type) VALUES ('UNI', 'Trường Đại học (mẫu)', 'UNIVERSITY')")
    op.execute(
        """
        INSERT INTO app.org_units (code, name, type, parent_id)
        SELECT v.code, v.name, v.type::app.org_unit_type, (SELECT id FROM app.org_units WHERE code = 'UNI')
        FROM (VALUES
          ('CNTT', 'Khoa Công nghệ thông tin', 'FACULTY'),
          ('KT',   'Khoa Kinh tế',             'FACULTY'),
          ('NN',   'Khoa Ngoại ngữ',           'FACULTY'),
          ('PDT',  'Phòng Đào tạo',            'OFFICE'),
          ('TCCB', 'Phòng Tổ chức cán bộ',     'OFFICE'),
          ('KHCN', 'Phòng Khoa học công nghệ', 'OFFICE'),
          ('TTDL', 'Trung tâm Dữ liệu',        'CENTER')
        ) AS v(code, name, type)
        """
    )
    op.execute(
        """
        INSERT INTO app.users (sso_subject, email, full_name, org_unit_id)
        VALUES ('system', 'system@aiia.local', 'AiiA System', (SELECT id FROM app.org_units WHERE code = 'TTDL'))
        """
    )
    op.execute(
        """
        INSERT INTO app.qa_blocked_topics (pattern, description, created_by)
        SELECT p, d, (SELECT id FROM app.users WHERE sso_subject = 'system')
        FROM (VALUES
          ('danh sách cá nhân kèm CCCD',   'Không trả định danh RESTRICTED'),
          ('xếp hạng cá nhân theo lương',  'Dữ liệu lương cá nhân'),
          ('sức khỏe|bệnh án',             'Dữ liệu sức khỏe ngoài phạm vi')
        ) AS t(p, d)
        """
    )

def upgrade() -> None:
    _create_enums()

    op.create_table('lineage_nodes',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('node_type', postgresql.ENUM('SOURCE', 'DATASET', 'COLUMN', 'METRIC', 'DASHBOARD', name='lineage_node_type', create_type=False, schema='app'), nullable=False),
        sa.Column('ref_id', sa.String(length=128), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('lineage_nodes_pkey')),
        sa.UniqueConstraint('node_type', 'ref_id', name='lineage_nodes_node_type_ref_id_key'),
        schema='app'
    )
    op.create_table('org_units',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('code', sa.String(length=32), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('type', postgresql.ENUM('UNIVERSITY', 'FACULTY', 'DEPARTMENT', 'OFFICE', 'CENTER', name='org_unit_type', create_type=False, schema='app'), nullable=False),
        sa.Column('parent_id', sa.BigInteger(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.CheckConstraint('parent_id IS NULL OR parent_id <> id', name='org_units_check'),
        sa.ForeignKeyConstraint(['parent_id'], ['app.org_units.id'], name=op.f('org_units_parent_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('org_units_pkey')),
        sa.UniqueConstraint('code', name='org_units_code_key'),
        schema='app'
    )
    op.create_table('lineage_edges',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('from_node_id', sa.BigInteger(), nullable=False),
        sa.Column('to_node_id', sa.BigInteger(), nullable=False),
        sa.Column('transform_ref', sa.String(length=255), nullable=True),
        sa.Column('observed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('from_node_id <> to_node_id', name='lineage_edges_check'),
        sa.ForeignKeyConstraint(['from_node_id'], ['app.lineage_nodes.id'], name=op.f('lineage_edges_from_node_id_fkey'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['to_node_id'], ['app.lineage_nodes.id'], name=op.f('lineage_edges_to_node_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('lineage_edges_pkey')),
        sa.UniqueConstraint('from_node_id', 'to_node_id', name='lineage_edges_from_node_id_to_node_id_key'),
        schema='app'
    )
    op.create_index('ix_lineage_to', 'lineage_edges', ['to_node_id'], unique=False, schema='app')
    op.create_table('users',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('sso_subject', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=False),
        sa.Column('org_unit_id', sa.BigInteger(), nullable=True),
        sa.Column('status', postgresql.ENUM('ACTIVE', 'INACTIVE', name='user_status', create_type=False, schema='app'), server_default=sa.text("'ACTIVE'"), nullable=False),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['org_unit_id'], ['app.org_units.id'], name=op.f('users_org_unit_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('users_pkey')),
        sa.UniqueConstraint('email', name='users_email_key'),
        sa.UniqueConstraint('sso_subject', name='users_sso_subject_key'),
        schema='app'
    )
    op.create_table('access_requests',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('requester_id', sa.UUID(), nullable=False),
        sa.Column('resource_type', postgresql.ENUM('DATASET', 'DASHBOARD', 'PROFILE_FACET', 'METRIC', name='resource_type', create_type=False, schema='app'), nullable=False),
        sa.Column('resource_id', sa.String(length=128), nullable=False),
        sa.Column('access_level', postgresql.ENUM('READ', 'EXPORT', name='access_level', create_type=False, schema='app'), server_default=sa.text("'READ'"), nullable=False),
        sa.Column('purpose', sa.Text(), nullable=False),
        sa.Column('scope', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('requested_days', sa.SmallInteger(), nullable=False),
        sa.Column('status', postgresql.ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REVOKED', name='access_request_status', create_type=False, schema='app'), server_default=sa.text("'PENDING'"), nullable=False),
        sa.Column('reviewer_id', sa.UUID(), nullable=True),
        sa.Column('review_note', sa.Text(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("status <> 'REJECTED' OR length(trim(coalesce(review_note, ''))) > 0", name='access_requests_check1'),
        sa.CheckConstraint('length(trim(purpose)) >= 10', name='access_requests_purpose_check'),
        sa.CheckConstraint('requested_days BETWEEN 1 AND 180', name='access_requests_requested_days_check'),
        sa.CheckConstraint('reviewer_id IS NULL OR reviewer_id <> requester_id', name='access_requests_check'),
        sa.ForeignKeyConstraint(['requester_id'], ['app.users.id'], name=op.f('access_requests_requester_id_fkey')),
        sa.ForeignKeyConstraint(['reviewer_id'], ['app.users.id'], name=op.f('access_requests_reviewer_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('access_requests_pkey')),
        schema='app'
    )
    op.create_index('ix_access_requests_queue', 'access_requests', ['resource_type', 'resource_id'], unique=False, schema='app', postgresql_where=sa.text("status = 'PENDING'"))
    op.create_index('ix_access_requests_requester', 'access_requests', ['requester_id', sa.literal_column('created_at DESC')], unique=False, schema='app')
    op.create_table('audit_logs',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('occurred_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('actor_id', sa.UUID(), nullable=True),
        sa.Column('action', sa.String(length=64), nullable=False),
        sa.Column('object_type', sa.String(length=64), nullable=False),
        sa.Column('object_id', sa.String(length=128), nullable=True),
        sa.Column('outcome', postgresql.ENUM('ALLOW', 'DENY', name='audit_outcome', create_type=False, schema='app'), nullable=False),
        sa.Column('ip', postgresql.INET(), nullable=True),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['app.users.id'], name=op.f('audit_logs_actor_id_fkey')),
        sa.PrimaryKeyConstraint('id', 'occurred_at', name=op.f('audit_logs_pkey')),
        schema='app',
        postgresql_partition_by='RANGE (occurred_at)'
    )
    op.create_index('ix_audit_actor', 'audit_logs', ['actor_id', sa.literal_column('occurred_at DESC')], unique=False, schema='app')
    op.create_index('ix_audit_object', 'audit_logs', ['object_type', 'object_id'], unique=False, schema='app')
    op.create_table('dashboards',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('topic', sa.String(length=64), nullable=False),
        sa.Column('owner_id', sa.UUID(), nullable=False),
        sa.Column('status', postgresql.ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED', name='dashboard_status', create_type=False, schema='app'), server_default=sa.text("'DRAFT'"), nullable=False),
        sa.Column('global_filters', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'"), nullable=False),
        sa.Column('version', sa.Integer(), server_default=sa.text('1'), nullable=False),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("status <> 'PUBLISHED' OR published_at IS NOT NULL", name='dashboards_check'),
        sa.CheckConstraint("topic IN ('TRAINING', 'HR', 'RESEARCH', 'FINANCE', 'DATA_QUALITY')", name='dashboards_topic_check'),
        sa.ForeignKeyConstraint(['owner_id'], ['app.users.id'], name=op.f('dashboards_owner_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('dashboards_pkey')),
        schema='app'
    )
    op.create_table('data_sources',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('code', sa.String(length=32), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('type', postgresql.ENUM('FILE', 'JDBC', 'API', name='source_type', create_type=False, schema='app'), nullable=False),
        sa.Column('status', postgresql.ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED', name='source_status', create_type=False, schema='app'), server_default=sa.text("'DRAFT'"), nullable=False),
        sa.Column('owner_user_id', sa.UUID(), nullable=False),
        sa.Column('business_owner', sa.String(length=255), nullable=False),
        sa.Column('purpose', sa.Text(), nullable=False),
        sa.Column('legal_basis_ref', sa.String(length=255), nullable=False),
        sa.Column('legal_doc_uri', sa.Text(), nullable=True),
        sa.Column('sensitivity', postgresql.ENUM('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', name='sensitivity_level', create_type=False, schema='app'), nullable=False),
        sa.Column('subject_types', postgresql.ARRAY(postgresql.ENUM('STUDENT', 'LECTURER', 'STAFF', name='subject_type', create_type=False, schema='app')), nullable=False),
        sa.Column('connection_config', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('secret_ref', sa.String(length=255), nullable=True),
        sa.Column('file_template', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('schedule_cron', sa.String(length=64), nullable=True),
        sa.Column('schedule_paused', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("type <> 'FILE' OR file_template IS NOT NULL", name='chk_source_file_template'),
        sa.CheckConstraint("type = 'FILE' OR status = 'DRAFT' OR secret_ref IS NOT NULL", name='chk_source_secret'),
        sa.CheckConstraint('cardinality(subject_types) > 0', name='chk_source_subjects'),
        sa.CheckConstraint('length(trim(purpose)) > 0 AND length(trim(legal_basis_ref)) > 0', name='chk_source_legal_basis'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['app.users.id'], name=op.f('data_sources_owner_user_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('data_sources_pkey')),
        sa.UniqueConstraint('code', name='data_sources_code_key'),
        schema='app'
    )
    op.create_table('glossary_terms',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('definition', sa.Text(), nullable=False),
        sa.Column('owner_user_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['app.users.id'], name=op.f('glossary_terms_owner_user_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('glossary_terms_pkey')),
        sa.UniqueConstraint('name', name='glossary_terms_name_key'),
        schema='app'
    )
    op.create_table('match_candidates',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('left_source_code', sa.String(length=32), nullable=False),
        sa.Column('left_source_key', sa.String(length=128), nullable=False),
        sa.Column('right_source_code', sa.String(length=32), nullable=False),
        sa.Column('right_source_key', sa.String(length=128), nullable=False),
        sa.Column('left_person_id', sa.UUID(), nullable=False),
        sa.Column('right_person_id', sa.UUID(), nullable=False),
        sa.Column('score', sa.Numeric(precision=4, scale=3), nullable=False),
        sa.Column('feature_scores', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('status', postgresql.ENUM('PENDING', 'AUTO_MERGED', 'MERGED', 'REJECTED', 'UNMERGED', name='match_status', create_type=False, schema='app'), server_default=sa.text("'PENDING'"), nullable=False),
        sa.Column('decided_by', sa.UUID(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("status <> 'AUTO_MERGED' OR score >= 0.95", name='match_candidates_check1'),
        sa.CheckConstraint("status NOT IN ('MERGED', 'REJECTED') OR decided_by IS NOT NULL", name='match_candidates_check2'),
        sa.CheckConstraint('left_person_id <> right_person_id', name='match_candidates_check'),
        sa.CheckConstraint('score BETWEEN 0 AND 1', name='match_candidates_score_check'),
        sa.ForeignKeyConstraint(['decided_by'], ['app.users.id'], name=op.f('match_candidates_decided_by_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('match_candidates_pkey')),
        sa.UniqueConstraint('left_source_code', 'left_source_key', 'right_source_code', 'right_source_key', name='match_candidates_left_source_code_left_source_key_right_sou_key'),
        schema='app'
    )
    op.create_index('ix_match_pending', 'match_candidates', [sa.literal_column('score DESC')], unique=False, schema='app', postgresql_where=sa.text("status = 'PENDING'"))
    op.create_table('notifications',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('type', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('link', sa.Text(), nullable=True),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['app.users.id'], name=op.f('notifications_user_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('notifications_pkey')),
        schema='app'
    )
    op.create_index('ix_notifications_unread', 'notifications', ['user_id', sa.literal_column('created_at DESC')], unique=False, schema='app', postgresql_where=sa.text('read_at IS NULL'))
    op.create_table('qa_blocked_topics',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('pattern', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_by', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['app.users.id'], name=op.f('qa_blocked_topics_created_by_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('qa_blocked_topics_pkey')),
        schema='app'
    )
    op.create_table('user_roles',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('role_code', postgresql.ENUM('PLATFORM_ADMIN', 'DATA_ENGINEER', 'DATA_STEWARD', 'BI_ANALYST', 'REPORT_VIEWER', name='role_code', create_type=False, schema='app'), nullable=False),
        sa.Column('scope_org_unit_id', sa.BigInteger(), nullable=True),
        sa.Column('granted_by', sa.UUID(), nullable=True),
        sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['granted_by'], ['app.users.id'], name=op.f('user_roles_granted_by_fkey')),
        sa.ForeignKeyConstraint(['scope_org_unit_id'], ['app.org_units.id'], name=op.f('user_roles_scope_org_unit_id_fkey')),
        sa.ForeignKeyConstraint(['user_id'], ['app.users.id'], name=op.f('user_roles_user_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('user_roles_pkey')),
        schema='app'
    )
    op.create_index('uq_user_roles', 'user_roles', ['user_id', 'role_code', 'scope_org_unit_id'], unique=True, schema='app', postgresql_nulls_not_distinct=True)
    op.create_table('access_grants',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('resource_type', postgresql.ENUM('DATASET', 'DASHBOARD', 'PROFILE_FACET', 'METRIC', name='resource_type', create_type=False, schema='app'), nullable=False),
        sa.Column('resource_id', sa.String(length=128), nullable=False),
        sa.Column('access_level', postgresql.ENUM('READ', 'EXPORT', name='access_level', create_type=False, schema='app'), nullable=False),
        sa.Column('scope', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('request_id', sa.BigInteger(), nullable=True),
        sa.Column('granted_by', sa.UUID(), nullable=False),
        sa.Column('valid_from', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('valid_to', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("valid_to > valid_from AND valid_to <= valid_from + interval '180 days'", name='access_grants_check'),
        sa.ForeignKeyConstraint(['granted_by'], ['app.users.id'], name=op.f('access_grants_granted_by_fkey')),
        sa.ForeignKeyConstraint(['request_id'], ['app.access_requests.id'], name=op.f('access_grants_request_id_fkey')),
        sa.ForeignKeyConstraint(['user_id'], ['app.users.id'], name=op.f('access_grants_user_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('access_grants_pkey')),
        schema='app'
    )
    op.create_index('ix_grants_expiry', 'access_grants', ['valid_to'], unique=False, schema='app', postgresql_where=sa.text('revoked_at IS NULL'))
    op.create_index('ix_grants_lookup', 'access_grants', ['user_id', 'resource_type', 'resource_id'], unique=False, schema='app', postgresql_where=sa.text('revoked_at IS NULL'))
    op.create_table('dashboard_favorites',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('dashboard_id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['dashboard_id'], ['app.dashboards.id'], name=op.f('dashboard_favorites_dashboard_id_fkey'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['app.users.id'], name=op.f('dashboard_favorites_user_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'dashboard_id', name=op.f('dashboard_favorites_pkey')),
        schema='app'
    )
    op.create_table('dashboard_shares',
        sa.Column('dashboard_id', sa.BigInteger(), nullable=False),
        sa.Column('principal_type', postgresql.ENUM('ROLE', 'ORG_UNIT', 'USER', name='principal_type', create_type=False, schema='app'), nullable=False),
        sa.Column('principal_id', sa.String(length=128), nullable=False),
        sa.ForeignKeyConstraint(['dashboard_id'], ['app.dashboards.id'], name=op.f('dashboard_shares_dashboard_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('dashboard_id', 'principal_type', 'principal_id', name=op.f('dashboard_shares_pkey')),
        schema='app'
    )
    op.create_table('dashboard_widgets',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('dashboard_id', sa.BigInteger(), nullable=False),
        sa.Column('type', sa.String(length=32), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('query_spec', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('position', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint("type IN ('KPI', 'BAR', 'LINE', 'PIE', 'HEATMAP', 'TABLE')", name='dashboard_widgets_type_check'),
        sa.ForeignKeyConstraint(['dashboard_id'], ['app.dashboards.id'], name=op.f('dashboard_widgets_dashboard_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('dashboard_widgets_pkey')),
        schema='app'
    )
    op.create_table('datasets',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('layer', postgresql.ENUM('BRONZE', 'SILVER', 'GOLD', 'QUARANTINE', name='data_layer', create_type=False, schema='app'), nullable=False),
        sa.Column('schema_name', sa.String(length=64), nullable=False),
        sa.Column('table_name', sa.String(length=128), nullable=False),
        sa.Column('display_name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('source_id', sa.BigInteger(), nullable=True),
        sa.Column('owner_user_id', sa.UUID(), nullable=True),
        sa.Column('steward_user_id', sa.UUID(), nullable=True),
        sa.Column('freshness_sla_minutes', sa.Integer(), nullable=True),
        sa.Column('last_updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('row_count', sa.BigInteger(), nullable=True),
        sa.Column('dq_score', sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column('tags', postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.CheckConstraint('dq_score BETWEEN 0 AND 100', name='datasets_dq_score_check'),
        sa.CheckConstraint('freshness_sla_minutes > 0', name='datasets_freshness_sla_minutes_check'),
        sa.CheckConstraint('row_count >= 0', name='datasets_row_count_check'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['app.users.id'], name=op.f('datasets_owner_user_id_fkey')),
        sa.ForeignKeyConstraint(['source_id'], ['app.data_sources.id'], name=op.f('datasets_source_id_fkey')),
        sa.ForeignKeyConstraint(['steward_user_id'], ['app.users.id'], name=op.f('datasets_steward_user_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('datasets_pkey')),
        sa.UniqueConstraint('layer', 'schema_name', 'table_name', name='datasets_layer_schema_name_table_name_key'),
        schema='app'
    )
    op.create_index('ix_datasets_tags', 'datasets', ['tags'], unique=False, schema='app', postgresql_using='gin')
    op.create_table('ingestion_batches',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('source_id', sa.BigInteger(), nullable=False),
        sa.Column('file_name', sa.String(length=255), nullable=True),
        sa.Column('checksum_sha256', sa.CHAR(length=64), nullable=False),
        sa.Column('row_count', sa.Integer(), nullable=True),
        sa.Column('bronze_path', sa.Text(), nullable=False),
        sa.Column('uploaded_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('row_count >= 0', name='ingestion_batches_row_count_check'),
        sa.ForeignKeyConstraint(['source_id'], ['app.data_sources.id'], name=op.f('ingestion_batches_source_id_fkey')),
        sa.ForeignKeyConstraint(['uploaded_by'], ['app.users.id'], name=op.f('ingestion_batches_uploaded_by_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('ingestion_batches_pkey')),
        schema='app'
    )
    op.create_index('ix_batches_checksum', 'ingestion_batches', ['source_id', 'checksum_sha256'], unique=False, schema='app')
    op.create_table('person_merge_events',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('action', postgresql.ENUM('MERGE', 'UNMERGE', name='merge_event_action', create_type=False, schema='app'), nullable=False),
        sa.Column('survivor_person_id', sa.UUID(), nullable=False),
        sa.Column('merged_person_id', sa.UUID(), nullable=False),
        sa.Column('candidate_id', sa.BigInteger(), nullable=True),
        sa.Column('actor_id', sa.UUID(), nullable=True),
        sa.Column('snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['app.users.id'], name=op.f('person_merge_events_actor_id_fkey')),
        sa.ForeignKeyConstraint(['candidate_id'], ['app.match_candidates.id'], name=op.f('person_merge_events_candidate_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('person_merge_events_pkey')),
        schema='app'
    )
    op.create_index('ix_merge_events_person', 'person_merge_events', ['survivor_person_id', sa.literal_column('created_at DESC')], unique=False, schema='app')
    op.create_table('qa_conversations',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['app.users.id'], name=op.f('qa_conversations_user_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('qa_conversations_pkey')),
        schema='app'
    )
    op.create_table('report_subscriptions',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('dashboard_id', sa.BigInteger(), nullable=False),
        sa.Column('owner_id', sa.UUID(), nullable=False),
        sa.Column('cron', sa.String(length=64), nullable=False),
        sa.Column('format', postgresql.ENUM('PDF', 'LINK', name='report_format', create_type=False, schema='app'), server_default=sa.text("'PDF'"), nullable=False),
        sa.Column('filters', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('include_ai_summary', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('status', postgresql.ENUM('ACTIVE', 'PAUSED', name='subscription_status', create_type=False, schema='app'), server_default=sa.text("'ACTIVE'"), nullable=False),
        sa.Column('next_run_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['dashboard_id'], ['app.dashboards.id'], name=op.f('report_subscriptions_dashboard_id_fkey')),
        sa.ForeignKeyConstraint(['owner_id'], ['app.users.id'], name=op.f('report_subscriptions_owner_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('report_subscriptions_pkey')),
        schema='app'
    )
    op.create_index('ix_subscriptions_due', 'report_subscriptions', ['next_run_at'], unique=False, schema='app', postgresql_where=sa.text("status = 'ACTIVE'"))
    op.create_table('access_policies',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('dataset_id', sa.BigInteger(), nullable=False),
        sa.Column('role_code', postgresql.ENUM('PLATFORM_ADMIN', 'DATA_ENGINEER', 'DATA_STEWARD', 'BI_ANALYST', 'REPORT_VIEWER', name='role_code', create_type=False, schema='app'), nullable=False),
        sa.Column('current_version', sa.Integer(), server_default=sa.text('1'), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['app.users.id'], name=op.f('access_policies_created_by_fkey')),
        sa.ForeignKeyConstraint(['dataset_id'], ['app.datasets.id'], name=op.f('access_policies_dataset_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('access_policies_pkey')),
        sa.UniqueConstraint('name', name='access_policies_name_key'),
        schema='app'
    )
    op.create_table('dataset_columns',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('dataset_id', sa.BigInteger(), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('data_type', sa.String(length=64), nullable=False),
        sa.Column('ordinal', sa.SmallInteger(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('sensitivity', postgresql.ENUM('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', name='sensitivity_level', create_type=False, schema='app'), server_default=sa.text("'CONFIDENTIAL'"), nullable=False),
        sa.Column('glossary_term_id', sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(['dataset_id'], ['app.datasets.id'], name=op.f('dataset_columns_dataset_id_fkey'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['glossary_term_id'], ['app.glossary_terms.id'], name=op.f('dataset_columns_glossary_term_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('dataset_columns_pkey')),
        sa.UniqueConstraint('dataset_id', 'name', name='dataset_columns_dataset_id_name_key'),
        schema='app'
    )
    op.create_table('pipeline_runs',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('source_id', sa.BigInteger(), nullable=False),
        sa.Column('batch_id', sa.BigInteger(), nullable=True),
        sa.Column('parent_run_id', sa.UUID(), nullable=True),
        sa.Column('trigger', postgresql.ENUM('MANUAL', 'SCHEDULE', 'RERUN', 'REPROCESS', name='run_trigger', create_type=False, schema='app'), nullable=False),
        sa.Column('status', postgresql.ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', name='run_status', create_type=False, schema='app'), server_default=sa.text("'QUEUED'"), nullable=False),
        sa.Column('orchestrator_run_id', sa.String(length=64), nullable=True),
        sa.Column('rows_read', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('rows_written', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('rows_quarantined', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('steps', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'"), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('triggered_by', sa.UUID(), nullable=True),
        sa.Column('queued_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status <> 'PARTIAL' OR rows_quarantined > 0", name='pipeline_runs_check2'),
        sa.CheckConstraint("trigger NOT IN ('RERUN', 'REPROCESS') OR parent_run_id IS NOT NULL", name='pipeline_runs_check'),
        sa.CheckConstraint('finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at', name='pipeline_runs_check1'),
        sa.CheckConstraint('rows_quarantined >= 0', name='pipeline_runs_rows_quarantined_check'),
        sa.CheckConstraint('rows_read >= 0', name='pipeline_runs_rows_read_check'),
        sa.CheckConstraint('rows_written >= 0', name='pipeline_runs_rows_written_check'),
        sa.ForeignKeyConstraint(['batch_id'], ['app.ingestion_batches.id'], name=op.f('pipeline_runs_batch_id_fkey')),
        sa.ForeignKeyConstraint(['parent_run_id'], ['app.pipeline_runs.id'], name=op.f('pipeline_runs_parent_run_id_fkey')),
        sa.ForeignKeyConstraint(['source_id'], ['app.data_sources.id'], name=op.f('pipeline_runs_source_id_fkey')),
        sa.ForeignKeyConstraint(['triggered_by'], ['app.users.id'], name=op.f('pipeline_runs_triggered_by_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('pipeline_runs_pkey')),
        schema='app'
    )
    op.create_index('ix_runs_active', 'pipeline_runs', ['status'], unique=False, schema='app', postgresql_where=sa.text("status IN ('QUEUED', 'RUNNING')"))
    op.create_index('ix_runs_source_time', 'pipeline_runs', ['source_id', sa.literal_column('queued_at DESC')], unique=False, schema='app')
    op.create_table('qa_messages',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('conversation_id', sa.UUID(), nullable=False),
        sa.Column('role', postgresql.ENUM('USER', 'ASSISTANT', name='qa_role', create_type=False, schema='app'), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('status', postgresql.ENUM('ANSWERED', 'CLARIFYING', 'REFUSED', 'FAILED', name='qa_status', create_type=False, schema='app'), nullable=True),
        sa.Column('semantic_query', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('compiled_sql', sa.Text(), nullable=True),
        sa.Column('metric_codes', postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('data_as_of', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refusal_reason', sa.String(length=64), nullable=True),
        sa.Column('model', sa.String(length=64), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('feedback', sa.SmallInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("(role = 'USER') = (status IS NULL)", name='qa_messages_check'),
        sa.CheckConstraint("status <> 'ANSWERED' OR (cardinality(metric_codes) > 0 AND data_as_of IS NOT NULL)", name='qa_messages_check2'),
        sa.CheckConstraint("status <> 'REFUSED' OR refusal_reason IS NOT NULL", name='qa_messages_check1'),
        sa.CheckConstraint('feedback IN (-1, 1)', name='qa_messages_feedback_check'),
        sa.CheckConstraint('latency_ms >= 0', name='qa_messages_latency_ms_check'),
        sa.ForeignKeyConstraint(['conversation_id'], ['app.qa_conversations.id'], name=op.f('qa_messages_conversation_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('qa_messages_pkey')),
        schema='app'
    )
    op.create_index('ix_qa_messages_conv', 'qa_messages', ['conversation_id', 'created_at'], unique=False, schema='app')
    op.create_table('report_deliveries',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('subscription_id', sa.BigInteger(), nullable=False),
        sa.Column('recipient_id', sa.UUID(), nullable=False),
        sa.Column('status', postgresql.ENUM('SENT', 'SKIPPED_NO_ACCESS', 'FAILED', name='delivery_status', create_type=False, schema='app'), nullable=False),
        sa.Column('artifact_uri', sa.Text(), nullable=True),
        sa.Column('ai_summary', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['recipient_id'], ['app.users.id'], name=op.f('report_deliveries_recipient_id_fkey')),
        sa.ForeignKeyConstraint(['subscription_id'], ['app.report_subscriptions.id'], name=op.f('report_deliveries_subscription_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('report_deliveries_pkey')),
        schema='app'
    )
    op.create_table('schema_mappings',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('source_id', sa.BigInteger(), nullable=False),
        sa.Column('target_dataset_id', sa.BigInteger(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('mapping', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("jsonb_typeof(mapping) = 'array'", name='schema_mappings_mapping_check'),
        sa.CheckConstraint('version > 0', name='schema_mappings_version_check'),
        sa.ForeignKeyConstraint(['created_by'], ['app.users.id'], name=op.f('schema_mappings_created_by_fkey')),
        sa.ForeignKeyConstraint(['source_id'], ['app.data_sources.id'], name=op.f('schema_mappings_source_id_fkey')),
        sa.ForeignKeyConstraint(['target_dataset_id'], ['app.datasets.id'], name=op.f('schema_mappings_target_dataset_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('schema_mappings_pkey')),
        sa.UniqueConstraint('source_id', 'target_dataset_id', 'version', name='schema_mappings_source_id_target_dataset_id_version_key'),
        schema='app'
    )
    op.create_index('uq_mapping_active', 'schema_mappings', ['source_id', 'target_dataset_id'], unique=True, schema='app', postgresql_where=sa.text('is_active'))
    op.create_table('semantic_dimensions',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('code', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('dataset_id', sa.BigInteger(), nullable=False),
        sa.Column('column_name', sa.String(length=128), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['dataset_id'], ['app.datasets.id'], name=op.f('semantic_dimensions_dataset_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('semantic_dimensions_pkey')),
        sa.UniqueConstraint('code', name='semantic_dimensions_code_key'),
        schema='app'
    )
    op.create_table('semantic_metrics',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('code', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('definition', sa.Text(), nullable=False),
        sa.Column('expression', sa.Text(), nullable=False),
        sa.Column('base_dataset_id', sa.BigInteger(), nullable=False),
        sa.Column('allowed_dimensions', postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('unit', sa.String(length=32), nullable=True),
        sa.Column('owner_id', sa.UUID(), nullable=False),
        sa.Column('glossary_term_id', sa.BigInteger(), nullable=True),
        sa.Column('status', postgresql.ENUM('DRAFT', 'CERTIFIED', 'DEPRECATED', name='metric_status', create_type=False, schema='app'), server_default=sa.text("'DRAFT'"), nullable=False),
        sa.Column('version', sa.Integer(), server_default=sa.text('1'), nullable=False),
        sa.Column('certified_by', sa.UUID(), nullable=True),
        sa.Column('certified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name='semantic_metrics_code_check'),
        sa.CheckConstraint("status <> 'CERTIFIED' OR (certified_by IS NOT NULL AND certified_at IS NOT NULL)", name='semantic_metrics_check'),
        sa.ForeignKeyConstraint(['base_dataset_id'], ['app.datasets.id'], name=op.f('semantic_metrics_base_dataset_id_fkey')),
        sa.ForeignKeyConstraint(['certified_by'], ['app.users.id'], name=op.f('semantic_metrics_certified_by_fkey')),
        sa.ForeignKeyConstraint(['glossary_term_id'], ['app.glossary_terms.id'], name=op.f('semantic_metrics_glossary_term_id_fkey')),
        sa.ForeignKeyConstraint(['owner_id'], ['app.users.id'], name=op.f('semantic_metrics_owner_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('semantic_metrics_pkey')),
        sa.UniqueConstraint('code', name='semantic_metrics_code_key'),
        schema='app'
    )
    op.create_table('subscription_recipients',
        sa.Column('subscription_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['subscription_id'], ['app.report_subscriptions.id'], name=op.f('subscription_recipients_subscription_id_fkey'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['app.users.id'], name=op.f('subscription_recipients_user_id_fkey')),
        sa.PrimaryKeyConstraint('subscription_id', 'user_id', name=op.f('subscription_recipients_pkey')),
        schema='app'
    )
    op.create_table('access_policy_versions',
        sa.Column('policy_id', sa.BigInteger(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('row_filter', sa.Text(), nullable=True),
        sa.Column('column_rules', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'"), nullable=False),
        sa.Column('change_note', sa.Text(), nullable=True),
        sa.Column('created_by', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("jsonb_typeof(column_rules) = 'array'", name='access_policy_versions_column_rules_check'),
        sa.CheckConstraint('version > 0', name='access_policy_versions_version_check'),
        sa.ForeignKeyConstraint(['created_by'], ['app.users.id'], name=op.f('access_policy_versions_created_by_fkey')),
        sa.ForeignKeyConstraint(['policy_id'], ['app.access_policies.id'], name=op.f('access_policy_versions_policy_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('policy_id', 'version', name=op.f('access_policy_versions_pkey')),
        schema='app'
    )
    op.create_table('anomaly_detectors',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('kind', postgresql.ENUM('VOLUME', 'FRESHNESS', 'METRIC_DRIFT', name='detector_kind', create_type=False, schema='app'), nullable=False),
        sa.Column('dataset_id', sa.BigInteger(), nullable=True),
        sa.Column('metric_id', sa.BigInteger(), nullable=True),
        sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.CheckConstraint("kind <> 'METRIC_DRIFT' OR metric_id IS NOT NULL", name='anomaly_detectors_check1'),
        sa.CheckConstraint('num_nonnulls(dataset_id, metric_id) = 1', name='anomaly_detectors_check'),
        sa.ForeignKeyConstraint(['dataset_id'], ['app.datasets.id'], name=op.f('anomaly_detectors_dataset_id_fkey')),
        sa.ForeignKeyConstraint(['metric_id'], ['app.semantic_metrics.id'], name=op.f('anomaly_detectors_metric_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('anomaly_detectors_pkey')),
        schema='app'
    )
    op.create_table('dq_rules',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('dataset_id', sa.BigInteger(), nullable=False),
        sa.Column('column_id', sa.BigInteger(), nullable=True),
        sa.Column('rule_type', postgresql.ENUM('NOT_NULL', 'UNIQUE', 'RANGE', 'REGEX', 'REFERENCE', 'FRESHNESS', 'CUSTOM_SQL', name='dq_rule_type', create_type=False, schema='app'), nullable=False),
        sa.Column('dimension', postgresql.ENUM('COMPLETENESS', 'UNIQUENESS', 'VALIDITY', 'CONSISTENCY', 'TIMELINESS', name='dq_dimension', create_type=False, schema='app'), nullable=False),
        sa.Column('severity', postgresql.ENUM('BLOCKING', 'WARNING', name='dq_severity', create_type=False, schema='app'), nullable=False),
        sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('status', postgresql.ENUM('DRAFT', 'ACTIVE', 'DISABLED', name='dq_rule_status', create_type=False, schema='app'), server_default=sa.text("'DRAFT'"), nullable=False),
        sa.Column('version', sa.Integer(), server_default=sa.text('1'), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("rule_type <> 'CUSTOM_SQL' OR params ? 'sql'", name='dq_rules_check'),
        sa.CheckConstraint("rule_type <> 'REFERENCE' OR (params ? 'ref_dataset' AND params ? 'ref_column')", name='dq_rules_check2'),
        sa.CheckConstraint("rule_type <> 'REGEX' OR params ? 'pattern'", name='dq_rules_check1'),
        sa.CheckConstraint("rule_type IN ('CUSTOM_SQL', 'FRESHNESS') OR column_id IS NOT NULL", name='dq_rules_check3'),
        sa.ForeignKeyConstraint(['column_id'], ['app.dataset_columns.id'], name=op.f('dq_rules_column_id_fkey')),
        sa.ForeignKeyConstraint(['created_by'], ['app.users.id'], name=op.f('dq_rules_created_by_fkey')),
        sa.ForeignKeyConstraint(['dataset_id'], ['app.datasets.id'], name=op.f('dq_rules_dataset_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('dq_rules_pkey')),
        schema='app'
    )
    op.create_index('ix_dq_rules_dataset', 'dq_rules', ['dataset_id'], unique=False, schema='app', postgresql_where=sa.text("status = 'ACTIVE'"))
    op.create_table('semantic_metric_versions',
        sa.Column('metric_id', sa.BigInteger(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('expression', sa.Text(), nullable=False),
        sa.Column('definition', sa.Text(), nullable=False),
        sa.Column('changed_by', sa.UUID(), nullable=False),
        sa.Column('changed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['changed_by'], ['app.users.id'], name=op.f('semantic_metric_versions_changed_by_fkey')),
        sa.ForeignKeyConstraint(['metric_id'], ['app.semantic_metrics.id'], name=op.f('semantic_metric_versions_metric_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('metric_id', 'version', name=op.f('semantic_metric_versions_pkey')),
        schema='app'
    )
    op.create_table('anomaly_alerts',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('detector_id', sa.BigInteger(), nullable=False),
        sa.Column('run_id', sa.UUID(), nullable=True),
        sa.Column('observed_value', sa.Numeric(), nullable=False),
        sa.Column('expected_low', sa.Numeric(), nullable=True),
        sa.Column('expected_high', sa.Numeric(), nullable=True),
        sa.Column('severity', postgresql.ENUM('LOW', 'MEDIUM', 'HIGH', name='alert_severity', create_type=False, schema='app'), nullable=False),
        sa.Column('status', postgresql.ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', name='alert_status', create_type=False, schema='app'), server_default=sa.text("'OPEN'"), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('detected_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('acknowledged_by', sa.UUID(), nullable=True),
        sa.Column('acknowledged_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("(status IN ('RESOLVED', 'DISMISSED')) = (closed_at IS NOT NULL)", name='anomaly_alerts_check1'),
        sa.CheckConstraint("status = 'OPEN' OR status = 'DISMISSED' OR acknowledged_by IS NOT NULL", name='anomaly_alerts_check'),
        sa.ForeignKeyConstraint(['acknowledged_by'], ['app.users.id'], name=op.f('anomaly_alerts_acknowledged_by_fkey')),
        sa.ForeignKeyConstraint(['detector_id'], ['app.anomaly_detectors.id'], name=op.f('anomaly_alerts_detector_id_fkey')),
        sa.ForeignKeyConstraint(['run_id'], ['app.pipeline_runs.id'], name=op.f('anomaly_alerts_run_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('anomaly_alerts_pkey')),
        schema='app'
    )
    op.create_index('ix_alerts_open', 'anomaly_alerts', [sa.literal_column('detected_at DESC')], unique=False, schema='app', postgresql_where=sa.text("status IN ('OPEN', 'ACKNOWLEDGED')"))
    op.create_table('dq_issues',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('rule_id', sa.BigInteger(), nullable=False),
        sa.Column('dataset_id', sa.BigInteger(), nullable=False),
        sa.Column('first_run_id', sa.UUID(), nullable=False),
        sa.Column('last_run_id', sa.UUID(), nullable=False),
        sa.Column('affected_rows', sa.BigInteger(), nullable=False),
        sa.Column('severity', postgresql.ENUM('BLOCKING', 'WARNING', name='dq_severity', create_type=False, schema='app'), nullable=False),
        sa.Column('status', postgresql.ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX', name='dq_issue_status', create_type=False, schema='app'), server_default=sa.text("'OPEN'"), nullable=False),
        sa.Column('assignee_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("(status IN ('RESOLVED', 'WONT_FIX')) = (resolved_at IS NOT NULL)", name='dq_issues_check'),
        sa.CheckConstraint('affected_rows >= 0', name='dq_issues_affected_rows_check'),
        sa.ForeignKeyConstraint(['assignee_id'], ['app.users.id'], name=op.f('dq_issues_assignee_id_fkey')),
        sa.ForeignKeyConstraint(['dataset_id'], ['app.datasets.id'], name=op.f('dq_issues_dataset_id_fkey')),
        sa.ForeignKeyConstraint(['first_run_id'], ['app.pipeline_runs.id'], name=op.f('dq_issues_first_run_id_fkey')),
        sa.ForeignKeyConstraint(['last_run_id'], ['app.pipeline_runs.id'], name=op.f('dq_issues_last_run_id_fkey')),
        sa.ForeignKeyConstraint(['rule_id'], ['app.dq_rules.id'], name=op.f('dq_issues_rule_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('dq_issues_pkey')),
        schema='app'
    )
    op.create_index('ix_dq_issues_open', 'dq_issues', ['dataset_id', 'status'], unique=False, schema='app')
    op.create_index('uq_dq_issue_open_per_rule', 'dq_issues', ['rule_id'], unique=True, schema='app', postgresql_where=sa.text("status IN ('OPEN', 'IN_PROGRESS')"))
    op.create_table('dq_rule_results',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('rule_id', sa.BigInteger(), nullable=False),
        sa.Column('run_id', sa.UUID(), nullable=False),
        sa.Column('rule_version', sa.Integer(), nullable=False),
        sa.Column('evaluated_count', sa.BigInteger(), nullable=False),
        sa.Column('failed_count', sa.BigInteger(), nullable=False),
        sa.Column('status', postgresql.ENUM('PASS', 'FAIL', 'ERROR', name='dq_result_status', create_type=False, schema='app'), nullable=False),
        sa.Column('sample_ref', sa.Text(), nullable=True),
        sa.Column('evaluated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('evaluated_count >= 0', name='dq_rule_results_evaluated_count_check'),
        sa.CheckConstraint('failed_count <= evaluated_count', name='dq_rule_results_check'),
        sa.CheckConstraint('failed_count >= 0', name='dq_rule_results_failed_count_check'),
        sa.ForeignKeyConstraint(['rule_id'], ['app.dq_rules.id'], name=op.f('dq_rule_results_rule_id_fkey')),
        sa.ForeignKeyConstraint(['run_id'], ['app.pipeline_runs.id'], name=op.f('dq_rule_results_run_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('dq_rule_results_pkey')),
        sa.UniqueConstraint('rule_id', 'run_id', name='dq_rule_results_rule_id_run_id_key'),
        schema='app'
    )
    op.create_index('ix_dq_results_rule_time', 'dq_rule_results', ['rule_id', sa.literal_column('evaluated_at DESC')], unique=False, schema='app')
    op.create_table('dq_issue_comments',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('issue_id', sa.BigInteger(), nullable=False),
        sa.Column('author_id', sa.UUID(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['app.users.id'], name=op.f('dq_issue_comments_author_id_fkey')),
        sa.ForeignKeyConstraint(['issue_id'], ['app.dq_issues.id'], name=op.f('dq_issue_comments_issue_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('dq_issue_comments_pkey')),
        schema='app'
    )

    _create_sql_objects()
    _seed_reference_data()


def downgrade() -> None:
    _drop_sql_objects()

    op.drop_table('dq_issue_comments', schema='app')
    op.drop_index('ix_dq_results_rule_time', table_name='dq_rule_results', schema='app')
    op.drop_table('dq_rule_results', schema='app')
    op.drop_index('uq_dq_issue_open_per_rule', table_name='dq_issues', schema='app', postgresql_where=sa.text("status IN ('OPEN', 'IN_PROGRESS')"))
    op.drop_index('ix_dq_issues_open', table_name='dq_issues', schema='app')
    op.drop_table('dq_issues', schema='app')
    op.drop_index('ix_alerts_open', table_name='anomaly_alerts', schema='app', postgresql_where=sa.text("status IN ('OPEN', 'ACKNOWLEDGED')"))
    op.drop_table('anomaly_alerts', schema='app')
    op.drop_table('semantic_metric_versions', schema='app')
    op.drop_index('ix_dq_rules_dataset', table_name='dq_rules', schema='app', postgresql_where=sa.text("status = 'ACTIVE'"))
    op.drop_table('dq_rules', schema='app')
    op.drop_table('anomaly_detectors', schema='app')
    op.drop_table('access_policy_versions', schema='app')
    op.drop_table('subscription_recipients', schema='app')
    op.drop_table('semantic_metrics', schema='app')
    op.drop_table('semantic_dimensions', schema='app')
    op.drop_index('uq_mapping_active', table_name='schema_mappings', schema='app', postgresql_where=sa.text('is_active'))
    op.drop_table('schema_mappings', schema='app')
    op.drop_table('report_deliveries', schema='app')
    op.drop_index('ix_qa_messages_conv', table_name='qa_messages', schema='app')
    op.drop_table('qa_messages', schema='app')
    op.drop_index('ix_runs_source_time', table_name='pipeline_runs', schema='app')
    op.drop_index('ix_runs_active', table_name='pipeline_runs', schema='app', postgresql_where=sa.text("status IN ('QUEUED', 'RUNNING')"))
    op.drop_table('pipeline_runs', schema='app')
    op.drop_table('dataset_columns', schema='app')
    op.drop_table('access_policies', schema='app')
    op.drop_index('ix_subscriptions_due', table_name='report_subscriptions', schema='app', postgresql_where=sa.text("status = 'ACTIVE'"))
    op.drop_table('report_subscriptions', schema='app')
    op.drop_table('qa_conversations', schema='app')
    op.drop_index('ix_merge_events_person', table_name='person_merge_events', schema='app')
    op.drop_table('person_merge_events', schema='app')
    op.drop_index('ix_batches_checksum', table_name='ingestion_batches', schema='app')
    op.drop_table('ingestion_batches', schema='app')
    op.drop_index('ix_datasets_tags', table_name='datasets', schema='app', postgresql_using='gin')
    op.drop_table('datasets', schema='app')
    op.drop_table('dashboard_widgets', schema='app')
    op.drop_table('dashboard_shares', schema='app')
    op.drop_table('dashboard_favorites', schema='app')
    op.drop_index('ix_grants_lookup', table_name='access_grants', schema='app', postgresql_where=sa.text('revoked_at IS NULL'))
    op.drop_index('ix_grants_expiry', table_name='access_grants', schema='app', postgresql_where=sa.text('revoked_at IS NULL'))
    op.drop_table('access_grants', schema='app')
    op.drop_index('uq_user_roles', table_name='user_roles', schema='app', postgresql_nulls_not_distinct=True)
    op.drop_table('user_roles', schema='app')
    op.drop_table('qa_blocked_topics', schema='app')
    op.drop_index('ix_notifications_unread', table_name='notifications', schema='app', postgresql_where=sa.text('read_at IS NULL'))
    op.drop_table('notifications', schema='app')
    op.drop_index('ix_match_pending', table_name='match_candidates', schema='app', postgresql_where=sa.text("status = 'PENDING'"))
    op.drop_table('match_candidates', schema='app')
    op.drop_table('glossary_terms', schema='app')
    op.drop_table('data_sources', schema='app')
    op.drop_table('dashboards', schema='app')
    op.drop_index('ix_audit_object', table_name='audit_logs', schema='app')
    op.drop_index('ix_audit_actor', table_name='audit_logs', schema='app')
    op.drop_table('audit_logs', schema='app')
    op.drop_index('ix_access_requests_requester', table_name='access_requests', schema='app')
    op.drop_index('ix_access_requests_queue', table_name='access_requests', schema='app', postgresql_where=sa.text("status = 'PENDING'"))
    op.drop_table('access_requests', schema='app')
    op.drop_table('users', schema='app')
    op.drop_index('ix_lineage_to', table_name='lineage_edges', schema='app')
    op.drop_table('lineage_edges', schema='app')
    op.drop_table('org_units', schema='app')
    op.drop_table('lineage_nodes', schema='app')

    _drop_enums()
