import type { AdminUser, ColumnRule, Policy, PolicyRules, PolicyVersion, RoleAssignment, RoleCode } from '../../api/models';
import { maskPartial } from '../../util/text';
import type { MockDb } from '../db';
import { MockRouter, body, noContent, ok, paginate, problem, requireRole } from '../router';
import { previewRows } from './catalog-dq';
import type { MPolicy, MUser } from '../types';

function userOf(db: MockDb, u: MUser): AdminUser {
  return { id: u.id, email: u.email, fullName: u.fullName, orgUnit: db.orgUnitRef(u.orgUnitCode), status: u.status, roles: u.roles, lastLoginAt: u.lastLoginAt };
}

function activeAdmins(db: MockDb, except?: string): MUser[] {
  return db.users.filter((u) => u.id !== except && u.status === 'ACTIVE' && u.roles.some((r) => r.role === 'PLATFORM_ADMIN'));
}

function versionOf(db: MockDb, v: MPolicy['versions'][number]): PolicyVersion {
  return { version: v.version, rowFilter: v.rowFilter, columnRules: v.columnRules, changeNote: v.changeNote, createdBy: db.userRef(v.createdById), createdAt: v.createdAt };
}

function policyOf(db: MockDb, p: MPolicy): Policy {
  return { id: p.id, name: p.name, datasetId: p.datasetId, roleCode: p.roleCode, currentVersion: versionOf(db, p.versions[p.versions.length - 1]), active: p.active };
}

/**
 * Hỗ trợ dạng row filter đơn giản của bản demo:
 *   cột = current_user_attr('faculty_code')  |  cột = 'GIÁ_TRỊ'  |  cột IN ('A', 'B')
 */
export function parseRowFilter(filter: string, user: MUser, db: MockDb): { column: string; values: string[] | null } | null {
  const attr = /^\s*([a-z_]+)\s*=\s*current_user_attr\('faculty_code'\)\s*$/i.exec(filter);
  if (attr) return { column: attr[1], values: db.scopeOf(user) };
  const eq = /^\s*([a-z_]+)\s*=\s*'([^']*)'\s*$/i.exec(filter);
  if (eq) return { column: eq[1], values: [eq[2]] };
  const inList = /^\s*([a-z_]+)\s+IN\s*\(([^)]*)\)\s*$/i.exec(filter);
  if (inList) return { column: inList[1], values: inList[2].split(',').map((x) => x.trim().replace(/^'|'$/g, '')) };
  return null;
}

function validateRules(rules: PolicyRules): string[] {
  const errors: string[] = [];
  for (const r of rules.columnRules ?? []) {
    if (!r.column) errors.push('Thiếu tên cột trong quy tắc cột.');
    if (!['MASK_PARTIAL', 'HASH', 'DENY'].includes(r.action)) errors.push(`Hành động không hợp lệ: ${r.action}`);
  }
  return errors;
}

