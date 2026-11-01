/** Mô hình dữ liệu nội bộ của mock API (không phải hợp đồng API). */
import type {
  AlertSeverity,
  AlertStatus,
  DataLayer,
  DashboardTopic,
  DetectorKind,
  DqDimension,
  DqIssueStatus,
  DqRuleStatus,
  LineageNodeType,
  MatchRecord,
  MatchStatus,
  MetricStatus,
  ResourceType,
  RoleAssignment,
  Sensitivity,
  Share,
  SourceStatus,
  SourceType,
  SubjectType,
  Widget,
  AssistantMessage,
  AccessRequestStatus,
} from '../api/models';

export interface MUser {
  id: string;
  email: string;
  fullName: string;
  orgUnitCode: string;
  status: 'ACTIVE' | 'INACTIVE';
  roles: RoleAssignment[];
  lastLoginAt: string | null;
}

export interface MOrgUnit {
  code: string;
  name: string;
  type: 'UNIVERSITY' | 'FACULTY' | 'DEPARTMENT' | 'OFFICE' | 'CENTER';
  parentCode: string | null;
}

export interface MCourseResult {
  code: string;
  name: string;
  credits: number;
  score: number;
  letter: string;
}

export interface MTermResult {
  term: string;
  year: string;
  gpa: number;
  gpaCum: number;
  credits: number;
  warning: number;
  conduct: number;
  courses: MCourseResult[];
}

export interface MTuition {
  term: string;
  due: number;
  paid: number;
  scholarship: number;
  status: 'PAID' | 'PARTIAL' | 'UNPAID';
}

export interface MStudent {
  code: string;
  faculty: string;
  program: string;
  cohort: string;
  className: string;
  status: 'STUDYING' | 'RESERVED' | 'GRADUATED' | 'DROPPED';
  admissionDate: string;
  terms: MTermResult[];
  tuition: MTuition[];
  lms: { date: string; course: string; logins: number; submissions: number; minutes: number }[];
  libraryLoans: number;
  awards: { date: string; title: string; level: string }[];
  disciplines: { date: string; title: string }[];
  dormitory: boolean;
  employment: string | null;
}

export interface MLecturer {
  code: string;
  faculty: string;
  title: string | null;
  degree: string;
  employment: string;
  teaching: { term: string; course: string; courseName: string; sections: number; hours: number }[];
  research: { type: 'PUBLICATION' | 'PROJECT' | 'SUPERVISION'; title: string; year: number; level: string; role: string }[];
  evaluations: { term: string; course: string; responses: number; score: number }[];
}

export interface MStaff {
  code: string;
  unit: string;
  position: string;
  grade: string;
  contract: string;
  startDate: string;
  trainings: { year: number; title: string }[];
  awards: { date: string; title: string; level: string }[];
}

export interface MPerson {
  id: string;
  fullName: string;
  dob: string;
  gender: 'Nam' | 'Nữ';
  email: string;
  phone: string;
  nationalId: string;
  primaryUnit: string;
  roles: SubjectType[];
  student?: MStudent;
  lecturer?: MLecturer;
  staff?: MStaff;
  updatedAt: string;
  completeness: number;
  /** Tên như được ghi ở từng nguồn — dùng cho nguồn gốc thuộc tính. */
  sourceNames: Record<string, string>;
}

export interface MSource {
  id: number;
  code: string;
  name: string;
  type: SourceType;
  status: SourceStatus;
  ownerId: string;
  businessOwner: string;
  purpose: string;
  legalBasisRef: string;
  legalDocUri?: string;
  sensitivity: Sensitivity;
  subjectTypes: SubjectType[];
  connectionConfig: Record<string, unknown>;
  fileTemplate?: { requiredColumns: string[] };
  hasSecret: boolean;
  connectionTested: boolean;
  schedule: { cron: string; paused: boolean } | null;
  targetDatasetId: number;
}

export interface MRun {
  id: string;
  sourceId: number;
  trigger: 'MANUAL' | 'SCHEDULE' | 'RERUN' | 'REPROCESS';
  queuedAt: number;
  durationMs: number;
  outcome: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  rowsRead: number;
  rowsWritten: number;
  rowsQuarantined: number;
  errorMessage: string | null;
  parentRunId: string | null;
  uploadId: string | null;
}

export interface MUpload {
  id: string;
  sourceId: number;
  fileName: string;
  rowCount: number;
  checksum: string;
  columns: string[];
  rows: unknown[][];
  duplicateOfBatchId: number | null;
}

export interface MBatch {
  id: number;
  sourceId: number;
  checksum: string;
  runId: string;
}

export interface MMapping {
  id: number;
  sourceId: number;
  targetDatasetId: number;
  version: number;
  active: boolean;
  rules: { sourceColumn: string | null; targetColumn: string; transform: string | null }[];
  createdById: string;
  createdAt: string;
}

export interface MColumn {
  id: number;
  name: string;
  dataType: string;
  description: string;
  sensitivity: Sensitivity;
  glossaryTermId: number | null;
  required?: boolean;
}

export interface MDataset {
  id: number;
  layer: DataLayer;
  schemaName: string;
  tableName: string;
  displayName: string;
  description: string;
  sourceCode: string | null;
  ownerId: string;
  stewardId: string;
  freshnessSlaMinutes: number;
  lastUpdatedAt: number;
  rowCount: number;
  dqScore: number | null;
  tags: string[];
  columns: MColumn[];
}

