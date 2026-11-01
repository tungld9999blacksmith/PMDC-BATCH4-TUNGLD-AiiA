-- AiiA — schema CSDL điều khiển (control plane) · PostgreSQL 16
-- Nguồn sự thật mô hình: aiia.dbml. Lớp Gold (Iceberg) không nằm trong file này.
-- Chạy: psql -v ON_ERROR_STOP=1 -f aiia.sql

BEGIN;

CREATE SCHEMA IF NOT EXISTS app;
SET search_path = app, public;

-- ───────────────────────── Enum ─────────────────────────
CREATE TYPE user_status           AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE role_code             AS ENUM ('PLATFORM_ADMIN', 'DATA_ENGINEER', 'DATA_STEWARD', 'BI_ANALYST', 'REPORT_VIEWER');
CREATE TYPE org_unit_type         AS ENUM ('UNIVERSITY', 'FACULTY', 'DEPARTMENT', 'OFFICE', 'CENTER');
CREATE TYPE source_type           AS ENUM ('FILE', 'JDBC', 'API');
CREATE TYPE source_status         AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE sensitivity_level     AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');
CREATE TYPE subject_type          AS ENUM ('STUDENT', 'LECTURER', 'STAFF');
CREATE TYPE run_trigger           AS ENUM ('MANUAL', 'SCHEDULE', 'RERUN', 'REPROCESS');
CREATE TYPE run_status            AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');
CREATE TYPE data_layer            AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'QUARANTINE');
CREATE TYPE dq_rule_type          AS ENUM ('NOT_NULL', 'UNIQUE', 'RANGE', 'REGEX', 'REFERENCE', 'FRESHNESS', 'CUSTOM_SQL');
CREATE TYPE dq_dimension          AS ENUM ('COMPLETENESS', 'UNIQUENESS', 'VALIDITY', 'CONSISTENCY', 'TIMELINESS');
CREATE TYPE dq_severity           AS ENUM ('BLOCKING', 'WARNING');
CREATE TYPE dq_rule_status        AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');
CREATE TYPE dq_result_status      AS ENUM ('PASS', 'FAIL', 'ERROR');
CREATE TYPE dq_issue_status       AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX');
CREATE TYPE match_status          AS ENUM ('PENDING', 'AUTO_MERGED', 'MERGED', 'REJECTED', 'UNMERGED');
CREATE TYPE merge_event_action          AS ENUM ('MERGE', 'UNMERGE');
CREATE TYPE resource_type         AS ENUM ('DATASET', 'DASHBOARD', 'PROFILE_FACET', 'METRIC');
CREATE TYPE access_level          AS ENUM ('READ', 'EXPORT');
CREATE TYPE access_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REVOKED');
CREATE TYPE dashboard_status      AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE principal_type        AS ENUM ('ROLE', 'ORG_UNIT', 'USER');
CREATE TYPE metric_status         AS ENUM ('DRAFT', 'CERTIFIED', 'DEPRECATED');
CREATE TYPE report_format         AS ENUM ('PDF', 'LINK');
CREATE TYPE subscription_status   AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE delivery_status       AS ENUM ('SENT', 'SKIPPED_NO_ACCESS', 'FAILED');
CREATE TYPE detector_kind         AS ENUM ('VOLUME', 'FRESHNESS', 'METRIC_DRIFT');
CREATE TYPE alert_severity        AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE alert_status          AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');
CREATE TYPE lineage_node_type     AS ENUM ('SOURCE', 'DATASET', 'COLUMN', 'METRIC', 'DASHBOARD');
CREATE TYPE qa_role               AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE qa_status             AS ENUM ('ANSWERED', 'CLARIFYING', 'REFUSED', 'FAILED');
CREATE TYPE audit_outcome         AS ENUM ('ALLOW', 'DENY');

