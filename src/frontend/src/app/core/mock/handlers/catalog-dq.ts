import type { DqDimension, DqIssueStatus, DqRuleInput, DqRuleStatus, Sensitivity, TabularResult } from '../../api/models';
import { maskPartial } from '../../util/text';
import type { MockDb } from '../db';
import { canSeeDashboard, columnOf, dashboardSummaryOf, datasetOf, datasetScore, hasDatasetAccess, issueOf, ruleOf } from '../mappers';
import { MockRouter, body, ok, paginate, problem, requireRole } from '../router';
import type { MDataset, MRule, MUser } from '../types';

const DIMENSIONS: DqDimension[] = ['COMPLETENESS', 'UNIQUENESS', 'VALIDITY', 'CONSISTENCY', 'TIMELINESS'];

/** Sinh dòng xem trước cho một dataset từ dữ liệu người; cột RESTRICTED luôn bị che. */
export function previewRows(db: MockDb, user: MUser, ds: MDataset, limit: number): TabularResult {
  const people = db.persons.filter((p) => (ds.tableName.includes('hrm') || ds.tableName.includes('lecturer') ? p.staff || p.lecturer : p.student)).slice(0, limit);
  const value = (name: string, i: number): unknown => {
    const p = people[i % people.length];
    const s = p.student;
    const map: Record<string, unknown> = {
      student_id: s?.code, ma_sv: s?.code, staff_id: p.staff?.code ?? p.lecturer?.code, lecturer_id: p.lecturer?.code, person_id: p.id,
      full_name: p.fullName, date_of_birth: p.dob, email: p.email, phone: p.phone, gender: p.gender, national_id: p.nationalId,
      national_id_hash: `9f${p.nationalId.slice(0, 6)}c1e…`, faculty_code: s?.faculty ?? p.primaryUnit, primary_org_unit_code: p.primaryUnit,
      org_unit_code: p.staff?.unit ?? p.lecturer?.faculty, program_code: s?.program, cohort: s?.cohort, status: s?.status, class_code: s?.className,
      updated_at: p.updatedAt, _batch_id: 'b-7f3a', _ingested_at: new Date(ds.lastUpdatedAt).toISOString(),
      term_code: s?.terms[0]?.term, hoc_ky: s?.terms[0]?.term, gpa_term: s?.terms[0]?.gpa, gpa_cumulative: s?.terms[0]?.gpaCum,
      academic_warning_level: s?.terms[0]?.warning, conduct_score: s?.terms[0]?.conduct, credits_earned: s?.terms[0]?.credits,
      amount_due: s?.tuition[0]?.due, so_tien_phai_nop: s?.tuition[0]?.due, amount_paid: s?.tuition[0]?.paid, so_tien_da_nop: s?.tuition[0]?.paid,
      scholarship_amount: s?.tuition[0]?.scholarship, hoc_bong: s?.tuition[0]?.scholarship, payment_status: s?.tuition[0]?.status,
      grade: p.staff?.grade, salary: 18_500_000, academic_title: p.lecturer?.title, degree: p.lecturer?.degree,
    };
    return map[name] ?? `${name}_${i + 1}`;
  };
  const steward = db.hasRole(user, 'DATA_STEWARD');
  const masked = (sens: Sensitivity) => sens === 'RESTRICTED' || (sens === 'CONFIDENTIAL' && !steward && !db.hasRole(user, 'DATA_ENGINEER'));
  return {
    columns: ds.columns.map((c) => ({ name: c.name, type: c.dataType, masked: masked(c.sensitivity) })),
    rows: Array.from({ length: Math.min(limit, people.length) }, (_, i) =>
      ds.columns.map((c) => (masked(c.sensitivity) ? maskPartial(String(value(c.name, i) ?? ''), 2) : value(c.name, i))),
    ),
  };
}

function validateRule(db: MockDb, input: Partial<DqRuleInput>): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  const ds = input.datasetId ? db.dataset(input.datasetId) : undefined;
  if (!ds) errors.push({ field: 'datasetId', message: 'Chọn dataset' });
  if (!input.ruleType) errors.push({ field: 'ruleType', message: 'Chọn loại quy tắc' });
  if (!input.description?.trim()) errors.push({ field: 'description', message: 'Bắt buộc' });
  const params = (input.params ?? {}) as Record<string, unknown>;
  if (input.ruleType === 'CUSTOM_SQL' && !params['sql']) errors.push({ field: 'params.sql', message: 'Cần câu SQL trả về các dòng vi phạm' });
  if (input.ruleType === 'REGEX' && !params['pattern']) errors.push({ field: 'params.pattern', message: 'Cần biểu thức chính quy' });
  if (input.ruleType === 'REFERENCE' && (!params['ref_dataset'] || !params['ref_column'])) errors.push({ field: 'params', message: 'Cần dataset và cột tham chiếu' });
  if (input.ruleType === 'RANGE' && params['min'] === undefined && params['max'] === undefined) errors.push({ field: 'params', message: 'Cần giá trị nhỏ nhất hoặc lớn nhất' });
  if (input.ruleType && !['CUSTOM_SQL', 'FRESHNESS'].includes(input.ruleType) && !input.columnId) errors.push({ field: 'columnId', message: 'Chọn cột áp dụng' });
  if (input.columnId && ds && !ds.columns.some((c) => c.id === input.columnId)) errors.push({ field: 'columnId', message: 'Cột không thuộc dataset' });
  return errors;
}

