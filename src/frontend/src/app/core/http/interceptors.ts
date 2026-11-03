import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SessionService } from '../auth/session.service';
import { ToastService } from '../ui/toast.service';
import { problemMessage, toProblem } from './problem';

/** Gắn Bearer token cho mọi request tới Platform API. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(SessionService).token();
  if (!token || !req.url.startsWith(environment.apiBase)) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};

/**
 * Xử lý lỗi chung: 401 → đăng nhập lại; lỗi mạng/5xx → toast.
 * Lỗi 4xx nghiệp vụ (403 facet bị khóa, 409, 422…) để màn hình tự hiển thị đúng ngữ cảnh.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        if (error.status === 401 && !req.url.endsWith('/me/logout')) {
          session.clear();
          void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
        } else if (error.status === 0 || error.status >= 500) {
          toast.error(problemMessage(toProblem(error)));
        }
      }
      return throwError(() => error);
    }),
  );
};