-- Cập nhật updated_at tự động
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ───────────────────────── 1. Định danh & tổ chức ─────────────────────────
CREATE TABLE org_units (
  id         bigserial PRIMARY KEY,
  code       varchar(32)   NOT NULL UNIQUE,
  name       varchar(255)  NOT NULL,
  type       org_unit_type NOT NULL,
  parent_id  bigint REFERENCES org_units (id),
  is_active  boolean NOT NULL DEFAULT true,
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sso_subject   varchar(255) NOT NULL UNIQUE,
  email         varchar(255) NOT NULL UNIQUE,
  full_name     varchar(255) NOT NULL,
  org_unit_id   bigint REFERENCES org_units (id),
  status        user_status NOT NULL DEFAULT 'ACTIVE',
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_roles (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_code         role_code NOT NULL,
  scope_org_unit_id bigint REFERENCES org_units (id),
  granted_by        uuid REFERENCES users (id),
  granted_at        timestamptz NOT NULL DEFAULT now()
);
-- NULL scope = toàn trường; NULLS NOT DISTINCT để không gán trùng vai trò toàn trường
CREATE UNIQUE INDEX uq_user_roles ON user_roles (user_id, role_code, scope_org_unit_id) NULLS NOT DISTINCT;

-- AC24: không được gỡ vai trò của PLATFORM_ADMIN cuối cùng
CREATE FUNCTION guard_last_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role_code = 'PLATFORM_ADMIN' AND NOT EXISTS (
       SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
       WHERE r.role_code = 'PLATFORM_ADMIN' AND r.id <> OLD.id AND u.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Không thể gỡ vai trò PLATFORM_ADMIN cuối cùng' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_user_roles_last_admin BEFORE DELETE ON user_roles FOR EACH ROW EXECUTE FUNCTION guard_last_admin();

-- ───────────────────────── 2. Nguồn & ingest ─────────────────────────
CREATE TABLE data_sources (
  id                bigserial PRIMARY KEY,
  code              varchar(32)  NOT NULL UNIQUE,
  name              varchar(255) NOT NULL,
  type              source_type  NOT NULL,
  status            source_status NOT NULL DEFAULT 'DRAFT',
  owner_user_id     uuid NOT NULL REFERENCES users (id),
  business_owner    varchar(255) NOT NULL,
  purpose           text NOT NULL,
  legal_basis_ref   varchar(255) NOT NULL,
  legal_doc_uri     text,
  sensitivity       sensitivity_level NOT NULL,
  subject_types     subject_type[] NOT NULL,
  connection_config jsonb NOT NULL DEFAULT '{}',
  secret_ref        varchar(255),
  file_template     jsonb,
  schedule_cron     varchar(64),
  schedule_paused   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- BR01: nguồn chỉ hoạt động khi khai báo đủ mục đích và căn cứ cho phép
  CONSTRAINT chk_source_legal_basis CHECK (length(trim(purpose)) > 0 AND length(trim(legal_basis_ref)) > 0),
  CONSTRAINT chk_source_subjects CHECK (cardinality(subject_types) > 0),
  CONSTRAINT chk_source_file_template CHECK (type <> 'FILE' OR file_template IS NOT NULL),
  CONSTRAINT chk_source_secret CHECK (type = 'FILE' OR status = 'DRAFT' OR secret_ref IS NOT NULL)
);
CREATE TRIGGER trg_sources_updated BEFORE UPDATE ON data_sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ingestion_batches (
  id              bigserial PRIMARY KEY,
  source_id       bigint NOT NULL REFERENCES data_sources (id),
  file_name       varchar(255),
  checksum_sha256 char(64) NOT NULL,
  row_count       integer CHECK (row_count >= 0),
  bronze_path     text NOT NULL,
  uploaded_by     uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- Không unique: AC05 cho phép ingest lại file trùng khi người dùng xác nhận; BR14 bảo đảm idempotent ở Silver
CREATE INDEX ix_batches_checksum ON ingestion_batches (source_id, checksum_sha256);

CREATE TABLE pipeline_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           bigint NOT NULL REFERENCES data_sources (id),
  batch_id            bigint REFERENCES ingestion_batches (id),
  parent_run_id       uuid REFERENCES pipeline_runs (id),
  trigger             run_trigger NOT NULL,
  status              run_status NOT NULL DEFAULT 'QUEUED',
  orchestrator_run_id varchar(64),
  rows_read           integer NOT NULL DEFAULT 0 CHECK (rows_read >= 0),
  rows_written        integer NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  rows_quarantined    integer NOT NULL DEFAULT 0 CHECK (rows_quarantined >= 0),
  steps               jsonb NOT NULL DEFAULT '[]',
  error_message       text,
  triggered_by        uuid REFERENCES users (id),
  queued_at           timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  CHECK (trigger NOT IN ('RERUN', 'REPROCESS') OR parent_run_id IS NOT NULL),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  CHECK (status <> 'PARTIAL' OR rows_quarantined > 0)
);
CREATE INDEX ix_runs_source_time ON pipeline_runs (source_id, queued_at DESC);
CREATE INDEX ix_runs_active ON pipeline_runs (status) WHERE status IN ('QUEUED', 'RUNNING');

-- ───────────────────────── 3. Catalog & glossary ─────────────────────────
CREATE TABLE glossary_terms (
  id            bigserial PRIMARY KEY,
  name          varchar(255) NOT NULL UNIQUE,
  definition    text NOT NULL,
  owner_user_id uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_glossary_updated BEFORE UPDATE ON glossary_terms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE datasets (
  id                    bigserial PRIMARY KEY,
  layer                 data_layer NOT NULL,
  schema_name           varchar(64)  NOT NULL,
  table_name            varchar(128) NOT NULL,
  display_name          varchar(255) NOT NULL,
  description           text,
  source_id             bigint REFERENCES data_sources (id),
  owner_user_id         uuid REFERENCES users (id),
  steward_user_id       uuid REFERENCES users (id),
  freshness_sla_minutes integer CHECK (freshness_sla_minutes > 0),
  last_updated_at       timestamptz,
  row_count             bigint CHECK (row_count >= 0),
  dq_score              numeric(5,2) CHECK (dq_score BETWEEN 0 AND 100),
  tags                  text[] NOT NULL DEFAULT '{}',
  UNIQUE (layer, schema_name, table_name)
);
CREATE INDEX ix_datasets_tags ON datasets USING gin (tags);

CREATE TABLE dataset_columns (
  id               bigserial PRIMARY KEY,
  dataset_id       bigint NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  name             varchar(128) NOT NULL,
  data_type        varchar(64)  NOT NULL,
  ordinal          smallint NOT NULL,
  description      text,
  sensitivity      sensitivity_level NOT NULL DEFAULT 'CONFIDENTIAL',  -- BR07
  glossary_term_id bigint REFERENCES glossary_terms (id),
  UNIQUE (dataset_id, name)
);

CREATE TABLE schema_mappings (
  id                bigserial PRIMARY KEY,
  source_id         bigint NOT NULL REFERENCES data_sources (id),
  target_dataset_id bigint NOT NULL REFERENCES datasets (id),
  version           integer NOT NULL CHECK (version > 0),
  mapping           jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'array'),
  is_active         boolean NOT NULL DEFAULT false,
  created_by        uuid NOT NULL REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, target_dataset_id, version)
);
-- Mỗi cặp nguồn–dataset chỉ có một phiên bản mapping đang dùng
CREATE UNIQUE INDEX uq_mapping_active ON schema_mappings (source_id, target_dataset_id) WHERE is_active;

-- ───────────────────────── 4. Chất lượng dữ liệu ─────────────────────────
CREATE TABLE dq_rules (
  id          bigserial PRIMARY KEY,
  dataset_id  bigint NOT NULL REFERENCES datasets (id),
  column_id   bigint REFERENCES dataset_columns (id),
  rule_type   dq_rule_type NOT NULL,
  dimension   dq_dimension NOT NULL,
  severity    dq_severity  NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}',
  description text NOT NULL,
  status      dq_rule_status NOT NULL DEFAULT 'DRAFT',
  version     integer NOT NULL DEFAULT 1,
  created_by  uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (rule_type <> 'CUSTOM_SQL' OR params ? 'sql'),
  CHECK (rule_type <> 'REGEX' OR params ? 'pattern'),
  CHECK (rule_type <> 'REFERENCE' OR (params ? 'ref_dataset' AND params ? 'ref_column')),
  CHECK (rule_type IN ('CUSTOM_SQL', 'FRESHNESS') OR column_id IS NOT NULL)
);
CREATE TRIGGER trg_dq_rules_updated BEFORE UPDATE ON dq_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_dq_rules_dataset ON dq_rules (dataset_id) WHERE status = 'ACTIVE';

