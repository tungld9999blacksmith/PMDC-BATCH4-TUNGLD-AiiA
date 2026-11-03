import type { AlertStatus, LineageNodeType } from '../../api/models';
import type { MockDb } from '../db';
import { alertOf } from '../mappers';
import { MockRouter, body, noContent, ok, paginate, problem, requireRole } from '../router';
import type { MLineageNode } from '../types';

const ALERT_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'DISMISSED'],
  ACKNOWLEDGED: ['RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
};

const LINEAGE_ROLES = ['PLATFORM_ADMIN', 'DATA_ENGINEER', 'DATA_STEWARD', 'BI_ANALYST'] as const;

function nodeOut(n: MLineageNode) {
  return { id: n.id, type: n.type, refId: n.refId, name: n.name, layer: n.layer };
}

function walk(db: MockDb, startId: number, direction: 'UPSTREAM' | 'DOWNSTREAM' | 'BOTH', depth: number): Set<number> {
  const seen = new Set<number>([startId]);
  const step = (dir: 'UPSTREAM' | 'DOWNSTREAM') => {
    let frontier = [startId];
    for (let d = 0; d < depth && frontier.length; d++) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const e of db.lineageEdges) {
          const other = dir === 'DOWNSTREAM' ? (e.from === id ? e.to : null) : e.to === id ? e.from : null;
          if (other !== null && !seen.has(other)) {
            seen.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
  };
  if (direction !== 'UPSTREAM') step('DOWNSTREAM');
  if (direction !== 'DOWNSTREAM') step('UPSTREAM');
  return seen;
}

/** Cảnh báo trên dataset chỉ đội dữ liệu xem; cảnh báo trên metric ai dùng dashboard cũng xem được. */
function canSeeAlert(db: MockDb, userRoles: string[], targetType: string): boolean {
  return targetType === 'METRIC' || userRoles.some((r) => ['DATA_STEWARD', 'DATA_ENGINEER', 'PLATFORM_ADMIN'].includes(r));
}

export function registerOps(router: MockRouter): void {
  router
    // ── Cảnh báo bất thường ──
    .add('GET', '/alerts', ({ db, user, query }) => {
      const roles = user.roles.map((r) => r.role);
      const items = db.alerts
        .filter((a) => canSeeAlert(db, roles, a.targetType))
        .filter((a) => !query.get('kind') || a.kind === query.get('kind'))
        .filter((a) => !query.get('severity') || a.severity === query.get('severity'))
        .filter((a) => !query.get('status') || a.status === query.get('status'))
        .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
        .map((a) => alertOf(db, a));
      return ok(paginate(items, query));
    })
    .add('GET', '/alerts/:id', ({ db, user, params }) => {
      const a = db.alerts.find((x) => x.id === Number(params['id']));
      if (!a || !canSeeAlert(db, user.roles.map((r) => r.role), a.targetType)) return problem(404, 'Không tìm thấy cảnh báo');
      return ok({ ...alertOf(db, a), series: a.series, runId: a.runId });
    })
    .add('POST', '/alerts/:id/transition', ({ db, user, params, body: raw }) => {
      const a = db.alerts.find((x) => x.id === Number(params['id']));
      if (!a || !canSeeAlert(db, user.roles.map((r) => r.role), a.targetType)) return problem(404, 'Không tìm thấy cảnh báo');
      const input = (raw ?? {}) as { to?: AlertStatus; note?: string };
      if (!input.to || !ALERT_TRANSITIONS[a.status].includes(input.to)) return problem(409, 'Chuyển trạng thái không hợp lệ', `${a.status} → ${input.to ?? '?'} (BR17)`);
      a.status = input.to;
      if (input.to === 'ACKNOWLEDGED') a.acknowledgedById = user.id;
      if (input.note) a.note = input.note;
      db.audit(user.id, 'ALERT_TRANSITION', 'ALERT', String(a.id), 'ALLOW', { to: input.to });
      return ok(alertOf(db, a));
    })
    // ── Lineage ──
    .add('GET', '/lineage', (req) => {
      const denied = requireRole(req, ...LINEAGE_ROLES);
      if (denied) return denied;
      const { db, query } = req;
      const center = db.lineageNodes.find((n) => n.type === (query.get('nodeType') as LineageNodeType) && n.refId === query.get('refId'));
      if (!center) return problem(404, 'Không tìm thấy nút lineage');
      const direction = (query.get('direction') as 'UPSTREAM' | 'DOWNSTREAM' | 'BOTH' | null) ?? 'BOTH';
      const depth = Math.min(6, Math.max(1, Number(query.get('depth') ?? 2)));
      const ids = walk(db, center.id, direction, depth);
      return ok({
        center: nodeOut(center),
        nodes: db.lineageNodes.filter((n) => ids.has(n.id)).map(nodeOut),
        edges: db.lineageEdges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ from: e.from, to: e.to, transformRef: e.transformRef })),
      });
    })
    .add('GET', '/lineage/impact', (req) => {
      const denied = requireRole(req, ...LINEAGE_ROLES);
      if (denied) return denied;
      const { db, query } = req;
      const center = db.lineageNodes.find((n) => n.type === (query.get('nodeType') as LineageNodeType) && n.refId === query.get('refId'));
      if (!center) return problem(404, 'Không tìm thấy nút lineage');
      const ids = walk(db, center.id, 'DOWNSTREAM', 10);
      ids.delete(center.id);
      return ok(db.lineageNodes.filter((n) => ids.has(n.id)).map(nodeOut));
    })
    // ── Hội thoại trợ lý (lượt hỏi SSE xử lý ở mock-streams) ──
    .add('GET', '/assistant/conversations', (req) => {
      const denied = requireRole(req, 'REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD');
      if (denied) return denied;
      return ok(
        req.db.conversations
          .filter((c) => c.userId === req.user.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((c) => ({ id: c.id, title: c.title, dashboardId: c.dashboardId, createdAt: c.createdAt })),
      );
    })
    .add('POST', '/assistant/conversations', (req) => {
      const denied = requireRole(req, 'REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<{ dashboardId?: number | null }>(req);
      const c = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, userId: user.id, title: 'Hội thoại mới', dashboardId: input.dashboardId ?? null, createdAt: new Date(db.clock()).toISOString(), messages: [] };
      db.conversations.push(c);
      return ok({ id: c.id, title: c.title, dashboardId: c.dashboardId, createdAt: c.createdAt }, 201);
    })
    .add('GET', '/assistant/conversations/:id', ({ db, user, params }) => {
      const c = db.conversations.find((x) => x.id === params['id'] && x.userId === user.id);
      if (!c) return problem(404, 'Không tìm thấy hội thoại');
      return ok({ id: c.id, title: c.title, dashboardId: c.dashboardId, createdAt: c.createdAt, messages: c.messages });
    })
    .add('POST', '/assistant/messages/:id/feedback', ({ db, user, params, body: raw }) => {
      const rating = (raw as { rating?: number } | null)?.rating;
      if (rating !== 1 && rating !== -1) return problem(422, 'Đánh giá không hợp lệ');
      for (const c of db.conversations.filter((x) => x.userId === user.id)) {
        const m = c.messages.find((x) => x.id === Number(params['id']) && x.role === 'ASSISTANT');
        if (m) {
          m.feedback = rating;
          return noContent();
        }
      }
      return problem(404, 'Không tìm thấy tin nhắn');
    });
}
