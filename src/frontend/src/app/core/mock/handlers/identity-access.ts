import type { AccessRequestInput, MergeEvent } from '../../api/models';
import type { MockDb } from '../db';
import { grantOf, requestOf } from '../mappers';
import { MockRouter, body, noContent, ok, paginate, problem, requireRole } from '../router';
import type { MAccessRequest, MMergeEvent } from '../types';

const MAX_DAYS = 180;

function mergeOf(db: MockDb, m: MMergeEvent): MergeEvent {
  return { id: m.id, action: m.action, survivorPersonId: m.survivorPersonId, mergedPersonId: m.mergedPersonId, actor: db.userRef(m.actorId), automatic: m.actorId === null, createdAt: m.createdAt };
}

/** Chuyển yêu cầu đã duyệt sang EXPIRED khi quyền quá hạn (job hằng giờ — BR09). */
export function expireAccess(db: MockDb): void {
  const now = db.clock();
  for (const r of db.requests.filter((x) => x.status === 'APPROVED')) {
    const grant = db.grants.find((g) => g.requestId === r.id);
    if (grant && !grant.revokedAt && Date.parse(grant.validTo) <= now) r.status = 'EXPIRED';
  }
}

function resourceName(db: MockDb, type: string, id: string): string {
  if (type === 'DATASET') {
    const ds = db.dataset(Number(id));
    return ds ? `${ds.schemaName}.${ds.tableName}` : `Dataset #${id}`;
  }
  if (type === 'DASHBOARD') return db.dashboards.find((d) => d.id === Number(id))?.title ?? `Dashboard #${id}`;
  if (type === 'METRIC') return db.metrics.find((m) => m.code === id)?.name ?? id;
  const facets: Record<string, string> = { FINANCE: 'Tab Tài chính – hồ sơ sinh viên', HR: 'Tab Nhân sự – hồ sơ cán bộ', EVALUATION: 'Tab Đánh giá – hồ sơ giảng viên' };
  return facets[id] ?? `Tab ${id}`;
}