export interface MGlossaryTerm {
  id: number;
  name: string;
  definition: string;
  ownerId: string;
}

export interface MRule {
  id: number;
  datasetId: number;
  columnId: number | null;
  ruleType: 'NOT_NULL' | 'UNIQUE' | 'RANGE' | 'REGEX' | 'REFERENCE' | 'FRESHNESS' | 'CUSTOM_SQL';
  dimension: DqDimension;
  severity: 'BLOCKING' | 'WARNING';
  params: Record<string, unknown>;
  description: string;
  status: DqRuleStatus;
  version: number;
  lastPassRate: number | null;
  lastDryRunVersion: number | null;
}

export interface MIssue {
  id: number;
  ruleId: number;
  datasetId: number;
  affectedRows: number;
  severity: 'BLOCKING' | 'WARNING';
  status: DqIssueStatus;
  assigneeId: string | null;
  lastRunId: string;
  createdAt: string;
  comments: { id: number; authorId: string; body: string; createdAt: string }[];
}

export interface MCandidate {
  id: number;
  score: number;
  status: MatchStatus;
  left: MatchRecord;
  right: MatchRecord;
  comparison: Record<string, 'MATCH' | 'PARTIAL' | 'DIFFERENT' | 'MISSING'>;
  createdAt: string;
}

export interface MMergeEvent {
  id: number;
  action: 'MERGE' | 'UNMERGE';
  survivorPersonId: string;
  mergedPersonId: string;
  actorId: string | null;
  createdAt: string;
  candidateId: number | null;
}

export interface MAccessRequest {
  id: number;
  requesterId: string;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  accessLevel: 'READ' | 'EXPORT';
  purpose: string;
  scope: Record<string, unknown>;
  requestedDays: number;
  status: AccessRequestStatus;
  reviewerId: string | null;
  reviewNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export interface MGrant {
  id: number;
  userId: string;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  accessLevel: 'READ' | 'EXPORT';
  validFrom: string;
  validTo: string;
  revokedAt: string | null;
  grantedById: string;
  requestId: number | null;
}

export interface MDashboard {
  id: number;
  title: string;
  description: string;
  topic: DashboardTopic;
  ownerId: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  globalFilters: string[];
  widgets: Widget[];
  version: number;
  shares: Share[];
  publishedAt: string | null;
}

export interface MExport {
  id: string;
  userId: string;
  format: 'PDF' | 'CSV';
  createdAt: number;
  watermark: string;
  excludedColumns: string[];
  content: string | null;
}

export type FactBase = 'student' | 'lecturer' | 'research' | 'dq';

export interface MMetric {
  id: number;
  code: string;
  name: string;
  definition: string;
  expression: string;
  baseDatasetId: number;
  allowedDimensions: string[];
  unit: string;
  ownerId: string;
  glossaryTermId: number | null;
  status: MetricStatus;
  version: number;
  certifiedById: string | null;
  certifiedAt: string | null;
  versions: { version: number; expression: string; changedById: string; changedAt: string }[];
}

export interface MSubscription {
  id: number;
  ownerId: string;
  dashboardId: number;
  cron: string;
  format: 'PDF' | 'LINK';
  filters: { dimension: string; op: 'eq' | 'neq' | 'in' | 'between' | 'gte' | 'lte'; value?: unknown }[];
  includeAiSummary: boolean;
  recipientIds: string[];
  status: 'ACTIVE' | 'PAUSED';
  nextRunAt: string | null;
}

export interface MDelivery {
  id: number;
  subscriptionId: number;
  recipientId: string;
  status: 'SENT' | 'SKIPPED_NO_ACCESS' | 'FAILED';
  aiSummary: string | null;
  sentAt: string;
}

export interface MAlert {
  id: number;
  kind: DetectorKind;
  targetType: 'DATASET' | 'METRIC';
  targetId: string;
  targetName: string;
  observedValue: number;
  expectedLow: number | null;
  expectedHigh: number | null;
  severity: AlertSeverity;
  status: AlertStatus;
  detectedAt: string;
  acknowledgedById: string | null;
  note: string | null;
  runId: string | null;
  series: { at: string; value: number; low: number | null; high: number | null; anomalous: boolean }[];
}

export interface MLineageNode {
  id: number;
  type: LineageNodeType;
  refId: string;
  name: string;
  layer?: DataLayer;
}

export interface MConversation {
  id: string;
  userId: string;
  title: string;
  dashboardId: number | null;
  createdAt: string;
  messages: (AssistantMessage & { question?: string })[];
}

export interface MPolicy {
  id: number;
  name: string;
  datasetId: number;
  roleCode: RoleAssignment['role'];
  active: boolean;
  versions: {
    version: number;
    rowFilter: string | null;
    columnRules: { column: string; action: 'MASK_PARTIAL' | 'HASH' | 'DENY' }[];
    changeNote: string | null;
    createdById: string;
    createdAt: string;
  }[];
}

export interface MAudit {
  id: number;
  occurredAt: string;
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  outcome: 'ALLOW' | 'DENY';
  ip: string;
  details: Record<string, unknown>;
}

export interface MNotification {
  id: number;
  userId: string;
  type: string;
  title: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface MBlockedTopic {
  id: number;
  pattern: string;
  description: string | null;
  createdById: string;
  createdAt: string;
}

export interface MRecent {
  userId: string;
  kind: 'PROFILE' | 'DASHBOARD' | 'DATASET';
  id: string;
  title: string;
  viewedAt: string;
}
