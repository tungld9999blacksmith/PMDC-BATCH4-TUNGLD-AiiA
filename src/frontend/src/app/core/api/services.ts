/** Service gọi Platform API theo nhóm tag trong docs/api/openapi.yaml. */
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SessionService } from '../auth/session.service';
import { MockBackend } from '../mock/mock-backend';
import { streamSse } from '../sse/sse';
import { ApiClient, type Query } from './api-client';
import type {
  AccessGrant,
  AccessRequest,
  AccessRequestInput,
  AdminUser,
  Alert,
  AlertDetail,
  AskRequest,
  AssistantEvent,
  AssistantMessage,
  AttributeProvenance,
  AuditLog,
  BlockedTopic,
  ColumnRule,
  Comment,
  ConnectionTestResult,
  Conversation,
  Dashboard,
  DashboardInput,
  DashboardSummary,
  DataSource,
  DataSourceInput,
  DataSourcePatch,
  Dataset,
  DatasetColumn,
  DatasetDetail,
  Delivery,
  Dimension,
  DqIssue,
  DqRule,
  DqRuleInput,
  DqScoreBoard,
  DryRunResult,
  ExportJob,
  FacetCode,
  FacetData,
  Filter,
  GlossaryTerm,
  GlossaryTermInput,
  HomeSummary,
  LineageGraph,
  LineageNode,
  MappingPreview,
  MatchCandidate,
  Me,
  MergeEvent,
  Metric,
  MetricDetail,
  MetricInput,
  Notification,
  OrgUnit,
  Page,
  PipelineRun,
  PipelineRunDetail,
  Policy,
  PolicyRules,
  PolicyVersion,
  Profile360,
  ProfileSummary,
  QueryResult,
  RoleAssignment,
  RoleCode,
  RunLogEvent,
  Schedule,
  SchemaMapping,
  SchemaMappingInput,
  SemanticQuery,
  Share,
  Subscription,
  SubscriptionInput,
  TabularResult,
  TimelineEvent,
  UploadResult,
} from './models';

@Injectable({ providedIn: 'root' })
export class MeApi {
  private readonly api = inject(ApiClient);
  me = () => this.api.get<Me>('/me');
  grants = () => this.api.get<AccessGrant[]>('/me/grants');
  home = () => this.api.get<HomeSummary>('/me/home');
  notifications = (q: Query = {}) => this.api.get<Page<Notification>>('/notifications', q);
  markRead = (id: number) => this.api.post<void>(`/notifications/${id}/read`);
}

@Injectable({ providedIn: 'root' })
export class ProfilesApi {
  private readonly api = inject(ApiClient);
  search = (q: Query) => this.api.get<Page<ProfileSummary>>('/profiles', q);
  get = (id: string, role?: string) => this.api.get<Profile360>(`/profiles/${id}`, { role });
  facet = (id: string, facet: FacetCode) => this.api.get<FacetData>(`/profiles/${id}/facets/${facet}`);
  timeline = (id: string, q: Query) => this.api.get<{ items: TimelineEvent[]; nextBefore: string | null }>(`/profiles/${id}/timeline`, q);
  provenance = (id: string, attribute: string) => this.api.get<AttributeProvenance>(`/profiles/${id}/attributes/${attribute}/provenance`);
}

@Injectable({ providedIn: 'root' })
export class IntegrationApi {
  private readonly api = inject(ApiClient);
  private readonly session = inject(SessionService);
  private readonly mock = inject(MockBackend);