export function registerIdentityAccess(router: MockRouter): void {
  router
    // ── Đối soát danh tính ──
    .add('GET', '/identity/candidates', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, query } = req;
      const min = Number(query.get('minScore') ?? 0);
      const max = Number(query.get('maxScore') ?? 1);
      const items = db.candidates
        .filter((c) => !query.get('status') || c.status === query.get('status'))
        .filter((c) => c.score >= min && c.score <= max)
        .filter((c) => !query.get('source') || c.left.sourceCode === query.get('source') || c.right.sourceCode === query.get('source'))
        .sort((a, b) => b.score - a.score)
        .map((c) => ({ id: c.id, score: c.score, status: c.status, left: c.left, right: c.right, comparison: c.comparison, createdAt: c.createdAt }));
      return ok(paginate(items, query));
    })
    .add('POST', '/identity/candidates/:id/decision', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const c = db.candidates.find((x) => x.id === Number(req.params['id']));
      if (!c) return problem(404, 'Không tìm thấy cặp ứng viên');
      if (c.status !== 'PENDING') return problem(409, 'Cặp đã được xử lý', 'Bản ghi đã thay đổi ở phiên khác — tải lại hàng đợi.');
      const decision = body<{ decision?: string }>(req).decision;
      if (decision === 'MERGE') {
        c.status = 'MERGED';
        db.merges.push({ id: db.nextId('merge', 100), action: 'MERGE', survivorPersonId: c.left.personId as string, mergedPersonId: c.right.personId as string, actorId: user.id, createdAt: new Date(db.clock()).toISOString(), candidateId: c.id });
      } else if (decision === 'NOT_MATCH') {
        c.status = 'REJECTED';
      } else if (decision !== 'SKIP') {
        return problem(422, 'Quyết định không hợp lệ');
      }
      db.audit(user.id, `IDENTITY_${decision}`, 'MATCH_CANDIDATE', String(c.id));
      return ok({ id: c.id, score: c.score, status: c.status, left: c.left, right: c.right, comparison: c.comparison, createdAt: c.createdAt });
    })
    .add('GET', '/identity/persons/:personId/history', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const id = req.params['personId'];
      return ok(req.db.merges.filter((m) => m.survivorPersonId === id || m.mergedPersonId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((m) => mergeOf(req.db, m)));
    })
    .add('POST', '/identity/merge-events/:eventId/unmerge', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const event = db.merges.find((m) => m.id === Number(req.params['eventId']));
      if (!event) return problem(404, 'Không tìm thấy sự kiện gộp');
      if (event.action !== 'MERGE') return problem(409, 'Chỉ tách được sự kiện gộp');
      if (db.merges.some((m) => m.action === 'UNMERGE' && m.candidateId === event.candidateId && m.createdAt > event.createdAt)) return problem(409, 'Đã tách trước đó');
      const reason = body<{ reason?: string }>(req).reason ?? '';
      if (reason.trim().length < 5) return problem(422, 'Cần lý do tách (≥ 5 ký tự)');
      const undo: MMergeEvent = { id: db.nextId('merge', 100), action: 'UNMERGE', survivorPersonId: event.survivorPersonId, mergedPersonId: event.mergedPersonId, actorId: user.id, createdAt: new Date(db.clock()).toISOString(), candidateId: event.candidateId };
      db.merges.push(undo);
      const c = db.candidates.find((x) => x.id === event.candidateId);
      if (c) c.status = 'UNMERGED';
      db.audit(user.id, 'IDENTITY_UNMERGE', 'MERGE_EVENT', String(event.id), 'ALLOW', { reason });
      return ok(mergeOf(db, undo));
    })
    // ── Yêu cầu và cấp quyền ──
    .add('GET', '/access-requests', (req) => {
      const { db, user, query } = req;
      expireAccess(db);
      const box = query.get('box');
      if (box === 'review') {
        const denied = requireRole(req, 'DATA_STEWARD');
        if (denied) return denied;
      }
      const items = db.requests
        .filter((r) => (box === 'review' ? true : r.requesterId === user.id))
        .filter((r) => !query.get('status') || r.status === query.get('status'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => requestOf(db, r));
      return ok(paginate(items, query));
    })
    .add('POST', '/access-requests', (req) => {
      const { db, user } = req;
      const input = body<AccessRequestInput>(req);
      const errors: { field: string; message: string }[] = [];
      if (!['DATASET', 'DASHBOARD', 'PROFILE_FACET', 'METRIC'].includes(input.resourceType)) errors.push({ field: 'resourceType', message: 'Loại tài nguyên không hợp lệ' });
      if (!input.resourceId) errors.push({ field: 'resourceId', message: 'Bắt buộc' });
      if ((input.purpose ?? '').trim().length < 10) errors.push({ field: 'purpose', message: 'Nêu rõ mục đích (tối thiểu 10 ký tự)' });
      if (!Number.isInteger(input.requestedDays) || input.requestedDays < 1 || input.requestedDays > MAX_DAYS) errors.push({ field: 'requestedDays', message: `Thời hạn từ 1 đến ${MAX_DAYS} ngày (BR09)` });
      if (errors.length) return problem(422, 'Yêu cầu chưa hợp lệ', undefined, { errors });
      if (db.requests.some((r) => r.requesterId === user.id && r.status === 'PENDING' && r.resourceType === input.resourceType && r.resourceId === input.resourceId)) {
        return problem(409, 'Đã có yêu cầu đang chờ', 'Bạn đã gửi yêu cầu cho tài nguyên này và đang chờ duyệt.');
      }
      if (db.hasGrant(user.id, input.resourceType, input.resourceId)) return problem(409, 'Quyền đang còn hiệu lực');
      const request: MAccessRequest = {
        id: db.nextId('request', 10),
        requesterId: user.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        resourceName: resourceName(db, input.resourceType, input.resourceId),
        accessLevel: input.accessLevel ?? 'READ',
        purpose: input.purpose.trim(),
        scope: (input.scope ?? {}) as Record<string, unknown>,
        requestedDays: input.requestedDays,
        status: 'PENDING',
        reviewerId: null,
        reviewNote: null,
        createdAt: new Date(db.clock()).toISOString(),
        decidedAt: null,
        expiresAt: null,
      };
      db.requests.push(request);
      for (const steward of db.users.filter((u) => u.status === 'ACTIVE' && db.hasRole(u, 'DATA_STEWARD'))) {
        db.notify(steward.id, 'ACCESS_REQUEST', `Yêu cầu truy cập mới từ ${user.fullName}`, '/access?box=review');
      }
      db.audit(user.id, 'ACCESS_REQUEST', 'ACCESS_REQUEST', String(request.id), 'ALLOW', { resource: request.resourceName });
      return ok(requestOf(db, request), 201);
    })
    .add('DELETE', '/access-requests/:id', ({ db, user, params }) => {
      const r = db.requests.find((x) => x.id === Number(params['id']) && x.requesterId === user.id);
      if (!r) return problem(404, 'Không tìm thấy yêu cầu');
      if (r.status !== 'PENDING') return problem(409, 'Chỉ hủy được yêu cầu đang chờ');
      r.status = 'CANCELLED';
      db.audit(user.id, 'ACCESS_CANCEL', 'ACCESS_REQUEST', String(r.id));
      return noContent();
    })
    .add('POST', '/access-requests/:id/decision', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const r = db.requests.find((x) => x.id === Number(req.params['id']));
      if (!r) return problem(404, 'Không tìm thấy yêu cầu');
      if (r.requesterId === user.id) {
        db.audit(user.id, 'GRANT_CHANGE', 'ACCESS_REQUEST', String(r.id), 'DENY', { reason: 'self-approval' });
        return problem(403, 'Không thể tự duyệt', 'Người duyệt phải khác người yêu cầu (BR09).');
      }
      if (r.status !== 'PENDING') return problem(409, 'Yêu cầu đã được xử lý');
      const input = body<{ decision?: string; grantedDays?: number; note?: string }>(req);
      const now = db.clock();
      if (input.decision === 'APPROVE') {
        const days = input.grantedDays ?? r.requestedDays;
        if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return problem(422, 'Thời hạn không hợp lệ', `Từ 1 đến ${MAX_DAYS} ngày.`);
        const validTo = new Date(now + days * 86_400_000).toISOString();
        db.grants.push({ id: db.nextId('grant', 10), userId: r.requesterId, resourceType: r.resourceType, resourceId: r.resourceId, resourceName: r.resourceName, accessLevel: r.accessLevel, validFrom: new Date(now).toISOString(), validTo, revokedAt: null, grantedById: user.id, requestId: r.id });
        Object.assign(r, { status: 'APPROVED', reviewerId: user.id, reviewNote: input.note ?? null, decidedAt: new Date(now).toISOString(), expiresAt: validTo });
        db.notify(r.requesterId, 'ACCESS_APPROVED', `Yêu cầu “${r.resourceName}” đã được duyệt (${days} ngày)`, '/me');
      } else if (input.decision === 'REJECT') {
        if (!input.note?.trim()) return problem(422, 'Cần lý do từ chối', undefined, { errors: [{ field: 'note', message: 'Bắt buộc khi từ chối (AC23)' }] });
        Object.assign(r, { status: 'REJECTED', reviewerId: user.id, reviewNote: input.note.trim(), decidedAt: new Date(now).toISOString() });
        db.notify(r.requesterId, 'ACCESS_REJECTED', `Yêu cầu “${r.resourceName}” bị từ chối`, '/access');
      } else {
        return problem(422, 'Quyết định không hợp lệ');
      }
      db.audit(user.id, 'GRANT_CHANGE', 'ACCESS_REQUEST', String(r.id), 'ALLOW', { decision: input.decision });
      return ok(requestOf(db, r));
    })
    .add('DELETE', '/access-grants/:grantId', (req) => {
      const denied = requireRole(req, 'DATA_STEWARD', 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, user } = req;
      const g = db.grants.find((x) => x.id === Number(req.params['grantId']));
      if (!g || g.revokedAt) return problem(404, 'Không tìm thấy quyền');
      g.revokedAt = new Date(db.clock()).toISOString();
      const r = db.requests.find((x) => x.id === g.requestId);
      if (r) r.status = 'REVOKED';
      db.notify(g.userId, 'ACCESS_REVOKED', `Quyền “${g.resourceName}” đã bị thu hồi`, '/me');
      db.audit(user.id, 'GRANT_REVOKE', 'ACCESS_GRANT', String(g.id));
      return noContent();
    });
}

export { grantOf };
