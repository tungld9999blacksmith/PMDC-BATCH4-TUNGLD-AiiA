import type { DashboardInput, Filter, MetricInput, SemanticQuery, SubscriptionInput, Widget } from '../../api/models';
import type { MockDb } from '../db';
import { canSeeDashboard, dashboardOf, dashboardSummaryOf, metricOf } from '../mappers';
import { MockRouter, body, noContent, ok, problem, requireRole } from '../router';
import { DIMENSIONS, SemanticError, baseOfMetric, execute, validateExpression } from '../semantic';
import type { MMetric, MSubscription, MUser } from '../types';

function allowUncertified(db: MockDb, user: MUser): boolean {
  return db.hasRole(user, 'BI_ANALYST', 'DATA_STEWARD');
}

function subscriptionOf(db: MockDb, s: MSubscription) {
  const last = db.deliveries.filter((d) => d.subscriptionId === s.id).sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
  return {
    id: s.id,
    dashboardId: s.dashboardId,
    cron: s.cron,
    format: s.format,
    filters: s.filters,
    includeAiSummary: s.includeAiSummary,
    recipientIds: s.recipientIds,
    status: s.status,
    nextRunAt: s.nextRunAt,
    lastDelivery: last ? { id: last.id, recipient: db.userRef(last.recipientId), status: last.status, aiSummary: last.aiSummary, sentAt: last.sentAt } : undefined,
  };
}

function validateMetric(db: MockDb, input: Partial<MetricInput>): string[] {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9_]*$/.test(input.code ?? '')) errors.push('Mã metric viết thường, bắt đầu bằng chữ (VD academic_warning_rate).');
  if (!input.name?.trim()) errors.push('Tên metric là bắt buộc.');
  if (!input.definition?.trim()) errors.push('Định nghĩa nghiệp vụ là bắt buộc.');
  const ds = input.baseDatasetId ? db.dataset(input.baseDatasetId) : undefined;
  if (!ds) errors.push('Chọn dataset nền.');
  else {
    const probe = { baseDatasetId: ds.id } as MMetric;
    errors.push(...validateExpression(input.expression ?? '', baseOfMetric(db, probe)));
    const bad = (input.allowedDimensions ?? []).filter((d) => !DIMENSIONS[d]?.bases.includes(baseOfMetric(db, probe)));
    if (bad.length) errors.push(`Dimension không hợp với dataset nền: ${bad.join(', ')}.`);
  }
  return errors;
}

