import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
  action?: { label: string; run: () => void };
}

/** Thông báo ngắn: thành công tự ẩn sau 4 giây, lỗi giữ tới khi đóng (README §4.4). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  readonly toasts = signal<Toast[]>([]);

  success(text: string): void {
    const id = this.push({ kind: 'success', text });
    setTimeout(() => this.dismiss(id), 4000);
  }

  info(text: string): void {
    const id = this.push({ kind: 'info', text });
    setTimeout(() => this.dismiss(id), 4000);
  }

  error(text: string, action?: Toast['action']): void {
    this.push({ kind: 'error', text, action });
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(toast: Omit<Toast, 'id'>): number {
    const id = ++this.seq;
    this.toasts.update((list) => [...list, { ...toast, id }]);
    return id;
  }
}