  sources = (q: Query = {}) => this.api.get<Page<DataSource>>('/sources', { pageSize: 100, ...q });
  source = (id: number) => this.api.get<DataSource>(`/sources/${id}`);
  createSource = (input: DataSourceInput) => this.api.post<DataSource>('/sources', input);
  updateSource = (id: number, patch: DataSourcePatch) => this.api.patch<DataSource>(`/sources/${id}`, patch);
  testConnection = (id: number, secret?: string) => this.api.post<ConnectionTestResult>(`/sources/${id}/connection-test`, secret ? { secret } : {});
  upload(id: number, file: File): Observable<UploadResult> {
    const form = new FormData();
    form.append('file', file);
    return this.api.post<UploadResult>(`/sources/${id}/uploads`, form);
  }
  setSchedule = (id: number, schedule: Schedule) => this.api.put<Schedule & { nextRunAt?: string | null }>(`/sources/${id}/schedule`, schedule);
  mappings = (id: number) => this.api.get<SchemaMapping[]>(`/sources/${id}/mappings`);
  createMapping = (id: number, input: SchemaMappingInput) => this.api.post<SchemaMapping>(`/sources/${id}/mappings`, input);
  previewMapping = (id: number, input: SchemaMappingInput) => this.api.post<MappingPreview>(`/sources/${id}/mappings/preview`, input);
  triggerRun = (id: number, body: { uploadId?: string; confirmDuplicate?: boolean } = {}) => this.api.post<PipelineRun>(`/sources/${id}/runs`, body);
  runs = (q: Query = {}) => this.api.get<Page<PipelineRun>>('/runs', q);
  run = (id: string) => this.api.get<PipelineRunDetail>(`/runs/${id}`);
  rerun = (id: string, mode: 'RERUN' | 'REPROCESS_QUARANTINE' = 'RERUN') => this.api.post<PipelineRun>(`/runs/${id}/rerun`, { mode });

  /** Log lần chạy theo thời gian thực (SSE). */
  runLogs(id: string): Observable<RunLogEvent> {
    const token = this.session.token();
    if (environment.useMockApi) return this.mock.runLogs(id, token ? `Bearer ${token}` : null);
    return streamSse<RunLogEvent>(`${environment.apiBase}/runs/${id}/logs`, { token });
  }
}

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly api = inject(ApiClient);
  datasets = (q: Query = {}) => this.api.get<Page<Dataset>>('/datasets', q);
  dataset = (id: number) => this.api.get<DatasetDetail>(`/datasets/${id}`);
  updateColumn = (id: number, columnId: number, patch: Partial<Pick<DatasetColumn, 'sensitivity' | 'description'>> & { glossaryTermId?: number | null }) =>
    this.api.patch<DatasetColumn>(`/datasets/${id}/columns/${columnId}`, patch);
  preview = (id: number, q: Query = {}) => this.api.get<TabularResult>(`/datasets/${id}/preview`, q);
  glossary = (q?: string) => this.api.get<GlossaryTerm[]>('/glossary', { q });
  createTerm = (input: GlossaryTermInput) => this.api.post<GlossaryTerm>('/glossary', input);
  updateTerm = (id: number, input: GlossaryTermInput) => this.api.put<GlossaryTerm>(`/glossary/${id}`, input);
}

@Injectable({ providedIn: 'root' })
export class QualityApi {
  private readonly api = inject(ApiClient);
  rules = (q: Query = {}) => this.api.get<DqRule[]>('/dq/rules', q);
  createRule = (input: DqRuleInput) => this.api.post<DqRule>('/dq/rules', input);
  updateRule = (id: number, patch: Partial<DqRuleInput> & { status?: DqRule['status'] }) => this.api.patch<DqRule>(`/dq/rules/${id}`, patch);
  dryRun = (id: number) => this.api.post<DryRunResult>(`/dq/rules/${id}/dry-run`);
  scores = (q: Query = {}) => this.api.get<DqScoreBoard>('/dq/scores', q);
  issues = (q: Query = {}) => this.api.get<Page<DqIssue>>('/dq/issues', q);
  updateIssue = (id: number, patch: { status?: DqIssue['status']; assigneeId?: string | null }) => this.api.patch<DqIssue>(`/dq/issues/${id}`, patch);
  comment = (id: number, body: string) => this.api.post<Comment>(`/dq/issues/${id}/comments`, { body });
}