const ISSUE_TRANSITIONS: Record<DqIssueStatus, DqIssueStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'WONT_FIX'],
  IN_PROGRESS: ['OPEN', 'RESOLVED', 'WONT_FIX'],
  RESOLVED: ['OPEN'],
  WONT_FIX: ['OPEN'],
};

export function registerCatalogDq(router: MockRouter): void {
  router
    // ── Catalog ──
    .add('GET', '/datasets', ({ db, user, query }) => {
      const q = (query.get('q') ?? '').toLowerCase();
      const sens = query.get('sensitivity');
      const accessible = query.get('accessible') === 'true';
      const items = db.datasets
        .filter((d) => !q || `${d.displayName} ${d.schemaName}.${d.tableName} ${d.description} ${d.tags.join(' ')}`.toLowerCase().includes(q))
        .filter((d) => !query.get('layer') || d.layer === query.get('layer'))
        .filter((d) => !query.get('sourceId') || d.sourceCode === db.sources.find((s) => s.id === Number(query.get('sourceId')))?.code)
        .filter((d) => !query.get('tag') || d.tags.includes(query.get('tag') as string))
        .filter((d) => !sens || d.columns.some((c) => c.sensitivity === sens))
        .filter((d) => !accessible || hasDatasetAccess(db, user, d))
        .map((d) => datasetOf(db, user, d));
      return ok(paginate(items, query));
    })
    .add('GET', '/datasets/:id', ({ db, user, params }) => {
      const ds = db.dataset(Number(params['id']));
      if (!ds) return problem(404, 'Không tìm thấy dataset');
      const metrics = db.metrics.filter((m) => m.baseDatasetId === ds.id);
      const codes = new Set(metrics.map((m) => m.code));
      db.remember(user.id, 'DATASET', String(ds.id), `${ds.schemaName}.${ds.tableName}`);
      return ok({
        ...datasetOf(db, user, ds),
        columns: ds.columns.map((c) => columnOf(db, c)),
        rowCount: ds.rowCount,
        freshnessSlaMinutes: ds.freshnessSlaMinutes,
        usedBy: {
          metrics: metrics.map((m) => m.code),
          dashboards: db.dashboards.filter((d) => canSeeDashboard(db, user, d) && d.widgets.some((w) => w.querySpec.metrics.some((m) => codes.has(m)))).map((d) => dashboardSummaryOf(db, user, d)),
        },
      });
    })
    .add('PATCH', '/datasets/:id/columns/:columnId', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user, params } = req;
      const ds = db.dataset(Number(params['id']));
      const column = ds?.columns.find((c) => c.id === Number(params['columnId']));
      if (!ds || !column) return problem(404, 'Không tìm thấy cột');
      const patch = body<{ sensitivity?: Sensitivity; description?: string; glossaryTermId?: number | null }>(req);
      const before = column.sensitivity;
      if (patch.sensitivity) column.sensitivity = patch.sensitivity;
      if (patch.description !== undefined) column.description = patch.description;
      if (patch.glossaryTermId !== undefined) column.glossaryTermId = patch.glossaryTermId;
      db.audit(user.id, 'CLASSIFICATION_CHANGE', 'DATASET_COLUMN', `${ds.schemaName}.${ds.tableName}.${column.name}`, 'ALLOW', { from: before, to: column.sensitivity });
      return ok(columnOf(db, column));
    })
    .add('GET', '/datasets/:id/preview', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER', 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user, params, query } = req;
      const ds = db.dataset(Number(params['id']));
      if (!ds) return problem(404, 'Không tìm thấy dataset');
      const limit = Math.min(100, Math.max(1, Number(query.get('limit') ?? 20)));
      db.audit(user.id, 'DATASET_PREVIEW', 'DATASET', String(ds.id), 'ALLOW', { limit, snapshotId: query.get('snapshotId') });
      return ok(previewRows(db, user, ds, limit));
    })
    .add('GET', '/glossary', ({ db, query }) => {
      const q = (query.get('q') ?? '').toLowerCase();
      return ok(db.glossary.filter((g) => !q || `${g.name} ${g.definition}`.toLowerCase().includes(q)).map((g) => ({ id: g.id, name: g.name, definition: g.definition, owner: db.userRef(g.ownerId) })));
    })
    .add('POST', '/glossary', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const input = body<{ name?: string; definition?: string }>(req);
      if (!input.name?.trim() || !input.definition?.trim()) return problem(422, 'Thiếu tên hoặc định nghĩa');
      if (req.db.glossary.some((g) => g.name.toLowerCase() === input.name!.trim().toLowerCase())) return problem(409, 'Thuật ngữ đã tồn tại');
      const term = { id: req.db.nextId('glossary', 10), name: input.name.trim(), definition: input.definition.trim(), ownerId: req.user.id };
      req.db.glossary.push(term);
      return ok({ ...term, owner: req.db.userRef(term.ownerId) }, 201);
    })
    .add('PUT', '/glossary/:termId', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const term = req.db.glossary.find((g) => g.id === Number(req.params['termId']));
      if (!term) return problem(404, 'Không tìm thấy thuật ngữ');
      const input = body<{ name?: string; definition?: string }>(req);
      term.name = input.name?.trim() || term.name;
      term.definition = input.definition?.trim() || term.definition;
      return ok({ ...term, owner: req.db.userRef(term.ownerId) });
    })
    // ── Quy tắc chất lượng ──
    .add('GET', '/dq/rules', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD', 'DATA_ENGINEER');
      if (denied) return denied;
      const { db, query } = req;
      return ok(
        db.rules
          .filter((r) => !query.get('datasetId') || r.datasetId === Number(query.get('datasetId')))
          .filter((r) => !query.get('status') || r.status === query.get('status'))
          .filter((r) => !query.get('dimension') || r.dimension === query.get('dimension'))
          .map(ruleOf),
      );
    })
    .add('POST', '/dq/rules', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<DqRuleInput>(req);
      const errors = validateRule(db, input);
      if (errors.length) return problem(422, 'Quy tắc chưa hợp lệ', undefined, { errors });
      const rule: MRule = {
        id: db.nextId('rule', 100),
        datasetId: input.datasetId,
        columnId: input.columnId ?? null,
        ruleType: input.ruleType,
        dimension: input.dimension,
        severity: input.severity,
        params: (input.params ?? {}) as Record<string, unknown>,
        description: input.description,
        status: 'DRAFT',
        version: 1,
        lastPassRate: null,
        lastDryRunVersion: null,
      };
      db.rules.push(rule);
      db.audit(user.id, 'DQ_RULE_CREATE', 'DQ_RULE', String(rule.id));
      return ok(ruleOf(rule), 201);
    })
    .add('PATCH', '/dq/rules/:ruleId', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const rule = db.rules.find((r) => r.id === Number(req.params['ruleId']));
      if (!rule) return problem(404, 'Không tìm thấy quy tắc');
      const input = body<Partial<DqRuleInput> & { status?: DqRuleStatus }>(req);
      const definitionChanged = (['columnId', 'ruleType', 'params', 'severity', 'dimension'] as const).some(
        (k) => input[k] !== undefined && JSON.stringify(input[k]) !== JSON.stringify(rule[k]),
      );
      if (definitionChanged) {
        const errors = validateRule(db, { ...ruleOf(rule), ...input } as DqRuleInput);
        if (errors.length) return problem(422, 'Quy tắc chưa hợp lệ', undefined, { errors });
        Object.assign(rule, {
          columnId: input.columnId ?? rule.columnId,
          ruleType: input.ruleType ?? rule.ruleType,
          params: (input.params as Record<string, unknown> | undefined) ?? rule.params,
          severity: input.severity ?? rule.severity,
          dimension: input.dimension ?? rule.dimension,
          version: rule.version + 1,
        });
      }
      if (input.description) rule.description = input.description;
      if (input.status && input.status !== rule.status) {
        if (input.status === 'ACTIVE' && rule.lastDryRunVersion !== rule.version) {
          return problem(409, 'Chưa chạy thử', `Hãy chạy thử phiên bản ${rule.version} trước khi kích hoạt (AC17.1).`);
        }
        rule.status = input.status;
      }
      db.audit(user.id, 'DQ_RULE_UPDATE', 'DQ_RULE', String(rule.id), 'ALLOW', { status: rule.status, version: rule.version });
      return ok(ruleOf(rule));
    })
    .add('POST', '/dq/rules/:ruleId/dry-run', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const rule = db.rules.find((r) => r.id === Number(req.params['ruleId']));
      const ds = rule ? db.dataset(rule.datasetId) : undefined;
      if (!rule || !ds) return problem(404, 'Không tìm thấy quy tắc');
      const evaluated = Math.min(ds.rowCount, 5000);
      const failed = rule.ruleType === 'FRESHNESS' ? (db.clock() - ds.lastUpdatedAt > Number(rule.params['maxAgeHours'] ?? 24) * 3_600_000 ? 1 : 0) : (rule.id * 7 + rule.version * 3) % 9;
      rule.lastDryRunVersion = rule.version;
      rule.lastPassRate = Math.round((1 - failed / Math.max(1, evaluated)) * 10000) / 100;
      const sample = previewRows(db, user, ds, Math.min(failed, 5));
      return ok({ evaluated, failed, sample });
    })
    .add('GET', '/dq/scores', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD', 'DATA_ENGINEER', 'BI_ANALYST', 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, query } = req;
      const active = db.rules.filter((r) => r.status === 'ACTIVE' && r.lastPassRate !== null);
      const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 100);
      const byDimension = Object.fromEntries(DIMENSIONS.map((d) => [d, avg(active.filter((r) => r.dimension === d).map((r) => r.lastPassRate as number))]));
      const groupBy = query.get('groupBy') === 'source' ? 'source' : 'dataset';
      const keyOf = (r: MRule) => {
        const ds = db.dataset(r.datasetId);
        return groupBy === 'source' ? (ds?.sourceCode ?? 'Không có nguồn') : `${ds?.schemaName}.${ds?.tableName}`;
      };
      const keys = [...new Set(active.map(keyOf))];
      const rows = keys.map((key) => {
        const rs = active.filter((r) => keyOf(r) === key);
        return {
          key,
          score: avg(rs.map((r) => r.lastPassRate as number)),
          byDimension: Object.fromEntries(DIMENSIONS.filter((d) => rs.some((r) => r.dimension === d)).map((d) => [d, avg(rs.filter((r) => r.dimension === d).map((r) => r.lastPassRate as number))])),
        };
      });
      const days = Math.min(180, Number(query.get('days') ?? 30));
      const overall = avg(rows.map((r) => r.score));
      const trend = Array.from({ length: days }, (_, i) => ({
        date: new Date(db.seededAt - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
        score: Math.round(Math.min(100, overall - 1.5 + ((i * 37) % 10) / 4 + (i / days) * 1.2) * 10) / 10,
      }));
      return ok({ overall, byDimension, rows, trend });
    })
    // ── Issue ──
    .add('GET', '/dq/issues', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD', 'DATA_ENGINEER');
      if (denied) return denied;
      const { db, query } = req;
      const items = db.issues
        .filter((i) => !query.get('status') || i.status === query.get('status'))
        .filter((i) => !query.get('datasetId') || i.datasetId === Number(query.get('datasetId')))
        .filter((i) => !query.get('assignee') || i.assigneeId === query.get('assignee'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((i) => issueOf(db, i));
      return ok(paginate(items, query));
    })
    .add('PATCH', '/dq/issues/:issueId', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const issue = db.issues.find((i) => i.id === Number(req.params['issueId']));
      if (!issue) return problem(404, 'Không tìm thấy issue');
      const input = body<{ status?: DqIssueStatus; assigneeId?: string | null }>(req);
      if (input.status && input.status !== issue.status) {
        if (!ISSUE_TRANSITIONS[issue.status].includes(input.status)) return problem(409, 'Chuyển trạng thái không hợp lệ', `${issue.status} → ${input.status}`);
        issue.status = input.status;
      }
      if (input.assigneeId !== undefined) {
        if (input.assigneeId && !db.user(input.assigneeId)) return problem(422, 'Người được gán không tồn tại');
        issue.assigneeId = input.assigneeId;
      }
      db.audit(user.id, 'DQ_ISSUE_UPDATE', 'DQ_ISSUE', String(issue.id), 'ALLOW', { status: issue.status });
      return ok(issueOf(db, issue));
    })
    .add('POST', '/dq/issues/:issueId/comments', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD', 'DATA_ENGINEER');
      if (denied) return denied;
      const { db, user } = req;
      const issue = db.issues.find((i) => i.id === Number(req.params['issueId']));
      if (!issue) return problem(404, 'Không tìm thấy issue');
      const text = body<{ body?: string }>(req).body?.trim();
      if (!text) return problem(422, 'Nội dung trống');
      const comment = { id: db.nextId('comment', 50), authorId: user.id, body: text, createdAt: new Date(db.clock()).toISOString() };
      issue.comments.push(comment);
      return ok({ id: comment.id, author: db.userRef(user.id), body: text, createdAt: comment.createdAt }, 201);
    });
}

export { datasetScore };
