import { Injectable, signal } from '@angular/core';
import type { ResourceType } from '../api/models';

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Tên hành động cụ thể, không dùng “OK” (README §4.4). */
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface AccessTarget {
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
}

/** Hộp thoại xác nhận và form yêu cầu quyền dùng chung; được hiển thị bởi app shell. */
@Injectable({ providedIn: 'root' })
export class DialogsService {
  readonly confirmState = signal<ConfirmRequest | null>(null);
  readonly accessState = signal<AccessTarget | null>(null);

  confirm(options: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmState.set({
        ...options,
        resolve: (ok) => {
          this.confirmState.set(null);
          resolve(ok);
        },
      });
    });
  }

  requestAccess(target: AccessTarget): void {
    this.accessState.set(target);
  }

  closeAccess(): void {
    this.accessState.set(null);
  }
}