CREATE TABLE dq_rule_results (
  id              bigserial PRIMARY KEY,
  rule_id         bigint NOT NULL REFERENCES dq_rules (id),
  run_id          uuid NOT NULL REFERENCES pipeline_runs (id),
  rule_version    integer NOT NULL,
  evaluated_count bigint NOT NULL CHECK (evaluated_count >= 0),
  failed_count    bigint NOT NULL CHECK (failed_count >= 0),
  status          dq_result_status NOT NULL,
  sample_ref      text,
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (failed_count <= evaluated_count),
  UNIQUE (rule_id, run_id)
);
CREATE INDEX ix_dq_results_rule_time ON dq_rule_results (rule_id, evaluated_at DESC);

CREATE TABLE dq_issues (
  id            bigserial PRIMARY KEY,
  rule_id       bigint NOT NULL REFERENCES dq_rules (id),
  dataset_id    bigint NOT NULL REFERENCES datasets (id),
  first_run_id  uuid NOT NULL REFERENCES pipeline_runs (id),
  last_run_id   uuid NOT NULL REFERENCES pipeline_runs (id),
  affected_rows bigint NOT NULL CHECK (affected_rows >= 0),
  severity      dq_severity NOT NULL,
  status        dq_issue_status NOT NULL DEFAULT 'OPEN',
  assignee_id   uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  CHECK ((status IN ('RESOLVED', 'WONT_FIX')) = (resolved_at IS NOT NULL))
);
CREATE INDEX ix_dq_issues_open ON dq_issues (dataset_id, status);
-- Một quy tắc chỉ có một issue đang mở; lần chạy sau cập nhật last_run_id
CREATE UNIQUE INDEX uq_dq_issue_open_per_rule ON dq_issues (rule_id) WHERE status IN ('OPEN', 'IN_PROGRESS');