@Injectable({ providedIn: 'root' })
export class IdentityApi {
  private readonly api = inject(ApiClient);
  candidates = (q: Query = {}) => this.api.get<Page<MatchCandidate>>('/identity/candidates', q);
  decide = (id: number, decision: 'MERGE' | 'NOT_MATCH' | 'SKIP', note?: string) => this.api.post<MatchCandidate>(`/identity/candidates/${id}/decision`, { decision, note });
  history = (personId: string) => this.api.get<MergeEvent[]>(`/identity/persons/${personId}/history`);
  unmerge = (eventId: number, reason: string) => this.api.post<MergeEvent>(`/identity/merge-events/${eventId}/unmerge`, { reason });
}

@Injectable({ providedIn: 'root' })
export class AccessApi {
  private readonly api = inject(ApiClient);
  list = (box: 'mine' | 'review', q: Query = {}) => this.api.get<Page<AccessRequest>>('/access-requests', { box, pageSize: 100, ...q });
  create = (input: AccessRequestInput) => this.api.post<AccessRequest>('/access-requests', input);
  cancel = (id: number) => this.api.delete(`/access-requests/${id}`);
  decide = (id: number, decision: 'APPROVE' | 'REJECT', grantedDays?: number, note?: string) => this.api.post<AccessRequest>(`/access-requests/${id}/decision`, { decision, grantedDays, note });
  revoke = (grantId: number) => this.api.delete(`/access-grants/${grantId}`);
}

@Injectable({ providedIn: 'root' })
export class DashboardsApi {
  private readonly api = inject(ApiClient);
  list = (q: Query = {}) => this.api.get<DashboardSummary[]>('/dashboards', q);
  get = (id: number) => this.api.get<Dashboard>(`/dashboards/${id}`);
  create = (input: DashboardInput) => this.api.post<Dashboard>('/dashboards', input);
  save = (id: number, version: number, input: DashboardInput) => this.api.put<Dashboard>(`/dashboards/${id}`, input, { 'If-Match': String(version) });
  publish = (id: number) => this.api.post<Dashboard>(`/dashboards/${id}/publish`);
  setShares = (id: number, shares: Share[]) => this.api.put<Share[]>(`/dashboards/${id}/shares`, shares);
  favorite = (id: number, on: boolean) => (on ? this.api.put<void>(`/dashboards/${id}/favorite`) : this.api.delete(`/dashboards/${id}/favorite`));
  export = (id: number, format: 'PDF' | 'CSV', widgetId?: number, filters?: Filter[]) => this.api.post<ExportJob>(`/dashboards/${id}/exports`, { format, widgetId, filters });
  exportStatus = (id: string) => this.api.get<ExportJob>(`/exports/${id}`);
}

@Injectable({ providedIn: 'root' })
export class SemanticApi {
  private readonly api = inject(ApiClient);
  query = (q: SemanticQuery) => this.api.post<QueryResult>('/semantic/query', q);
  metrics = (q: Query = {}) => this.api.get<Metric[]>('/semantic/metrics', q);
  metric = (code: string) => this.api.get<MetricDetail>(`/semantic/metrics/${code}`);
  createMetric = (input: MetricInput) => this.api.post<Metric>('/semantic/metrics', input);
  updateMetric = (code: string, input: MetricInput) => this.api.put<Metric>(`/semantic/metrics/${code}`, input);
  certify = (code: string, status: 'CERTIFIED' | 'DEPRECATED') => this.api.post<Metric>(`/semantic/metrics/${code}/certification`, { status });
  validate = (input: MetricInput) => this.api.post<{ valid?: boolean; errors?: string[]; preview?: QueryResult }>('/semantic/metrics/validate', input);
  dimensions = () => this.api.get<Dimension[]>('/semantic/dimensions');
}

@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly api = inject(ApiClient);
  list = () => this.api.get<Subscription[]>('/subscriptions');
  create = (input: SubscriptionInput) => this.api.post<Subscription>('/subscriptions', input);
  update = (id: number, input: Partial<SubscriptionInput>) => this.api.patch<Subscription>(`/subscriptions/${id}`, input);
  remove = (id: number) => this.api.delete(`/subscriptions/${id}`);
  deliveries = (id: number) => this.api.get<Delivery[]>(`/subscriptions/${id}/deliveries`);
}

