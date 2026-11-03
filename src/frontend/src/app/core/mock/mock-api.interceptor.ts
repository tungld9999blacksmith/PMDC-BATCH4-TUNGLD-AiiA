import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { delay, from, mergeMap, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockBackend } from './mock-backend';

/** Đường dẫn vẫn gửi tới Platform API thật (đã hiện thực). */
const PASS_THROUGH = ['/health', '/health/db'];

/**
 * Chuyển request /api/v1/* sang mock API khi `environment.useMockApi` bật.
 * Tắt cờ này khi backend hiện thực đủ hợp đồng — không cần sửa code giao diện.
 */
export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.useMockApi || !req.url.startsWith(environment.apiBase)) return next(req);
  const [rawPath, rawQuery] = req.url.slice(environment.apiBase.length).split('?');
  if (PASS_THROUGH.includes(rawPath)) return next(req);

  const query = new URLSearchParams(rawQuery ?? '');
  for (const key of req.params.keys()) query.set(key, req.params.get(key) ?? '');
  const headers = {
    authorization: req.headers.get('Authorization'),
    'if-match': req.headers.get('If-Match'),
  };
  const backend = inject(MockBackend);

  return from(backend.handle(req.method, rawPath, query, req.body, headers)).pipe(
    delay(environment.mockLatencyMs),
    mergeMap((res) =>
      res.status >= 400
        ? throwError(() => new HttpErrorResponse({ status: res.status, error: res.body, url: req.url, statusText: 'Mock error' }))
        : of(new HttpResponse({ status: res.status, body: res.body ?? null, url: req.url })),
    ),
  );
};
