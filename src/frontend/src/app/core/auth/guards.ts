import { inject } from '@angular/core';
import { CanDeactivateFn, CanMatchFn, Route, Router, UrlSegment } from '@angular/router';
import { map } from 'rxjs';
import type { RoleCode } from '../api/models';
import { SessionService } from './session.service';

/** Chặn khu vực cần đăng nhập; chuyển về P01 kèm đường dẫn để quay lại. */
export const authGuard: CanMatchFn = (_route: Route, segments: UrlSegment[]) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return session
    .ensureLoaded()
    .pipe(map((ok) => (ok ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl } }))));
};

/**
 * Chặn route theo vai trò (data.roles). Thiếu vai trò → P04 (403).
 * Đây chỉ là UX; backend vẫn kiểm tra quyền ở mọi API.
 */
export const roleGuard: CanMatchFn = (route: Route) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const required = (route.data?.['roles'] as RoleCode[] | undefined) ?? [];
  return session.ensureLoaded().pipe(
    map((ok) => {
      if (!ok) return router.createUrlTree(['/login']);
      if (required.length === 0 || session.hasAnyRole(...required)) return true;
      return router.createUrlTree(['/403']);
    }),
  );
};

/** Cảnh báo khi rời trang còn thay đổi chưa lưu (biểu mẫu, trình thiết kế). */
export const unsavedChangesGuard: CanDeactivateFn<{ hasUnsavedChanges(): boolean }> = (component) =>
  !component.hasUnsavedChanges() || window.confirm('Có thay đổi chưa lưu. Rời trang và bỏ các thay đổi này?');
