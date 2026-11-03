import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { AskRequest, AssistantEvent, AssistantMessage, RunLogEvent } from '../api/models';
import { answer } from './assistant';
import { createDb, type MockDb } from './db';
import { registerAdmin } from './handlers/admin';
import { registerBi } from './handlers/bi';
import { registerCatalogDq } from './handlers/catalog-dq';
import { registerIdentityAccess } from './handlers/identity-access';
import { registerIntegration } from './handlers/integration';
import { registerMe } from './handlers/me';
import { registerOps } from './handlers/ops';
import { registerProfiles } from './handlers/profiles';
import { runOf } from './mappers';
import { MockRouter, problem, type MockResponse } from './router';
import type { MUser } from './types';

export class MockHttpError extends Error {
  constructor(readonly response: MockResponse) {
    super(String((response.body as { title?: string } | undefined)?.title ?? response.status));
  }
}

export function buildRouter(): MockRouter {
  const router = new MockRouter();
  registerMe(router);
  registerProfiles(router);
  registerIntegration(router);
  registerCatalogDq(router);
  registerIdentityAccess(router);
  registerBi(router);
  registerOps(router);
  registerAdmin(router);
  return router;
}

/**
 * Mock của Platform API, chạy trong trình duyệt. Hiện thực các endpoint của docs/api/openapi.yaml
 * trên dữ liệu tổng hợp và áp các quy tắc nghiệp vụ, để giao diện dùng được trước khi có backend.
 */
@Injectable({ providedIn: 'root' })
export class MockBackend {
  readonly db: MockDb;
  private readonly router = buildRouter();
  private readonly askLog = new Map<string, number[]>();

  constructor() {
    this.db = createDb();
  }

  userFromToken(authorization: string | null): MUser | null {
    const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (!token.startsWith('demo:')) return null;
    const user = this.db.user(token.slice(5));
    return user && user.status === 'ACTIVE' ? user : null;
  }

  async handle(method: string, path: string, query: URLSearchParams, body: unknown, headers: Record<string, string | null>): Promise<MockResponse> {
    const user = this.userFromToken(headers['authorization']);
    if (!user) return problem(401, 'Chưa đăng nhập', 'Phiên không hợp lệ, hết hạn hoặc tài khoản đã bị khóa.');
    const match = this.router.match(method, path);
    if (!match) return problem(404, 'Không tìm thấy', `${method} ${path} chưa có trong mock API.`);
    if (path === '/me') user.lastLoginAt = user.lastLoginAt ?? new Date(this.db.clock()).toISOString();
    try {
      return await match.handler({ method, path, params: match.params, query, body, headers, user, db: this.db });
    } catch (error) {
      console.error('[mock-api]', method, path, error);
      return problem(500, 'Lỗi máy chủ (mock)', error instanceof Error ? error.message : undefined);
    }
  }