CREATE TABLE dq_issue_comments (
  id         bigserial PRIMARY KEY,
  issue_id   bigint NOT NULL REFERENCES dq_issues (id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users (id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── 5. Đối soát danh tính ─────────────────────────
CREATE TABLE match_candidates (
  id                bigserial PRIMARY KEY,
  left_source_code  varchar(32)  NOT NULL,
  left_source_key   varchar(128) NOT NULL,
  right_source_code varchar(32)  NOT NULL,
  right_source_key  varchar(128) NOT NULL,
  left_person_id    uuid NOT NULL,
  right_person_id   uuid NOT NULL,
  score             numeric(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  feature_scores    jsonb NOT NULL,
  status            match_status NOT NULL DEFAULT 'PENDING',
  decided_by        uuid REFERENCES users (id),
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (left_source_code, left_source_key, right_source_code, right_source_key),
  CHECK (left_person_id <> right_person_id),
  -- BR05: chỉ tự gộp khi điểm ≥ 0,95; vùng xám phải có người quyết định
  CHECK (status <> 'AUTO_MERGED' OR score >= 0.95),
  CHECK (status NOT IN ('MERGED', 'REJECTED') OR decided_by IS NOT NULL)
);
CREATE INDEX ix_match_pending ON match_candidates (score DESC) WHERE status = 'PENDING';

CREATE TABLE person_merge_events (
  id                 bigserial PRIMARY KEY,
  action             merge_event_action NOT NULL,
  survivor_person_id uuid NOT NULL,
  merged_person_id   uuid NOT NULL,
  candidate_id       bigint REFERENCES match_candidates (id),
  actor_id           uuid REFERENCES users (id),
  snapshot           jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_merge_events_person ON person_merge_events (survivor_person_id, created_at DESC);

-- ───────────────────────── 6. Cấp quyền & chính sách ─────────────────────────
CREATE TABLE access_requests (
  id             bigserial PRIMARY KEY,
  requester_id   uuid NOT NULL REFERENCES users (id),
  resource_type  resource_type NOT NULL,
  resource_id    varchar(128) NOT NULL,
  access_level   access_level NOT NULL DEFAULT 'READ',
  purpose        text NOT NULL CHECK (length(trim(purpose)) >= 10),
  scope          jsonb NOT NULL DEFAULT '{}',
  requested_days smallint NOT NULL CHECK (requested_days BETWEEN 1 AND 180),  -- BR09
  status         access_request_status NOT NULL DEFAULT 'PENDING',
  reviewer_id    uuid REFERENCES users (id),
  review_note    text,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (reviewer_id IS NULL OR reviewer_id <> requester_id),                  -- không tự duyệt
  CHECK (status <> 'REJECTED' OR length(trim(coalesce(review_note, ''))) > 0)  -- từ chối phải có lý do
);
CREATE INDEX ix_access_requests_queue ON access_requests (resource_type, resource_id) WHERE status = 'PENDING';
CREATE INDEX ix_access_requests_requester ON access_requests (requester_id, created_at DESC);

CREATE TABLE access_grants (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id),
  resource_type resource_type NOT NULL,
  resource_id   varchar(128) NOT NULL,
  access_level  access_level NOT NULL,
  scope         jsonb NOT NULL DEFAULT '{}',
  request_id    bigint REFERENCES access_requests (id),
  granted_by    uuid NOT NULL REFERENCES users (id),
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz NOT NULL,
  revoked_at    timestamptz,
  CHECK (valid_to > valid_from AND valid_to <= valid_from + interval '180 days')
);
CREATE INDEX ix_grants_lookup ON access_grants (user_id, resource_type, resource_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_grants_expiry ON access_grants (valid_to) WHERE revoked_at IS NULL;

CREATE TABLE access_policies (
  id              bigserial PRIMARY KEY,
  name            varchar(255) NOT NULL UNIQUE,
  dataset_id      bigint NOT NULL REFERENCES datasets (id),
  role_code       role_code NOT NULL,
  current_version integer NOT NULL DEFAULT 1,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid NOT NULL REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_policy_versions (
  policy_id    bigint NOT NULL REFERENCES access_policies (id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version > 0),
  row_filter   text,
  column_rules jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(column_rules) = 'array'),
  change_note  text,
  created_by   uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, version)
);

-- ───────────────────────── 7. BI & semantic model ─────────────────────────
CREATE TABLE semantic_dimensions (
  id          bigserial PRIMARY KEY,
  code        varchar(64)  NOT NULL UNIQUE,
  name        varchar(255) NOT NULL,
  dataset_id  bigint NOT NULL REFERENCES datasets (id),
  column_name varchar(128) NOT NULL,
  description text
);

CREATE TABLE semantic_metrics (
  id                 bigserial PRIMARY KEY,
  code               varchar(64)  NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name               varchar(255) NOT NULL,
  definition         text NOT NULL,
  expression         text NOT NULL,
  base_dataset_id    bigint NOT NULL REFERENCES datasets (id),
  allowed_dimensions text[] NOT NULL DEFAULT '{}',
  unit               varchar(32),
  owner_id           uuid NOT NULL REFERENCES users (id),
  glossary_term_id   bigint REFERENCES glossary_terms (id),
  status             metric_status NOT NULL DEFAULT 'DRAFT',
  version            integer NOT NULL DEFAULT 1,
  certified_by       uuid REFERENCES users (id),
  certified_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'CERTIFIED' OR (certified_by IS NOT NULL AND certified_at IS NOT NULL))
);
CREATE TRIGGER trg_metrics_updated BEFORE UPDATE ON semantic_metrics FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE semantic_metric_versions (
  metric_id  bigint NOT NULL REFERENCES semantic_metrics (id) ON DELETE CASCADE,
  version    integer NOT NULL,
  expression text NOT NULL,
  definition text NOT NULL,
  changed_by uuid NOT NULL REFERENCES users (id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_id, version)
);

CREATE TABLE dashboards (
  id             bigserial PRIMARY KEY,
  title          varchar(255) NOT NULL,
  description    text,
  topic          varchar(64) NOT NULL CHECK (topic IN ('TRAINING', 'HR', 'RESEARCH', 'FINANCE', 'DATA_QUALITY')),
  owner_id       uuid NOT NULL REFERENCES users (id),
  status         dashboard_status NOT NULL DEFAULT 'DRAFT',
  global_filters jsonb NOT NULL DEFAULT '[]',
  version        integer NOT NULL DEFAULT 1,
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);
CREATE TRIGGER trg_dashboards_updated BEFORE UPDATE ON dashboards FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dashboard_widgets (
  id           bigserial PRIMARY KEY,
  dashboard_id bigint NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  type         varchar(32) NOT NULL CHECK (type IN ('KPI', 'BAR', 'LINE', 'PIE', 'HEATMAP', 'TABLE')),
  title        varchar(255) NOT NULL,
  query_spec   jsonb NOT NULL,
  position     jsonb NOT NULL
);

CREATE TABLE dashboard_shares (
  dashboard_id   bigint NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  principal_type principal_type NOT NULL,
  principal_id   varchar(128) NOT NULL,
  PRIMARY KEY (dashboard_id, principal_type, principal_id)
);

CREATE TABLE dashboard_favorites (
  user_id      uuid   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  dashboard_id bigint NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dashboard_id)
);

CREATE TABLE report_subscriptions (
  id                 bigserial PRIMARY KEY,
  dashboard_id       bigint NOT NULL REFERENCES dashboards (id),
  owner_id           uuid NOT NULL REFERENCES users (id),
  cron               varchar(64) NOT NULL,
  format             report_format NOT NULL DEFAULT 'PDF',
  filters            jsonb NOT NULL DEFAULT '{}',
  include_ai_summary boolean NOT NULL DEFAULT true,
  status             subscription_status NOT NULL DEFAULT 'ACTIVE',
  next_run_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_subscriptions_due ON report_subscriptions (next_run_at) WHERE status = 'ACTIVE';

CREATE TABLE subscription_recipients (
  subscription_id bigint NOT NULL REFERENCES report_subscriptions (id) ON DELETE CASCADE,
  user_id         uuid   NOT NULL REFERENCES users (id),
  PRIMARY KEY (subscription_id, user_id)
);

CREATE TABLE report_deliveries (
  id              bigserial PRIMARY KEY,
  subscription_id bigint NOT NULL REFERENCES report_subscriptions (id) ON DELETE CASCADE,
  recipient_id    uuid NOT NULL REFERENCES users (id),
  status          delivery_status NOT NULL,
  artifact_uri    text,
  ai_summary      text,
  error_message   text,
  sent_at         timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── 8. Bất thường & lineage ─────────────────────────
CREATE TABLE anomaly_detectors (
  id         bigserial PRIMARY KEY,
  kind       detector_kind NOT NULL,
  dataset_id bigint REFERENCES datasets (id),
  metric_id  bigint REFERENCES semantic_metrics (id),
  params     jsonb NOT NULL DEFAULT '{}',
  enabled    boolean NOT NULL DEFAULT true,
  CHECK (num_nonnulls(dataset_id, metric_id) = 1),
  CHECK (kind <> 'METRIC_DRIFT' OR metric_id IS NOT NULL)
);

CREATE TABLE anomaly_alerts (
  id              bigserial PRIMARY KEY,
  detector_id     bigint NOT NULL REFERENCES anomaly_detectors (id),
  run_id          uuid REFERENCES pipeline_runs (id),
  observed_value  numeric NOT NULL,
  expected_low    numeric,
  expected_high   numeric,
  severity        alert_severity NOT NULL,
  status          alert_status NOT NULL DEFAULT 'OPEN',
  note            text,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES users (id),
  acknowledged_at timestamptz,
  closed_at       timestamptz,
  CHECK (status = 'OPEN' OR status = 'DISMISSED' OR acknowledged_by IS NOT NULL),
  CHECK ((status IN ('RESOLVED', 'DISMISSED')) = (closed_at IS NOT NULL))
);
CREATE INDEX ix_alerts_open ON anomaly_alerts (detected_at DESC) WHERE status IN ('OPEN', 'ACKNOWLEDGED');

CREATE TABLE lineage_nodes (
  id        bigserial PRIMARY KEY,
  node_type lineage_node_type NOT NULL,
  ref_id    varchar(128) NOT NULL,
  name      varchar(255) NOT NULL,
  UNIQUE (node_type, ref_id)
);

CREATE TABLE lineage_edges (
  id            bigserial PRIMARY KEY,
  from_node_id  bigint NOT NULL REFERENCES lineage_nodes (id) ON DELETE CASCADE,
  to_node_id    bigint NOT NULL REFERENCES lineage_nodes (id) ON DELETE CASCADE,
  transform_ref varchar(255),
  observed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_node_id, to_node_id),
  CHECK (from_node_id <> to_node_id)
);
CREATE INDEX ix_lineage_to ON lineage_edges (to_node_id);

-- ───────────────────────── 9. Hỏi-đáp, thông báo, audit ─────────────────────────
CREATE TABLE qa_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id),
  title      varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qa_messages (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES qa_conversations (id) ON DELETE CASCADE,
  role            qa_role NOT NULL,
  content         text NOT NULL,
  status          qa_status,
  semantic_query  jsonb,
  compiled_sql    text,
  metric_codes    text[] NOT NULL DEFAULT '{}',
  data_as_of      timestamptz,
  refusal_reason  varchar(64),
  model           varchar(64),
  latency_ms      integer CHECK (latency_ms >= 0),
  feedback        smallint CHECK (feedback IN (-1, 1)),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'USER') = (status IS NULL)),
  CHECK (status <> 'REFUSED' OR refusal_reason IS NOT NULL),
  -- BR16: câu trả lời luôn kèm metric và thời điểm dữ liệu
  CHECK (status <> 'ANSWERED' OR (cardinality(metric_codes) > 0 AND data_as_of IS NOT NULL))
);
CREATE INDEX ix_qa_messages_conv ON qa_messages (conversation_id, created_at);