export function registerAdmin(router: MockRouter): void {
  router
    .add('GET', '/admin/users', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, query } = req;
      const q = (query.get('q') ?? '').toLowerCase();
      const items = db.users
        .filter((u) => !q || `${u.fullName} ${u.email}`.toLowerCase().includes(q))
        .filter((u) => !query.get('role') || u.roles.some((r) => r.role === query.get('role')))
        .filter((u) => !query.get('status') || u.status === query.get('status'))
        .map((u) => userOf(db, u));
      return ok(paginate(items, query));
    })
    .add('POST', '/admin/users', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<{ email?: string; fullName?: string; orgUnitCode?: string; roles?: RoleAssignment[] }>(req);
      if (!input.email?.includes('@') || !input.fullName?.trim() || !input.orgUnitCode) return problem(422, 'Thiếu email, họ tên hoặc đơn vị');
      if (db.users.some((u) => u.email.toLowerCase() === input.email!.toLowerCase())) return problem(409, 'Email đã tồn tại');
      const created: MUser = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, email: input.email, fullName: input.fullName.trim(), orgUnitCode: input.orgUnitCode, status: 'ACTIVE', roles: input.roles ?? [{ role: 'REPORT_VIEWER', scopeOrgUnit: input.orgUnitCode }], lastLoginAt: null };
      db.users.push(created);
      db.audit(user.id, 'USER_CREATE', 'USER', created.id);
      return ok(userOf(db, created), 201);
    })
    .add('PATCH', '/admin/users/:userId', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, user } = req;
      const target = db.user(req.params['userId']);
      if (!target) return problem(404, 'Không tìm thấy người dùng');
      const input = body<{ status?: 'ACTIVE' | 'INACTIVE'; orgUnitCode?: string }>(req);
      if (input.status === 'INACTIVE' && target.roles.some((r) => r.role === 'PLATFORM_ADMIN') && activeAdmins(db, target.id).length === 0) {
        return problem(409, 'Không thể khóa Admin cuối cùng', 'Hệ thống phải còn ít nhất một quản trị hệ thống hoạt động (AC24.1).');
      }
      if (input.status) target.status = input.status;
      if (input.orgUnitCode) target.orgUnitCode = input.orgUnitCode;
      db.audit(user.id, input.status === 'INACTIVE' ? 'USER_LOCK' : 'USER_UPDATE', 'USER', target.id);
      return ok(userOf(db, target));
    })
    .add('PUT', '/admin/users/:userId/roles', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, user } = req;
      const target = db.user(req.params['userId']);
      if (!target) return problem(404, 'Không tìm thấy người dùng');
      const roles = body<RoleAssignment[]>(req);
      if (!Array.isArray(roles) || roles.length === 0) return problem(422, 'Cần ít nhất một vai trò');
      const losingAdmin = target.roles.some((r) => r.role === 'PLATFORM_ADMIN') && !roles.some((r) => r.role === 'PLATFORM_ADMIN');
      if (losingAdmin && activeAdmins(db, target.id).length === 0) return problem(409, 'Không thể gỡ Admin cuối cùng', 'Hệ thống phải còn ít nhất một quản trị hệ thống (AC24.1).');
      const before = target.roles;
      target.roles = roles.map((r) => ({ role: r.role as RoleCode, scopeOrgUnit: r.scopeOrgUnit ?? null }));
      db.audit(user.id, 'ROLE_CHANGE', 'USER', target.id, 'ALLOW', { before, after: target.roles });
      return ok(userOf(db, target));
    })
    .add('GET', '/admin/org-units', ({ db }) => ok(db.orgUnits))
    // ── Chính sách phân quyền ──
    .add('GET', '/admin/policies', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      return ok(req.db.policies.map((p) => policyOf(req.db, p)));
    })
    .add('POST', '/admin/policies', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<PolicyRules & { name?: string; datasetId?: number; roleCode?: RoleCode }>(req);
      if (!input.name?.trim() || !input.datasetId || !input.roleCode) return problem(422, 'Thiếu tên, dataset hoặc vai trò');
      if (db.policies.some((p) => p.name === input.name)) return problem(409, 'Tên chính sách đã tồn tại');
      const errors = validateRules(input);
      if (input.rowFilter && !parseRowFilter(input.rowFilter, user, db)) errors.push('Row filter chưa đúng cú pháp hỗ trợ.');
      if (errors.length) return problem(422, 'Chính sách chưa hợp lệ', errors.join(' '));
      const p: MPolicy = { id: db.nextId('policy', 10), name: input.name.trim(), datasetId: input.datasetId, roleCode: input.roleCode, active: true, versions: [{ version: 1, rowFilter: input.rowFilter ?? null, columnRules: (input.columnRules ?? []) as MPolicy['versions'][number]['columnRules'], changeNote: 'Khởi tạo', createdById: user.id, createdAt: new Date(db.clock()).toISOString() }] };
      db.policies.push(p);
      db.audit(user.id, 'POLICY_CREATE', 'POLICY', String(p.id));
      return ok(policyOf(db, p), 201);
    })
    .add('GET', '/admin/policies/:policyId/versions', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const p = req.db.policies.find((x) => x.id === Number(req.params['policyId']));
      if (!p) return problem(404, 'Không tìm thấy chính sách');
      return ok([...p.versions].reverse().map((v) => versionOf(req.db, v)));
    })
    .add('POST', '/admin/policies/:policyId/versions', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, user } = req;
      const p = db.policies.find((x) => x.id === Number(req.params['policyId']));
      if (!p) return problem(404, 'Không tìm thấy chính sách');
      const input = body<PolicyRules & { changeNote?: string }>(req);
      const errors = validateRules(input);
      if (input.rowFilter && !parseRowFilter(input.rowFilter, user, db)) errors.push('Row filter chưa đúng cú pháp hỗ trợ.');
      if (errors.length) return problem(422, 'Chính sách chưa hợp lệ', errors.join(' '));
      const v = { version: p.versions[p.versions.length - 1].version + 1, rowFilter: input.rowFilter ?? null, columnRules: (input.columnRules ?? []) as MPolicy['versions'][number]['columnRules'], changeNote: input.changeNote ?? null, createdById: user.id, createdAt: new Date(db.clock()).toISOString() };
      p.versions.push(v);
      db.audit(user.id, 'POLICY_VERSION', 'POLICY', String(p.id), 'ALLOW', { version: v.version });
      return ok(versionOf(db, v), 201);
    })
    .add('POST', '/admin/policies/simulate', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db } = req;
      const input = body<PolicyRules & { datasetId?: number; asUserId?: string }>(req);
      const ds = input.datasetId ? db.dataset(input.datasetId) : undefined;
      const asUser = db.user(input.asUserId);
      if (!ds || !asUser) return problem(422, 'Chọn dataset và người dùng để mô phỏng');
      const parsed = input.rowFilter ? parseRowFilter(input.rowFilter, asUser, db) : null;
      if (input.rowFilter && !parsed) return problem(422, 'Row filter chưa đúng cú pháp hỗ trợ', "Dạng hỗ trợ: cột = current_user_attr('faculty_code') | cột = 'X' | cột IN ('A','B')");
      const sample = previewRows(db, asUser, ds, 60);
      const columns = sample.columns ?? [];
      const filterIndex = parsed ? columns.findIndex((c) => c.name === parsed.column) : -1;
      if (parsed && filterIndex < 0) return problem(422, `Dataset không có cột ${parsed.column}`);
      const rows = (sample.rows ?? []).filter((r) => !parsed || parsed.values === null || parsed.values.includes(String(r[filterIndex])));
      const rules = new Map((input.columnRules ?? []).map((r: ColumnRule) => [r.column, r.action]));
      const masked = rows.map((r) =>
        r.map((v, i) => {
          const action = rules.get(columns[i].name ?? '');
          if (action === 'DENY') return '••••';
          if (action === 'HASH') return `h:${Math.abs([...String(v)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(16)}`;
          if (action === 'MASK_PARTIAL') return maskPartial(String(v ?? ''), 2);
          return v;
        }),
      );
      return ok({
        columns: columns.map((c) => ({ ...c, masked: c.masked || rules.has(c.name ?? '') })),
        rows: masked.slice(0, 20),
        visibleRowCount: rows.length,
        totalRowCount: sample.rows?.length ?? 0,
      });
    })
    // ── Audit, nhật ký hỏi-đáp, chủ đề chặn ──
    .add('GET', '/admin/audit-logs', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN', 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user, query } = req;
      const admin = db.hasRole(user, 'PLATFORM_ADMIN');
      const from = query.get('from');
      const to = query.get('to');
      const items = db.audits
        .filter((a) => admin || ['DATASET', 'DATASET_COLUMN', 'ACCESS_REQUEST', 'ACCESS_GRANT'].includes(a.objectType))
        .filter((a) => !query.get('actorId') || a.actorId === query.get('actorId'))
        .filter((a) => !query.get('action') || a.action === query.get('action'))
        .filter((a) => !query.get('objectType') || a.objectType === query.get('objectType'))
        .filter((a) => !query.get('objectId') || a.objectId === query.get('objectId'))
        .filter((a) => !query.get('outcome') || a.outcome === query.get('outcome'))
        .filter((a) => !from || a.occurredAt >= from)
        .filter((a) => !to || a.occurredAt <= to)
        .map((a) => ({ id: a.id, occurredAt: a.occurredAt, actor: db.userRef(a.actorId), action: a.action, objectType: a.objectType, objectId: a.objectId, outcome: a.outcome, ip: a.ip, details: a.details }));
      return ok(paginate(items, query));
    })
    .add('GET', '/admin/assistant-logs', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, query } = req;
      const items = db.conversations
        .flatMap((c) => c.messages.filter((m) => m.role === 'ASSISTANT').map((m) => ({ ...m, question: m.question, user: db.userRef(c.userId), compiledSql: m.sql ?? undefined })))
        .filter((m) => !query.get('status') || m.status === query.get('status'))
        .filter((m) => !query.get('userId') || m.user?.id === query.get('userId'))
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      return ok(paginate(items, query));
    })
    .add('GET', '/admin/blocked-topics', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      return ok(req.db.blockedTopics.map((t) => ({ id: t.id, pattern: t.pattern, description: t.description, createdBy: req.db.userRef(t.createdById), createdAt: t.createdAt })));
    })
    .add('POST', '/admin/blocked-topics', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<{ pattern?: string; description?: string }>(req);
      if (!input.pattern?.trim()) return problem(422, 'Thiếu mẫu chủ đề');
      try {
        new RegExp(input.pattern);
      } catch {
        return problem(422, 'Mẫu không hợp lệ', 'Dùng từ khóa, phân tách bằng |');
      }
      const t = { id: db.nextId('topic', 10), pattern: input.pattern.trim(), description: input.description ?? null, createdById: user.id, createdAt: new Date(db.clock()).toISOString() };
      db.blockedTopics.push(t);
      db.audit(user.id, 'BLOCKED_TOPIC_ADD', 'ASSISTANT', String(t.id));
      return ok({ ...t, createdBy: db.userRef(user.id) }, 201);
    })
    .add('DELETE', '/admin/blocked-topics/:topicId', (req) => {
      const denied = requireRole(req, 'PLATFORM_ADMIN');
      if (denied) return denied;
      const i = req.db.blockedTopics.findIndex((t) => t.id === Number(req.params['topicId']));
      if (i < 0) return problem(404, 'Không tìm thấy chủ đề');
      req.db.blockedTopics.splice(i, 1);
      req.db.audit(req.user.id, 'BLOCKED_TOPIC_REMOVE', 'ASSISTANT', req.params['topicId']);
      return noContent();
    });
}