  /** Luồng SSE của POST /assistant/conversations/{id}/messages. */
  ask(conversationId: string, request: AskRequest, authorization: string | null): Observable<AssistantEvent> {
    return new Observable<AssistantEvent>((subscriber) => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
      const user = this.userFromToken(authorization);
      const conversation = this.db.conversations.find((c) => c.id === conversationId && c.userId === user?.id);
      if (!user || !conversation) {
        subscriber.error(new MockHttpError(problem(user ? 404 : 401, user ? 'Không tìm thấy hội thoại' : 'Chưa đăng nhập')));
        return;
      }
      const recent = (this.askLog.get(user.id) ?? []).filter((t) => this.db.clock() - t < 60_000);
      if (recent.length >= 20) {
        subscriber.error(new MockHttpError(problem(429, 'Vượt giới hạn tần suất', 'Tối đa 20 câu hỏi mỗi phút.')));
        return;
      }
      this.askLog.set(user.id, [...recent, this.db.clock()]);

      const question = request.message.trim();
      const now = new Date(this.db.clock()).toISOString();
      const userMessage: AssistantMessage = { id: this.db.nextId('qa-message', 500), role: 'USER', content: question, createdAt: now, metricCodes: [] };
      conversation.messages.push(userMessage);
      if (conversation.title === 'Hội thoại mới') conversation.title = question.length > 60 ? `${question.slice(0, 57)}…` : question;

      const run = answer(this.db, user, this.db.nextId('qa-message', 500), question, request.clarification);
      const final = { ...run.message, question } as AssistantMessage & { question: string };
      conversation.messages.push(final);
      this.db.audit(user.id, 'QA_ASK', 'CONVERSATION', conversation.id, final.status === 'REFUSED' ? 'DENY' : 'ALLOW', { status: final.status, metricCodes: final.metricCodes });

      at(150, () => subscriber.next({ event: 'status', data: { stage: 'CHECKING' } }));
      at(450, () => subscriber.next({ event: 'status', data: { stage: 'PLANNING' } }));
      let t = 900;
      if (final.status === 'ANSWERED') {
        at(t, () => subscriber.next({ event: 'status', data: { stage: 'QUERYING' } }));
        t += 600;
        at(t, () => subscriber.next({ event: 'status', data: { stage: 'WRITING' } }));
        const words = (final.content ?? '').split(' ');
        for (let i = 0; i < words.length; i += 3) {
          t += 60;
          const chunk = words.slice(i, i + 3).join(' ') + (i + 3 < words.length ? ' ' : '');
          at(t, () => subscriber.next({ event: 'token', data: { text: chunk } }));
        }
      } else if (final.status === 'CLARIFYING' && run.clarify) {
        const clarify = run.clarify;
        at(t, () => subscriber.next({ event: 'clarify', data: clarify }));
      }
      at(t + 200, () => {
        subscriber.next({ event: 'final', data: final });
        subscriber.complete();
      });
      return () => timers.forEach(clearTimeout);
    });
  }

  /** Luồng SSE của GET /runs/{runId}/logs: log theo tiến trình thực của run. */
  runLogs(runId: string, authorization: string | null): Observable<RunLogEvent> {
    return new Observable<RunLogEvent>((subscriber) => {
      const user = this.userFromToken(authorization);
      const run = this.db.runs.find((r) => r.id === runId);
      if (!user || !run) {
        subscriber.error(new MockHttpError(problem(user ? 404 : 401, user ? 'Không tìm thấy lần chạy' : 'Chưa đăng nhập')));
        return;
      }
      const source = this.db.sources.find((s) => s.id === run.sourceId);
      const target = this.db.dataset(source?.targetDatasetId ?? 0);
      const step = (run.durationMs - 1500) / 4;
      const lines: { offset: number; level: 'INFO' | 'WARN' | 'ERROR'; step: string; message: string }[] = [
        { offset: 0, level: 'INFO', step: 'QUEUE', message: `Xếp hàng run ${run.id.slice(0, 8)} (${run.trigger})` },
        { offset: 1500, level: 'INFO', step: 'BRONZE', message: `Đọc nguồn ${source?.code}: ${run.rowsRead.toLocaleString('vi-VN')} dòng` },
        { offset: 1500 + step * 0.6, level: 'INFO', step: 'BRONZE', message: `Ghi bronze (append-only, batch ${run.id.slice(0, 6)})` },
      ];
      if (run.outcome === 'FAILED') {
        lines.push({ offset: 1500 + step, level: 'ERROR', step: 'BRONZE', message: run.errorMessage ?? 'Lỗi không xác định' });
      } else {
        lines.push({ offset: 1500 + step, level: 'INFO', step: 'DQ', message: 'Chạy quy tắc chất lượng (Soda Core + dbt tests)' });
        if (run.rowsQuarantined) lines.push({ offset: 1500 + step * 1.6, level: 'WARN', step: 'DQ', message: `${run.rowsQuarantined} bản ghi vi phạm quy tắc BLOCKING → quarantine` });
        lines.push({ offset: 1500 + step * 2, level: 'INFO', step: 'SILVER', message: `MERGE vào ${target ? `${target.schemaName}.${target.tableName}` : 'silver'}: ${run.rowsWritten.toLocaleString('vi-VN')} dòng (idempotent)` });
        lines.push({ offset: 1500 + step * 3, level: 'INFO', step: 'GOLD', message: 'dbt build: model và test đạt' });
        lines.push({ offset: run.durationMs, level: 'INFO', step: 'DONE', message: `Hoàn tất: ${run.outcome}` });
      }
      const emitted = new Set<number>();
      const tick = () => {
        const elapsed = this.db.clock() - run.queuedAt;
        lines.forEach((l, i) => {
          if (!emitted.has(i) && l.offset <= elapsed) {
            emitted.add(i);
            subscriber.next({ event: 'log', data: { ts: new Date(run.queuedAt + l.offset).toISOString(), level: l.level, step: l.step, message: l.message } });
          }
        });
        subscriber.next({ event: 'status', data: runOf(this.db, run) });
        const status = this.db.runStatus(run);
        if (status !== 'QUEUED' && status !== 'RUNNING') {
          subscriber.next({ event: 'end', data: {} });
          subscriber.complete();
          clearInterval(timer);
        }
      };
      const timer = setInterval(tick, 700);
      tick();
      return () => clearInterval(timer);
    });
  }
}
