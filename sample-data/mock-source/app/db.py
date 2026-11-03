"""Schema và nạp dữ liệu cho CSDL của mock source (Postgres, database mock_source)."""

from __future__ import annotations

from dataclasses import asdict

import psycopg
from psycopg import sql

from app.generator import SourceData

DDL = [
    """CREATE TABLE IF NOT EXISTS sis_students (
        student_id text PRIMARY KEY,
        full_name text NOT NULL,
        date_of_birth date NOT NULL,
        email text,
        phone text,
        national_id text NOT NULL,
        faculty_code text NOT NULL,
        program_code text NOT NULL,
        cohort text NOT NULL,
        status text NOT NULL,
        updated_at timestamptz NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS sis_enrollments (
        enrollment_id integer PRIMARY KEY,
        student_id text NOT NULL REFERENCES sis_students (student_id),
        term_code text NOT NULL,
        course_code text NOT NULL,
        credits smallint NOT NULL,
        score_10 numeric(4,1) NOT NULL,
        letter_grade text NOT NULL,
        updated_at timestamptz NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS hrm_staff (
        staff_id text PRIMARY KEY,
        staff_type text NOT NULL,
        full_name text NOT NULL,
        date_of_birth date NOT NULL,
        email text,
        national_id text NOT NULL,
        org_unit_code text NOT NULL,
        position text,
        academic_title text,
        degree text,
        updated_at timestamptz NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS fin_tuition (
        tuition_id integer PRIMARY KEY,
        student_id text NOT NULL REFERENCES sis_students (student_id),
        term_code text NOT NULL,
        amount_due bigint NOT NULL,
        amount_paid bigint NOT NULL,
        scholarship_amount bigint NOT NULL,
        payment_status text NOT NULL,
        updated_at timestamptz NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS lms_activity (
        activity_id integer PRIMARY KEY,
        student_id text NOT NULL REFERENCES sis_students (student_id),
        activity_date date NOT NULL,
        course_code text NOT NULL,
        logins integer NOT NULL,
        submissions integer NOT NULL,
        active_minutes integer NOT NULL,
        updated_at timestamptz NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS ix_sis_students_updated ON sis_students (updated_at)",
    "CREATE INDEX IF NOT EXISTS ix_sis_enrollments_updated ON sis_enrollments (updated_at)",
    "CREATE INDEX IF NOT EXISTS ix_hrm_staff_updated ON hrm_staff (updated_at)",
    "CREATE INDEX IF NOT EXISTS ix_fin_tuition_updated ON fin_tuition (updated_at)",
    "CREATE INDEX IF NOT EXISTS ix_lms_activity_updated ON lms_activity (updated_at)",
]

# Publication cho Debezium (CDC). Tạo một lần, idempotent.
PUBLICATION = """
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'aiia_sis_pub') THEN
    CREATE PUBLICATION aiia_sis_pub FOR TABLE sis_students, sis_enrollments;
  END IF;
END $$;
"""


def init_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        for statement in DDL:
            cur.execute(statement)
        cur.execute(PUBLICATION)
    conn.commit()


def is_empty(conn: psycopg.Connection) -> bool:
    return conn.execute("SELECT count(*) FROM sis_students").fetchone()[0] == 0


def seed(conn: psycopg.Connection, data: SourceData) -> None:
    with conn.cursor() as cur:
        for table, rows in asdict(data).items():
            if not rows:
                continue
            columns = list(rows[0].keys())
            statement = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                sql.Identifier(table),
                sql.SQL(", ").join(sql.Identifier(c) for c in columns),
                sql.SQL(", ").join(sql.Placeholder() for _ in columns),
            )
            cur.executemany(statement, [tuple(row[c] for c in columns) for row in rows])
    conn.commit()
