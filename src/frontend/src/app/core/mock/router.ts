import type { RoleCode } from '../api/models';
import type { MockDb } from './db';
import type { MUser } from './types';

export interface MockRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string | null>;
  user: MUser;
  db: MockDb;
}

export interface MockResponse {
  status: number;
  body?: unknown;
}

export type Handler = (req: MockRequest) => MockResponse | Promise<MockResponse>;

interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

export class MockRouter {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    const keys: string[] = [];
    const regex = new RegExp(
      '^' + pattern.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key);
        return '([^/]+)';
      }) + '$',
    );
    this.routes.push({ method, regex, keys, handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(path);
      if (m) {
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

export const ok = (body?: unknown, status = 200): MockResponse => ({ status, body });
export const noContent = (): MockResponse => ({ status: 204 });

export function problem(status: number, title: string, detail?: string, extra: Record<string, unknown> = {}): MockResponse {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { status, body: { type: `https://aiia.local/problems/${slug}`, title, status, detail, ...extra } };
}

/** 403 khi vai trò không đủ (backend luôn kiểm tra, UI chỉ ẩn nút). */
export function requireRole(req: MockRequest, ...roles: RoleCode[]): MockResponse | null {
  if (req.user.roles.some((r) => roles.includes(r.role))) return null;
  req.db.audit(req.user.id, 'ACCESS_DENIED', 'ENDPOINT', `${req.method} ${req.path}`, 'DENY');
  return problem(403, 'Không có quyền', 'Vai trò của bạn không được phép thực hiện thao tác này.');
}

export function paginate<T>(items: T[], query: URLSearchParams): { page: number; pageSize: number; total: number; items: T[] } {
  const page = Math.max(1, Number(query.get('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize') ?? 20)));
  return { page, pageSize, total: items.length, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

export function body<T>(req: MockRequest): T {
  return (req.body ?? {}) as T;
}

export const iso = (ms: number): string => new Date(ms).toISOString();
