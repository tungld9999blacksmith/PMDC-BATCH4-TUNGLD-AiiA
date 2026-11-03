/** Chuyển mô hình nội bộ của mock sang hình dạng trong openapi.yaml. */
import type {
  AccessGrant,
  AccessRequest,
  Alert,
  Dashboard,
  DashboardSummary,
  DataSource,
  Dataset,
  DatasetColumn,
  DqIssue,
  DqRule,
  Freshness,
  Metric,
  PipelineRun,
} from '../api/models';
import type { MockDb } from './db';
import type { MAccessRequest, MAlert, MColumn, MDashboard, MDataset, MGrant, MIssue, MMetric, MRule, MRun, MSource, MUser } from './types';

export function freshness(db: MockDb, ds: MDataset | undefined): Freshness {
  if (!ds) return { sources: [], stale: false };
  return {
    sources: ds.sourceCode ? [ds.sourceCode.replace('SRC-', '')] : [],
    updatedAt: new Date(ds.lastUpdatedAt).toISOString(),
    stale: db.clock() - ds.lastUpdatedAt > ds.freshnessSlaMinutes * 60_000,
    dqScore: datasetScore(db, ds.id),
  };
}

export function datasetScore(db: MockDb, datasetId: number): number | null {
  const rates = db.rules.filter((r) => r.datasetId === datasetId && r.status === 'ACTIVE' && r.lastPassRate !== null).map((r) => r.lastPassRate as number);
  return rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : null;
}

export function runOf(db: MockDb, run: MRun): PipelineRun {
  const status = db.runStatus(run);
  const done = status !== 'QUEUED' && status !== 'RUNNING';
  return {
    id: run.id,
    sourceId: run.sourceId,
    sourceCode: db.sources.find((s) => s.id === run.sourceId)?.code,
    trigger: run.trigger,
    status,
    rowsRead: status === 'QUEUED' ? 0 : done ? run.rowsRead : Math.round(run.rowsRead * 0.6),
    rowsWritten: done ? run.rowsWritten : 0,
    rowsQuarantined: done ? run.rowsQuarantined : 0,
    queuedAt: new Date(run.queuedAt).toISOString(),
    startedAt: status === 'QUEUED' ? null : new Date(run.queuedAt + 1500).toISOString(),
    finishedAt: done ? new Date(run.queuedAt + run.durationMs).toISOString() : null,
  };
}

export function sourceOf(db: MockDb, s: MSource): DataSource {
  const last = db.runs.filter((r) => r.sourceId === s.id).sort((a, b) => b.queuedAt - a.queuedAt)[0];
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    type: s.type,
    status: s.status,
    businessOwner: s.businessOwner,
    purpose: s.purpose,
    legalBasisRef: s.legalBasisRef,
    legalDocUri: s.legalDocUri,
    sensitivity: s.sensitivity,
    subjectTypes: s.subjectTypes,
    connectionConfig: s.connectionConfig,
    fileTemplate: s.fileTemplate,
    owner: db.userRef(s.ownerId),
    hasSecret: s.hasSecret,
    schedule: s.schedule ?? undefined,
    lastRun: last ? runOf(db, last) : undefined,
  };
}

export function columnOf(db: MockDb, c: MColumn): DatasetColumn {
  const term = c.glossaryTermId ? db.glossary.find((g) => g.id === c.glossaryTermId) : undefined;
  return {
    id: c.id,
    name: c.name,
    dataType: c.dataType,
    description: c.description,
    sensitivity: c.sensitivity,
    glossaryTerm: term ? { id: term.id, name: term.name, definition: term.definition, owner: db.userRef(term.ownerId) } : undefined,
  };
}

export function hasDatasetAccess(db: MockDb, user: MUser, ds: MDataset): boolean {
  if (db.hasRole(user, 'DATA_ENGINEER', 'DATA_STEWARD')) return true;
  if (ds.layer === 'GOLD' && db.hasRole(user, 'BI_ANALYST')) return true;
  return db.hasGrant(user.id, 'DATASET', String(ds.id));
}

export function datasetOf(db: MockDb, user: MUser, ds: MDataset): Dataset {
  return {
    id: ds.id,
    layer: ds.layer,
    schemaName: ds.schemaName,
    tableName: ds.tableName,
    displayName: ds.displayName,
    description: ds.description,
    owner: db.userRef(ds.ownerId),
    steward: db.userRef(ds.stewardId),
    tags: ds.tags,
    freshness: freshness(db, ds),
    accessible: hasDatasetAccess(db, user, ds),
  };
}