@Injectable({ providedIn: 'root' })
export class OpsApi {
  private readonly api = inject(ApiClient);
  alerts = (q: Query = {}) => this.api.get<Page<Alert>>('/alerts', q);
  alert = (id: number) => this.api.get<AlertDetail>(`/alerts/${id}`);
  transition = (id: number, to: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED', note?: string) => this.api.post<Alert>(`/alerts/${id}/transition`, { to, note });
  lineage = (q: { nodeType: string; refId: string; direction?: string; depth?: number }) => this.api.get<LineageGraph>('/lineage', q);
  impact = (nodeType: string, refId: string) => this.api.get<LineageNode[]>('/lineage/impact', { nodeType, refId });
}

@Injectable({ providedIn: 'root' })
export class AssistantApi {
  private readonly api = inject(ApiClient);
  private readonly session = inject(SessionService);
  private readonly mock = inject(MockBackend);

  conversations = () => this.api.get<Conversation[]>('/assistant/conversations');
  create = (dashboardId?: number | null) => this.api.post<Conversation>('/assistant/conversations', { dashboardId: dashboardId ?? null });
  conversation = (id: string) => this.api.get<Conversation & { messages: AssistantMessage[] }>(`/assistant/conversations/${id}`);
  rate = (messageId: number, rating: -1 | 1) => this.api.post<void>(`/assistant/messages/${messageId}/feedback`, { rating });

  /** Hỏi trợ lý (SSE). */
  ask(conversationId: string, request: AskRequest): Observable<AssistantEvent> {
    const token = this.session.token();
    if (environment.useMockApi) return this.mock.ask(conversationId, request, token ? `Bearer ${token}` : null);
    return streamSse<AssistantEvent>(`${environment.apiBase}/assistant/conversations/${conversationId}/messages`, { method: 'POST', body: request, token });
  }
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly api = inject(ApiClient);
  users = (q: Query = {}) => this.api.get<Page<AdminUser>>('/admin/users', q);
  createUser = (input: { email: string; fullName: string; orgUnitCode: string; roles?: RoleAssignment[] }) => this.api.post<AdminUser>('/admin/users', input);
  updateUser = (id: string, patch: { status?: 'ACTIVE' | 'INACTIVE'; orgUnitCode?: string }) => this.api.patch<AdminUser>(`/admin/users/${id}`, patch);
  setRoles = (id: string, roles: RoleAssignment[]) => this.api.put<AdminUser>(`/admin/users/${id}/roles`, roles);
  orgUnits = () => this.api.get<OrgUnit[]>('/admin/org-units');
  policies = () => this.api.get<Policy[]>('/admin/policies');
  createPolicy = (input: PolicyRules & { name: string; datasetId: number; roleCode: RoleCode }) => this.api.post<Policy>('/admin/policies', input);
  policyVersions = (id: number) => this.api.get<PolicyVersion[]>(`/admin/policies/${id}/versions`);
  createPolicyVersion = (id: number, input: PolicyRules & { changeNote?: string }) => this.api.post<PolicyVersion>(`/admin/policies/${id}/versions`, input);
  simulate = (input: { datasetId: number; asUserId: string; rowFilter?: string | null; columnRules?: ColumnRule[] }) =>
    this.api.post<TabularResult & { visibleRowCount?: number; totalRowCount?: number }>('/admin/policies/simulate', input);
  auditLogs = (q: Query = {}) => this.api.get<Page<AuditLog>>('/admin/audit-logs', q);
  assistantLogs = (q: Query = {}) => this.api.get<Page<AssistantMessage & { question?: string; user?: { id?: string; fullName?: string }; compiledSql?: string }>>('/admin/assistant-logs', q);
  blockedTopics = () => this.api.get<BlockedTopic[]>('/admin/blocked-topics');
  addBlockedTopic = (pattern: string, description?: string) => this.api.post<BlockedTopic>('/admin/blocked-topics', { pattern, description });
  removeBlockedTopic = (id: number) => this.api.delete(`/admin/blocked-topics/${id}`);
}
