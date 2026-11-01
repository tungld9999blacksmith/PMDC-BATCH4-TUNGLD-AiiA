"""Bổ sung cho Platform API theo openapi.yaml.

- source_uploads: file đã upload, kiểm tra header, chờ xác nhận ingest (US05, AC05).
- export_jobs + enum export_status/export_format: export dashboard bất đồng bộ (US29, BR13).
- data_sources.connection_tested_at: chỉ kích hoạt nguồn sau khi kiểm tra kết nối thành công (AC04).
- dq_rules.last_dry_run_version: chỉ kích hoạt quy tắc đã chạy thử phiên bản hiện tại (AC17).
- qa_conversations.dashboard_id: ngữ cảnh dashboard của hội thoại.
- qa_messages.extras, feedback_comment: kết quả/biểu đồ/câu hỏi làm rõ và ghi chú phản hồi (US39).

Revision ID: 0002_api_support
Revises: 0001_baseline
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_api_support"
down_revision: str | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *values: str) -> postgresql.ENUM:
    return postgresql.ENUM(*values, name=name, schema="app", create_type=False)


def upgrade() -> None:
    op.execute("CREATE TYPE app.export_status AS ENUM ('PENDING', 'READY', 'FAILED')")
    op.execute("CREATE TYPE app.export_format AS ENUM ('PDF', 'CSV')")

    op.add_column("data_sources", sa.Column("connection_tested_at", sa.DateTime(timezone=True)), schema="app")
    op.add_column("dq_rules", sa.Column("last_dry_run_version", sa.Integer()), schema="app")
    op.add_column(
        "qa_conversations",
        sa.Column(
            "dashboard_id",
            sa.BigInteger(),
            sa.ForeignKey("app.dashboards.id", name="qa_conversations_dashboard_id_fkey", ondelete="SET NULL"),
        ),
        schema="app",
    )
    op.add_column(
        "qa_messages",
        sa.Column("extras", postgresql.JSONB(), server_default=sa.text("'{}'"), nullable=False),
        schema="app",
    )
    op.add_column("qa_messages", sa.Column("feedback_comment", sa.Text()), schema="app")

    op.create_table(
        "source_uploads",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("checksum_sha256", sa.CHAR(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("storage_uri", sa.Text(), nullable=False),
        sa.Column("uploaded_by", sa.UUID(), nullable=False),
        sa.Column("batch_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("row_count >= 0", name="source_uploads_row_count_check"),
        sa.CheckConstraint("size_bytes >= 0", name="source_uploads_size_bytes_check"),
        sa.ForeignKeyConstraint(["batch_id"], ["app.ingestion_batches.id"], name="source_uploads_batch_id_fkey"),
        sa.ForeignKeyConstraint(["source_id"], ["app.data_sources.id"], name="source_uploads_source_id_fkey"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["app.users.id"], name="source_uploads_uploaded_by_fkey"),
        sa.PrimaryKeyConstraint("id", name="source_uploads_pkey"),
        schema="app",
    )

    op.create_table(
        "export_jobs",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("dashboard_id", sa.BigInteger(), nullable=False),
        sa.Column("widget_id", sa.BigInteger(), nullable=True),
        sa.Column("requested_by", sa.UUID(), nullable=False),
        sa.Column("format", _enum("export_format", "PDF", "CSV"), nullable=False),
        sa.Column(
            "status",
            _enum("export_status", "PENDING", "READY", "FAILED"),
            server_default=sa.text("'PENDING'"),
            nullable=False,
        ),
        sa.Column("filters", postgresql.JSONB(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("watermark", sa.String(length=255), nullable=False),
        sa.Column("excluded_columns", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("storage_uri", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["dashboard_id"], ["app.dashboards.id"], name="export_jobs_dashboard_id_fkey", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["requested_by"], ["app.users.id"], name="export_jobs_requested_by_fkey"),
        sa.ForeignKeyConstraint(
            ["widget_id"], ["app.dashboard_widgets.id"], name="export_jobs_widget_id_fkey", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name="export_jobs_pkey"),
        schema="app",
    )
    op.create_index(
        "ix_export_jobs_requester",
        "export_jobs",
        ["requested_by", sa.literal_column("created_at DESC")],
        schema="app",
    )


def downgrade() -> None:
    op.drop_index("ix_export_jobs_requester", table_name="export_jobs", schema="app")
    op.drop_table("export_jobs", schema="app")
    op.drop_table("source_uploads", schema="app")
    op.drop_column("qa_messages", "feedback_comment", schema="app")
    op.drop_column("qa_messages", "extras", schema="app")
    op.drop_column("qa_conversations", "dashboard_id", schema="app")
    op.drop_column("dq_rules", "last_dry_run_version", schema="app")
    op.drop_column("data_sources", "connection_tested_at", schema="app")
    op.execute("DROP TYPE app.export_format")
    op.execute("DROP TYPE app.export_status")