export function ruleOf(r: MRule): DqRule {
  return {
    id: r.id,
    datasetId: r.datasetId,
    columnId: r.columnId,
    ruleType: r.ruleType,
    dimension: r.dimension,
    severity: r.severity,
    params: r.params,
    description: r.description,
    status: r.status,
    version: r.version,
    lastPassRate: r.lastPassRate,
    lastDryRunVersion: r.lastDryRunVersion,
  };
}

export function issueOf(db: MockDb, i: MIssue): DqIssue {
  const rule = db.rules.find((r) => r.id === i.ruleId);
  return {
    id: i.id,
    rule: rule ? ruleOf(rule) : undefined,
    datasetId: i.datasetId,
    affectedRows: i.affectedRows,
    severity: i.severity,
    status: i.status,
    assignee: db.userRef(i.assigneeId),
    lastRunId: i.lastRunId,
    createdAt: i.createdAt,
    comments: i.comments.map((c) => ({ id: c.id, author: db.userRef(c.authorId), body: c.body, createdAt: c.createdAt })),
  };
}

export function requestOf(db: MockDb, r: MAccessRequest): AccessRequest {
  return {
    id: r.id,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    resourceName: r.resourceName,
    accessLevel: r.accessLevel,
    purpose: r.purpose,
    scope: r.scope,
    requestedDays: r.requestedDays,
    requester: db.userRef(r.requesterId),
    status: r.status,
    reviewer: db.userRef(r.reviewerId),
    reviewNote: r.reviewNote,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    expiresAt: r.expiresAt,
  };
}

export function grantOf(db: MockDb, g: MGrant): AccessGrant {
  return {
    id: g.id,
    resourceType: g.resourceType,
    resourceId: g.resourceId,
    resourceName: g.resourceName,
    accessLevel: g.accessLevel,
    validFrom: g.validFrom,
    validTo: g.validTo,
    grantedBy: db.userRef(g.grantedById),
  };
}

export function canSeeDashboard(db: MockDb, user: MUser, d: MDashboard): boolean {
  if (d.ownerId === user.id) return true;
  if (d.status !== 'PUBLISHED') return false;
  return d.shares.some(
    (s) =>
      (s.principalType === 'USER' && s.principalId === user.id) ||
      (s.principalType === 'ROLE' && user.roles.some((r) => r.role === s.principalId)) ||
      (s.principalType === 'ORG_UNIT' && (user.orgUnitCode === s.principalId || user.roles.some((r) => r.scopeOrgUnit === s.principalId))),
  );
}

export function dashboardSummaryOf(db: MockDb, user: MUser, d: MDashboard): DashboardSummary {
  const datasets = [...new Set(d.widgets.flatMap((w) => w.querySpec.metrics))]
    .map((code) => db.metrics.find((m) => m.code === code)?.baseDatasetId)
    .map((id) => (id ? db.dataset(id) : undefined))
    .filter((x): x is MDataset => !!x);
  const oldest = datasets.sort((a, b) => a.lastUpdatedAt - b.lastUpdatedAt)[0];
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    topic: d.topic,
    status: d.status,
    owner: db.userRef(d.ownerId),
    favorite: db.favorites.has(`${user.id}:${d.id}`),
    freshness: freshness(db, oldest),
  };
}

export function dashboardOf(db: MockDb, user: MUser, d: MDashboard): Dashboard {
  return {
    ...dashboardSummaryOf(db, user, d),
    title: d.title,
    topic: d.topic,
    globalFilters: d.globalFilters,
    widgets: d.widgets,
    version: d.version,
    shares: d.shares,
    canEdit: d.ownerId === user.id,
  };
}

export function metricOf(db: MockDb, m: MMetric): Metric {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    definition: m.definition,
    expression: m.expression,
    baseDatasetId: m.baseDatasetId,
    allowedDimensions: m.allowedDimensions,
    unit: m.unit,
    glossaryTermId: m.glossaryTermId,
    status: m.status,
    version: m.version,
    owner: db.userRef(m.ownerId),
    certifiedBy: db.userRef(m.certifiedById),
    certifiedAt: m.certifiedAt,
  };
}

export function alertOf(db: MockDb, a: MAlert): Alert {
  return {
    id: a.id,
    kind: a.kind,
    target: { type: a.targetType, id: a.targetId, name: a.targetName },
    observedValue: a.observedValue,
    expectedLow: a.expectedLow,
    expectedHigh: a.expectedHigh,
    severity: a.severity,
    status: a.status,
    detectedAt: a.detectedAt,
    acknowledgedBy: db.userRef(a.acknowledgedById),
    note: a.note,
  };
}
