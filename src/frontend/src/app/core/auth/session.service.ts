import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { Me, RoleCode } from '../api/models';

const TOKEN_KEY = 'aiia.token';

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Trình duyệt chặn sessionStorage: phiên chỉ tồn tại trong bộ nhớ.
  }
}

/** Phiên đăng nhập và vai trò của người dùng hiện tại. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly tokenState = signal<string | null>(readToken());
  private readonly meState = signal<Me | null>(null);

  readonly token = this.tokenState.asReadonly();
  readonly me = this.meState.asReadonly();
  readonly isAuthenticated = computed(() => this.tokenState() !== null);
  readonly roles = computed(() => new Set((this.meState()?.roles ?? []).map((r) => r.role)));

  /** Phạm vi đơn vị: null = toàn trường; ngược lại là danh sách mã đơn vị. */
  readonly scope = computed<string[] | null>(() => {
    const roles = this.meState()?.roles ?? [];
    if (roles.some((r) => !r.scopeOrgUnit)) return null;
    return roles.map((r) => r.scopeOrgUnit as string);
  });

  hasAnyRole(...roles: RoleCode[]): boolean {
    const mine = this.roles();
    return roles.some((r) => mine.has(r));
  }

  /** Tải /me nếu chưa có. Trả false khi token không hợp lệ. */
  ensureLoaded(): Observable<boolean> {
    if (!this.tokenState()) return of(false);
    if (this.meState()) return of(true);
    return this.http.get<Me>(`${environment.apiBase}/me`).pipe(
      tap((me) => this.meState.set(me)),
      map(() => true),
      catchError(() => {
        this.clear();
        return of(false);
      }),
    );
  }

  /** Đăng nhập demo: token có dạng `demo:<userId>`, chỉ mock API chấp nhận. */
  loginDemo(userId: string): Observable<boolean> {
    this.meState.set(null);
    this.tokenState.set(`demo:${userId}`);
    writeToken(`demo:${userId}`);
    return this.ensureLoaded();
  }

  logout(): void {
    const done = () => {
      this.clear();
      void this.router.navigate(['/login']);
    };
    this.http.post(`${environment.apiBase}/me/logout`, {}).subscribe({ next: done, error: done });
  }

  clear(): void {
    this.tokenState.set(null);
    this.meState.set(null);
    writeToken(null);
  }
}
