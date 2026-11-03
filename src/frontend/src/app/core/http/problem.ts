import { HttpErrorResponse } from '@angular/common/http';
import type { Problem } from '../api/models';

/** Chuyển lỗi HTTP thành Problem (RFC 7807) để hiển thị thống nhất. */
export function toProblem(error: unknown): Problem {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as Partial<Problem> | null;
    if (body && typeof body === 'object' && 'title' in body) {
      return { type: body.type ?? 'about:blank', title: body.title ?? 'Lỗi', status: error.status, ...body };
    }
    if (error.status === 0) {
      return { type: 'about:blank', title: 'Không kết nối được máy chủ', status: 0 };
    }
    return { type: 'about:blank', title: error.statusText || 'Lỗi', status: error.status };
  }
  return { type: 'about:blank', title: 'Đã xảy ra lỗi không mong muốn', status: 500 };
}

/** Thông điệp ngắn gọn cho người dùng, ưu tiên detail rồi tới lỗi trường đầu tiên. */
export function problemMessage(problem: Problem): string {
  const firstField = problem.errors?.[0];
  if (firstField?.message) {
    return firstField.field ? `${firstField.field}: ${firstField.message}` : firstField.message;
  }
  return problem.detail ?? problem.title;
}