export function registerBi(router: MockRouter): void {
  router
    // ── Dashboard ──
    .add('GET', '/dashboards', ({ db, user, query }) => {
      const q = (query.get('q') ?? '').toLowerCase();
      const items = db.dashboards
        .filter((d) => d.status !== 'ARCHIVED' && canSeeDashboard(db, user, d))
        .filter((d) => !q || `${d.title} ${d.description}`.toLowerCase().includes(q))
        .filter((d) => !query.get('topic') || d.topic === query.get('topic'))
        .filter((d) => query.get('favorite') !== 'true' || db.favorites.has(`${user.id}:${d.id}`))
        .filter((d) => query.get('mine') !== 'true' || d.ownerId === user.id)
        .map((d) => dashboardSummaryOf(db, user, d));
      return ok(items);
    })
    .add('POST', '/dashboards', (req) => {
      const denied = requireRole(req, 'BI_ANALYST');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<DashboardInput>(req);
      if (!input.title?.trim() || !input.topic) return problem(422, 'Thiếu tiêu đề hoặc chủ đề');
      const d = { id: db.nextId('dashboard', 20), title: input.title.trim(), description: input.description ?? '', topic: input.topic, ownerId: user.id, status: 'DRAFT' as const, globalFilters: input.globalFilters ?? [], widgets: [] as Widget[], version: 1, shares: [], publishedAt: null };
      db.dashboards.push(d);
      return ok(dashboardOf(db, user, d), 201);
    })
    .add('GET', '/dashboards/:id', ({ db, user, params }) => {
      const d = db.dashboards.find((x) => x.id === Number(params['id']));
      if (!d || !canSeeDashboard(db, user, d)) return problem(404, 'Không tìm thấy dashboard');
      db.remember(user.id, 'DASHBOARD', String(d.id), d.title);
      return ok(dashboardOf(db, user, d));
    })
    .add('PUT', '/dashboards/:id', (req) => {
      const denied = requireRole(req, 'BI_ANALYST');
      if (denied) return denied;
      const { db, user, params, headers } = req;
      const d = db.dashboards.find((x) => x.id === Number(params['id']));
      if (!d || !canSeeDashboard(db, user, d)) return problem(404, 'Không tìm thấy dashboard');
      if (d.ownerId !== user.id) return problem(403, 'Chỉ chủ sở hữu được sửa dashboard');
      if (headers['if-match'] !== String(d.version)) return problem(412, 'Dashboard đã được sửa ở phiên khác', 'Tải lại để lấy phiên bản mới nhất trước khi lưu (AC28.2).');
      const input = body<DashboardInput>(req);
      if (!input.title?.trim()) return problem(422, 'Thiếu tiêu đề');
      let nextWidgetId = Math.max(100, ...db.dashboards.flatMap((x) => x.widgets.map((w) => w.id ?? 0))) + 1;
      Object.assign(d, {
        title: input.title.trim(),
        description: input.description ?? d.description,
        topic: input.topic ?? d.topic,
        globalFilters: input.globalFilters ?? d.globalFilters,
        widgets: (input.widgets ?? []).map((w) => ({ ...w, id: w.id ?? nextWidgetId++ })),
        version: d.version + 1,
      });
      return ok(dashboardOf(db, user, d));
    })
    .add('POST', '/dashboards/:id/publish', (req) => {
      const denied = requireRole(req, 'BI_ANALYST');
      if (denied) return denied;
      const { db, user } = req;
      const d = db.dashboards.find((x) => x.id === Number(req.params['id']));
      if (!d || d.ownerId !== user.id) return problem(404, 'Không tìm thấy dashboard');
      if (d.status === 'PUBLISHED') return problem(409, 'Dashboard đã được chia sẻ');
      if (!d.widgets.length) return problem(409, 'Dashboard chưa có widget');
      d.status = 'PUBLISHED';
      d.publishedAt = new Date(db.clock()).toISOString();
      db.audit(user.id, 'DASHBOARD_PUBLISH', 'DASHBOARD', String(d.id));
      return ok(dashboardOf(db, user, d));
    })
    .add('PUT', '/dashboards/:id/shares', (req) => {
      const denied = requireRole(req, 'BI_ANALYST');
      if (denied) return denied;
      const { db, user } = req;
      const d = db.dashboards.find((x) => x.id === Number(req.params['id']));
      if (!d || d.ownerId !== user.id) return problem(404, 'Không tìm thấy dashboard');
      const shares = body<{ principalType: 'ROLE' | 'ORG_UNIT' | 'USER'; principalId: string }[]>(req);
      if (!Array.isArray(shares)) return problem(422, 'Danh sách chia sẻ không hợp lệ');
      d.shares = shares.map((s) => ({ principalType: s.principalType, principalId: s.principalId }));
      db.audit(user.id, 'DASHBOARD_SHARE', 'DASHBOARD', String(d.id), 'ALLOW', { shares: d.shares.length });
      return ok(d.shares);
    })
    .add('PUT', '/dashboards/:id/favorite', ({ db, user, params }) => {
      const d = db.dashboards.find((x) => x.id === Number(params['id']));
      if (!d || !canSeeDashboard(db, user, d)) return problem(404, 'Không tìm thấy dashboard');
      db.favorites.add(`${user.id}:${d.id}`);
      return noContent();
    })
    .add('DELETE', '/dashboards/:id/favorite', ({ db, user, params }) => {
      db.favorites.delete(`${user.id}:${params['id']}`);
      return noContent();
    })
    .add('POST', '/dashboards/:id/exports', (req) => {
      const denied = requireRole(req, 'REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const d = db.dashboards.find((x) => x.id === Number(req.params['id']));
      if (!d || !canSeeDashboard(db, user, d)) return problem(404, 'Không tìm thấy dashboard');
      const input = body<{ format?: 'PDF' | 'CSV'; widgetId?: number; filters?: Filter[] }>(req);
      if (input.format !== 'PDF' && input.format !== 'CSV') return problem(422, 'Định dạng không hợp lệ');
      const watermark = `${user.email} · ${new Date(db.clock()).toLocaleString('vi-VN')}`;
      let content: string | null = null;
      if (input.format === 'CSV') {
        const widget = d.widgets.find((w) => w.id === input.widgetId);
        if (!widget) return problem(422, 'CSV cần chọn một widget', undefined, { errors: [{ field: 'widgetId', message: 'Bắt buộc với CSV' }] });
        try {
          const { result } = execute(db, { ...widget.querySpec, filters: [...(widget.querySpec.filters ?? []), ...(input.filters ?? [])] }, { scope: db.scopeOf(user), allowUncertified: allowUncertified(db, user) });
          const cell = (v: unknown) => (typeof v === 'object' && v !== null ? '< 5' : String(v ?? ''));
          content = [`# ${d.title} — ${widget.title}`, `# Watermark: ${watermark}`, (result.columns ?? []).map((c) => c.name).join(','), ...(result.rows ?? []).map((r) => r.map(cell).join(','))].join('\n');
        } catch (e) {
          return problem(422, e instanceof Error ? e.message : 'Không xuất được');
        }
      }
      const job = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, userId: user.id, format: input.format, createdAt: db.clock(), watermark, excludedColumns: [], content };
      db.exports.push(job);
      db.audit(user.id, 'EXPORT', 'DASHBOARD', String(d.id), 'ALLOW', { format: input.format, widgetId: input.widgetId });
      return ok({ id: job.id, status: 'PENDING', format: job.format, downloadUrl: null, expiresAt: null, watermark, excludedColumns: [] }, 202);
    })
    .add('GET', '/exports/:id', ({ db, user, params }) => {
      const job = db.exports.find((x) => x.id === params['id'] && x.userId === user.id);
      if (!job) return problem(404, 'Không tìm thấy export');
      const ready = db.clock() - job.createdAt > 800;
      const downloadUrl = ready && job.content ? `data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + job.content)}` : null;
      return ok({ id: job.id, status: ready ? 'READY' : 'PENDING', format: job.format, downloadUrl, expiresAt: ready ? new Date(job.createdAt + 15 * 60_000).toISOString() : null, watermark: job.watermark, excludedColumns: job.excludedColumns });
    })
    // ── Semantic ──
    .add('POST', '/semantic/query', ({ db, user, body: raw }) => {
      try {
        return ok(execute(db, raw as SemanticQuery, { scope: db.scopeOf(user), allowUncertified: allowUncertified(db, user) }).result);
      } catch (e) {
        return e instanceof SemanticError ? problem(e.status, 'Truy vấn không hợp lệ', e.message) : problem(500, 'Lỗi thực thi truy vấn');
      }
    })
    .add('GET', '/semantic/metrics', ({ db, query }) => {
      const q = (query.get('q') ?? '').toLowerCase();
      return ok(db.metrics.filter((m) => !q || `${m.code} ${m.name}`.toLowerCase().includes(q)).filter((m) => !query.get('status') || m.status === query.get('status')).map((m) => metricOf(db, m)));
    })
    .add('POST', '/semantic/metrics/validate', (req) => {
      const denied = requireRole(req, 'BI_ANALYST');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<MetricInput>(req);
      const errors = validateMetric(db, { ...input, code: input.code || 'tmp_metric' });
      if (errors.length) return ok({ valid: false, errors });
      const tmp: MMetric = { id: -1, code: '__preview__', name: input.name, definition: input.definition, expression: input.expression, baseDatasetId: input.baseDatasetId, allowedDimensions: input.allowedDimensions ?? [], unit: input.unit ?? '', ownerId: user.id, glossaryTermId: null, status: 'DRAFT', version: 0, certifiedById: null, certifiedAt: null, versions: [] };
      db.metrics.push(tmp);
      try {
        const dim = input.allowedDimensions?.[0];
        const { result } = execute(db, { metrics: ['__preview__'], dimensions: dim ? [dim] : [], limit: 10 }, { scope: db.scopeOf(user), allowUncertified: true });
        return ok({ valid: true, errors: [], preview: result });
      } finally {
        db.metrics.splice(db.metrics.indexOf(tmp), 1);
      }
    })
    .add('POST', '/semantic/metrics', (req) => {
      const denied = requireRole(req, 'BI_ANALYST');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<MetricInput>(req);
      const errors = validateMetric(db, input);
      if (errors.length) return problem(422, 'Metric chưa hợp lệ', errors.join(' '));
      if (db.metrics.some((m) => m.code === input.code)) return problem(409, 'Mã metric đã tồn tại');
      const now = new Date(db.clock()).toISOString();
      const m: MMetric = { id: db.nextId('metric', 20), code: input.code, name: input.name, definition: input.definition, expression: input.expression, baseDatasetId: input.baseDatasetId, allowedDimensions: input.allowedDimensions ?? [], unit: input.unit ?? '', ownerId: user.id, glossaryTermId: input.glossaryTermId ?? null, status: 'DRAFT', version: 1, certifiedById: null, certifiedAt: null, versions: [{ version: 1, expression: input.expression, changedById: user.id, changedAt: now }] };
      db.metrics.push(m);
      db.audit(user.id, 'METRIC_CREATE', 'METRIC', m.code);
      return ok(metricOf(db, m), 201);
    })
    .add('GET', '/semantic/metrics/:code', ({ db, params }) => {
      const m = db.metrics.find((x) => x.code === params['code']);
      if (!m) return problem(404, 'Không tìm thấy metric');
      return ok({
        ...metricOf(db, m),
        versions: [...m.versions].reverse().map((v) => ({ version: v.version, expression: v.expression, changedBy: db.userRef(v.changedById), changedAt: v.changedAt })),
        usedByDashboards: db.dashboards.filter((d) => d.widgets.some((w) => w.querySpec.metrics.includes(m.code))).length,
      });
    })
    .add('PUT', '/semantic/metrics/:code', (req) => {
      const denied = requireRole(req, 'BI_ANALYST');
      if (denied) return denied;
      const { db, user } = req;
      const m = db.metrics.find((x) => x.code === req.params['code']);
      if (!m) return problem(404, 'Không tìm thấy metric');
      const input = body<MetricInput>(req);
      const errors = validateMetric(db, { ...input, code: m.code });
      if (errors.length) return problem(422, 'Metric chưa hợp lệ', errors.join(' '));
      const changed = input.expression !== m.expression || input.definition !== m.definition;
      Object.assign(m, { name: input.name, definition: input.definition, expression: input.expression, baseDatasetId: input.baseDatasetId, allowedDimensions: input.allowedDimensions ?? m.allowedDimensions, unit: input.unit ?? m.unit, glossaryTermId: input.glossaryTermId ?? m.glossaryTermId });
      if (changed) {
        m.version += 1;
        m.versions.push({ version: m.version, expression: m.expression, changedById: user.id, changedAt: new Date(db.clock()).toISOString() });
        if (m.status === 'CERTIFIED') {
          m.status = 'DRAFT';
          m.certifiedById = null;
          m.certifiedAt = null;
        }
      }
      db.audit(user.id, 'METRIC_UPDATE', 'METRIC', m.code, 'ALLOW', { version: m.version });
      return ok(metricOf(db, m));
    })
    .add('POST', '/semantic/metrics/:code/certification', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const m = db.metrics.find((x) => x.code === req.params['code']);
      if (!m) return problem(404, 'Không tìm thấy metric');
      const status = body<{ status?: 'CERTIFIED' | 'DEPRECATED' }>(req).status;
      if (status !== 'CERTIFIED' && status !== 'DEPRECATED') return problem(422, 'Trạng thái không hợp lệ');
      if (m.status === status) return problem(409, 'Metric đã ở trạng thái này');
      m.status = status;
      m.certifiedById = status === 'CERTIFIED' ? user.id : m.certifiedById;
      m.certifiedAt = status === 'CERTIFIED' ? new Date(db.clock()).toISOString() : m.certifiedAt;
      db.audit(user.id, 'METRIC_CERTIFY', 'METRIC', m.code, 'ALLOW', { status });
      return ok(metricOf(db, m));
    })
    .add('GET', '/semantic/dimensions', () => ok(Object.entries(DIMENSIONS).map(([code, d]) => ({ code, name: d.name, description: d.description }))))
    // ── Báo cáo tự động ──
    .add('GET', '/subscriptions', (req) => {
      const denied = requireRole(req, 'REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD');
      if (denied) return denied;
      return ok(req.db.subscriptions.filter((s) => s.ownerId === req.user.id).map((s) => subscriptionOf(req.db, s)));
    })
    .add('POST', '/subscriptions', (req) => {
      const denied = requireRole(req, 'REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<SubscriptionInput>(req);
      const d = db.dashboards.find((x) => x.id === input.dashboardId);
      if (!d || !canSeeDashboard(db, user, d)) return problem(422, 'Dashboard không hợp lệ');
      if (!/^\S+ \S+ \S+ \S+ \S+$/.test(input.cron ?? '')) return problem(422, 'Lịch gửi không hợp lệ', 'Cron cần 5 trường.');
      const recipients = input.recipientIds?.length ? input.recipientIds : [user.id];
      const invalid = recipients.filter((id) => !db.user(id));
      if (invalid.length) return problem(422, 'Người nhận không hợp lệ', 'Chỉ gửi tới người dùng nội bộ (BR18).');
      const s: MSubscription = { id: db.nextId('subscription', 10), ownerId: user.id, dashboardId: d.id, cron: input.cron, format: input.format ?? 'PDF', filters: input.filters ?? [], includeAiSummary: input.includeAiSummary ?? true, recipientIds: recipients, status: 'ACTIVE', nextRunAt: new Date(db.clock() + 86_400_000).toISOString() };
      db.subscriptions.push(s);
      return ok(subscriptionOf(db, s), 201);
    })
    .add('PATCH', '/subscriptions/:id', (req) => {
      const denied = requireRole(req, 'REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const s = db.subscriptions.find((x) => x.id === Number(req.params['id']) && x.ownerId === user.id);
      if (!s) return problem(404, 'Không tìm thấy đăng ký');
      const input = body<Partial<SubscriptionInput>>(req);
      if (input.cron && !/^\S+ \S+ \S+ \S+ \S+$/.test(input.cron)) return problem(422, 'Lịch gửi không hợp lệ');
      Object.assign(s, {
        cron: input.cron ?? s.cron,
        format: input.format ?? s.format,
        includeAiSummary: input.includeAiSummary ?? s.includeAiSummary,
        recipientIds: input.recipientIds ?? s.recipientIds,
        status: input.status ?? s.status,
      });
      s.nextRunAt = s.status === 'ACTIVE' ? new Date(db.clock() + 86_400_000).toISOString() : null;
      return ok(subscriptionOf(db, s));
    })
    .add('DELETE', '/subscriptions/:id', ({ db, user, params }) => {
      const i = db.subscriptions.findIndex((x) => x.id === Number(params['id']) && x.ownerId === user.id);
      if (i < 0) return problem(404, 'Không tìm thấy đăng ký');
      db.subscriptions.splice(i, 1);
      return noContent();
    })
    .add('GET', '/subscriptions/:id/deliveries', ({ db, user, params }) => {
      const s = db.subscriptions.find((x) => x.id === Number(params['id']) && x.ownerId === user.id);
      if (!s) return problem(404, 'Không tìm thấy đăng ký');
      return ok(db.deliveries.filter((d) => d.subscriptionId === s.id).sort((a, b) => b.sentAt.localeCompare(a.sentAt)).map((d) => ({ id: d.id, recipient: db.userRef(d.recipientId), status: d.status, aiSummary: d.aiSummary, artifactUrl: null, sentAt: d.sentAt })));
    });
}

export { dashboardOf };