CREATE TABLE qa_blocked_topics (
  id          bigserial PRIMARY KEY,
  pattern     varchar(255) NOT NULL,
  description text,
  created_by  uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       varchar(64)  NOT NULL,
  title      varchar(255) NOT NULL,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notifications_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- BR10: audit log bất biến, phân vùng theo tháng
CREATE TABLE audit_logs (
  id          bigserial,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid REFERENCES users (id),
  action      varchar(64) NOT NULL,
  object_type varchar(64) NOT NULL,
  object_id   varchar(128),
  outcome     audit_outcome NOT NULL,
  ip          inet,
  details     jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
CREATE INDEX ix_audit_actor  ON audit_logs (actor_id, occurred_at DESC);
CREATE INDEX ix_audit_object ON audit_logs (object_type, object_id);

CREATE FUNCTION forbid_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs chỉ cho phép INSERT' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
-- Tài khoản ứng dụng chỉ được INSERT/SELECT; tạo partition mới bằng job bảo trì hằng tháng.
-- GRANT INSERT, SELECT ON audit_logs TO aiia_app;

-- ───────────────────────── View & hàm nghiệp vụ ─────────────────────────
-- Quyền dữ liệu đang hiệu lực (AC03, BR08)
CREATE VIEW v_effective_grants AS
SELECT g.id, g.user_id, g.resource_type, g.resource_id, g.access_level, g.scope, g.valid_from, g.valid_to
FROM access_grants g
JOIN users u ON u.id = g.user_id AND u.status = 'ACTIVE'
WHERE g.revoked_at IS NULL AND now() BETWEEN g.valid_from AND g.valid_to;

-- Dataset Gold vượt SLA độ mới (BR15)
CREATE VIEW v_stale_datasets AS
SELECT d.id, d.layer, d.schema_name, d.table_name, d.last_updated_at, d.freshness_sla_minutes
FROM datasets d
WHERE d.freshness_sla_minutes IS NOT NULL
  AND (d.last_updated_at IS NULL OR d.last_updated_at < now() - make_interval(mins => d.freshness_sla_minutes));

-- Worker gọi hằng giờ: đánh dấu yêu cầu đã hết hạn (BR09). Trả về số yêu cầu được cập nhật.
CREATE FUNCTION expire_access() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE access_requests r SET status = 'EXPIRED'
  FROM access_grants g
  WHERE g.request_id = r.id AND r.status = 'APPROVED' AND g.revoked_at IS NULL AND g.valid_to < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ───────────────────────── Dữ liệu khởi tạo ─────────────────────────
INSERT INTO org_units (code, name, type) VALUES ('UNI', 'Trường Đại học (mẫu)', 'UNIVERSITY');
INSERT INTO org_units (code, name, type, parent_id)
SELECT v.code, v.name, v.type::org_unit_type, (SELECT id FROM org_units WHERE code = 'UNI')
FROM (VALUES
  ('CNTT', 'Khoa Công nghệ thông tin', 'FACULTY'),
  ('KT',   'Khoa Kinh tế',             'FACULTY'),
  ('NN',   'Khoa Ngoại ngữ',           'FACULTY'),
  ('PDT',  'Phòng Đào tạo',            'OFFICE'),
  ('TCCB', 'Phòng Tổ chức cán bộ',     'OFFICE'),
  ('KHCN', 'Phòng Khoa học công nghệ', 'OFFICE'),
  ('TTDL', 'Trung tâm Dữ liệu',        'CENTER')
) AS v(code, name, type);

INSERT INTO users (sso_subject, email, full_name, org_unit_id)
VALUES ('system', 'system@aiia.local', 'AiiA System', (SELECT id FROM org_units WHERE code = 'TTDL'));

INSERT INTO qa_blocked_topics (pattern, description, created_by)
SELECT p, d, (SELECT id FROM users WHERE sso_subject = 'system')
FROM (VALUES
  ('danh sách cá nhân kèm CCCD',   'Không trả định danh RESTRICTED'),
  ('xếp hạng cá nhân theo lương',  'Dữ liệu lương cá nhân'),
  ('sức khỏe|bệnh án',             'Dữ liệu sức khỏe ngoài phạm vi')
) AS t(p, d);

COMMIT;
