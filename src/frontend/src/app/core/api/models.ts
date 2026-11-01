/**
 * Kiểu dữ liệu dùng trong ứng dụng, lấy từ schema.d.ts sinh bằng `npm run gen:api`
 * (nguồn: docs/api/openapi.yaml). Không sửa tay schema.d.ts.
 */
import type { components } from './schema';

type S = components['schemas'];

export type RoleCode = S['RoleCode'];
export type SubjectType = S['SubjectType'];
export type Sensitivity = S['Sensitivity'];
export type SourceType = S['SourceType'];
export type SourceStatus = S['SourceStatus'];
export type RunStatus = S['RunStatus'];
export type DataLayer = S['DataLayer'];
export type DqDimension = S['DqDimension'];
export type DqRuleStatus = S['DqRuleStatus'];
export type DqIssueStatus = S['DqIssueStatus'];
export type MatchStatus = S['MatchStatus'];
export type ResourceType = S['ResourceType'];
export type AccessRequestStatus = S['AccessRequestStatus'];
export type DashboardTopic = S['DashboardTopic'];
export type MetricStatus = S['MetricStatus'];
export type DetectorKind = S['DetectorKind'];
export type AlertSeverity = S['AlertSeverity'];
export type AlertStatus = S['AlertStatus'];
export type LineageNodeType = S['LineageNodeType'];
export type AssistantStatus = S['AssistantStatus'];
export type FacetCode = S['FacetCode'];

export type Problem = S['Problem'];
export type UserRef = S['UserRef'];
export type OrgUnitRef = S['OrgUnitRef'];
export type Freshness = S['Freshness'];
export type RoleAssignment = S['RoleAssignment'];
export type Me = S['Me'];
export type HomeSummary = S['HomeSummary'];
export type Notification = S['Notification'];

export type ProfileSummary = S['ProfileSummary'];
export type MaskableValue = S['MaskableValue'];
export type Profile360 = S['Profile360'];
export type FacetData = S['FacetData'];
export type TimelineEvent = S['TimelineEvent'];
export type AttributeProvenance = S['AttributeProvenance'];

export type DataSourceInput = S['DataSourceInput'];
export type DataSourcePatch = S['DataSourcePatch'];
export type DataSource = S['DataSource'];
export type ConnectionTestResult = S['ConnectionTestResult'];
export type UploadResult = S['UploadResult'];
export type Schedule = S['Schedule'];
export type MappingRule = S['MappingRule'];
export type SchemaMappingInput = S['SchemaMappingInput'];
export type SchemaMapping = S['SchemaMapping'];
export type MappingPreview = S['MappingPreview'];
export type PipelineRun = S['PipelineRun'];
export type PipelineRunDetail = S['PipelineRunDetail'];

export type Dataset = S['Dataset'];
export type DatasetColumn = S['DatasetColumn'];
export type DatasetDetail = S['DatasetDetail'];
export type TabularResult = S['TabularResult'];
export type GlossaryTermInput = S['GlossaryTermInput'];
export type GlossaryTerm = S['GlossaryTerm'];

export type DqRuleInput = S['DqRuleInput'];
export type DqRule = S['DqRule'];
export type DryRunResult = S['DryRunResult'];
export type DqScoreBoard = S['DqScoreBoard'];
export type DqIssue = S['DqIssue'];
export type Comment = S['Comment'];

export type MatchRecord = S['MatchRecord'];
export type MatchCandidate = S['MatchCandidate'];
export type MergeEvent = S['MergeEvent'];

export type AccessRequestInput = S['AccessRequestInput'];
export type AccessRequest = S['AccessRequest'];
export type AccessGrant = S['AccessGrant'];

export type Filter = S['Filter'];
export type SemanticQuery = S['SemanticQuery'];
export type QueryResult = S['QueryResult'];
export type Widget = S['Widget'];
export type DashboardInput = S['DashboardInput'];
export type DashboardSummary = S['DashboardSummary'];
export type Dashboard = S['Dashboard'];
export type Share = S['Share'];
export type ExportJob = S['ExportJob'];
export type MetricInput = S['MetricInput'];
export type Metric = S['Metric'];
export type MetricDetail = S['MetricDetail'];
export type Dimension = S['Dimension'];

export type SubscriptionInput = S['SubscriptionInput'];
export type Subscription = S['Subscription'];
export type Delivery = S['Delivery'];
export type Alert = S['Alert'];
export type AlertDetail = S['AlertDetail'];
export type LineageNode = S['LineageNode'];
export type LineageGraph = S['LineageGraph'];

export type Conversation = S['Conversation'];
export type AskRequest = S['AskRequest'];
export type AssistantMessage = S['AssistantMessage'];

export type OrgUnit = S['OrgUnit'];
export type AdminUser = S['AdminUser'];
export type ColumnRule = S['ColumnRule'];
export type PolicyRules = S['PolicyRules'];
export type Policy = S['Policy'];
export type PolicyVersion = S['PolicyVersion'];
export type AuditLog = S['AuditLog'];
export type BlockedTopic = S['BlockedTopic'];

/** Trang kết quả dùng chung (PageMeta + items trong openapi.yaml). */
export interface Page<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

/** Ô bị ẩn do nhóm < 5 người (BR12). */
export interface SuppressedCell {
  suppressed: true;
}

export function isSuppressed(value: unknown): value is SuppressedCell {
  return typeof value === 'object' && value !== null && (value as SuppressedCell).suppressed === true;
}

/** Sự kiện SSE của trợ lý (mô tả trong operation askAssistant). */
export type AssistantEvent =
  | { event: 'status'; data: { stage: 'CHECKING' | 'PLANNING' | 'QUERYING' | 'WRITING' } }
  | { event: 'clarify'; data: NonNullable<AssistantMessage['clarify']> }
  | { event: 'token'; data: { text: string } }
  | { event: 'final'; data: AssistantMessage };

/** Sự kiện SSE của log pipeline (operation streamRunLogs). */
export type RunLogEvent =
  | { event: 'log'; data: { ts: string; level: 'INFO' | 'WARN' | 'ERROR'; step: string; message: string } }
  | { event: 'status'; data: PipelineRun }
  | { event: 'end'; data: Record<string, never> };
