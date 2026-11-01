import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type QueryValue = string | number | boolean | readonly (string | number)[] | null | undefined;
export type Query = Record<string, QueryValue>;

/** Lớp mỏng trên HttpClient: gắn tiền tố /api/v1 và bỏ tham số rỗng. */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  readonly base = environment.apiBase;

  get<T>(path: string, query?: Query): Observable<T> {
    return this.http.get<T>(this.base + path, { params: toParams(query) });
  }

  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Observable<T> {
    return this.http.post<T>(this.base + path, body ?? {}, { headers: new HttpHeaders(headers ?? {}) });
  }

  put<T>(path: string, body?: unknown, headers?: Record<string, string>): Observable<T> {
    return this.http.put<T>(this.base + path, body ?? {}, { headers: new HttpHeaders(headers ?? {}) });
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.base + path, body);
  }

  delete<T = void>(path: string): Observable<T> {
    return this.http.delete<T>(this.base + path);
  }
}

export function toParams(query?: Query): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params = Array.isArray(value)
      ? params.set(key, value.join(','))
      : params.set(key, String(value));
  }
  return params;
}
