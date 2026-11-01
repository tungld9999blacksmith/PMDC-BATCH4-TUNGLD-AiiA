import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccessApi } from '../core/api/services';
import { problemMessage, toProblem } from '../core/http/problem';
import { DialogsService } from '../core/ui/dialogs.service';
import { ToastService } from '../core/ui/toast.service';
import { ModalComponent } from '../shared/overlays';

/** Toast góc phải dưới. */
@Component({
  selector: 'aiia-toasts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="'toast ' + t.kind" role="status">
          <span>{{ t.text }}</span>
          @if (t.action; as a) {
            <button type="button" class="link-btn" (click)="a.run(); toast.dismiss(t.id)">{{ a.label }}</button>
          }
          <button type="button" class="btn ghost sm" aria-label="Đóng" (click)="toast.dismiss(t.id)">✕</button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toasts {
        position: fixed;
        right: 16px;
        bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 60;
        max-width: min(420px, calc(100vw - 32px));
      }
      .toast {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        background: #0f172a;
        color: #fff;
        box-shadow: var(--shadow-2);
      }
      .toast.success {
        background: #1f6f33;
      }
      .toast.error {
        background: #b42318;
      }
      .toast .link-btn {
        color: #fff;
        text-decoration: underline;
      }
      .toast .btn {
        color: #fff;
      }
    `,
  ],
})
export class ToastHostComponent {
  protected readonly toast = inject(ToastService);
}

/** Hộp thoại xác nhận nêu rõ hậu quả trước thao tác khó đảo ngược. */
@Component({
  selector: 'aiia-confirm-host',
  standalone: true,
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialogs.confirmState(); as c) {
      <aiia-modal [title]="c.title" (closed)="c.resolve(false)">
        <p style="margin: 0; white-space: pre-line">{{ c.message }}</p>
        <div modal-foot class="modal-foot">
          <button type="button" class="btn" (click)="c.resolve(false)">Hủy</button>
          <button type="button" class="btn" [class.danger]="c.danger" [class.primary]="!c.danger" (click)="c.resolve(true)">{{ c.confirmLabel }}</button>
        </div>
      </aiia-modal>
    }
  `,
})
export class ConfirmHostComponent {
  protected readonly dialogs = inject(DialogsService);
}

/** Form “Yêu cầu quyền” mở từ mọi chỗ bị khóa (UC23, BR09). */
@Component({
  selector: 'aiia-request-access',
  standalone: true,
  imports: [ModalComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialogs.accessState(); as target) {
      <aiia-modal title="Yêu cầu quyền truy cập" (closed)="close()">
        <form class="stack" (ngSubmit)="submit()" id="access-form">
          <div class="banner info small">
            Yêu cầu sẽ được chuyển tới chuyên viên quản trị dữ liệu phụ trách. Quyền luôn có thời hạn và tự thu hồi khi hết hạn.
          </div>
          <div class="field">
            <label>Tài nguyên</label>
            <div><strong>{{ target.resourceName }}</strong> <span class="chip neutral">{{ target.resourceType }}</span></div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="ra-level">Mức truy cập</label>
              <select id="ra-level" class="input" name="level" [(ngModel)]="level">
                <option value="READ">Xem</option>
                <option value="EXPORT">Xem và xuất</option>
              </select>
            </div>
            <div class="field">
              <label for="ra-days">Thời hạn (ngày)</label>
              <input id="ra-days" class="input" type="number" min="1" max="180" name="days" [(ngModel)]="days" [class.invalid]="errors()['requestedDays']" />
              <span class="hint">Tối đa 180 ngày</span>
              @if (errors()['requestedDays']) {
                <span class="error">{{ errors()['requestedDays'] }}</span>
              }
            </div>
          </div>
          <div class="field">
            <label for="ra-purpose">Mục đích sử dụng</label>
            <textarea id="ra-purpose" class="input" name="purpose" rows="3" [(ngModel)]="purpose" [class.invalid]="errors()['purpose']" placeholder="VD: Rà soát sinh viên nợ học phí để tư vấn hỗ trợ tài chính"></textarea>
            @if (errors()['purpose']) {
              <span class="error">{{ errors()['purpose'] }}</span>
            }
          </div>
          <div class="field">
            <label for="ra-scope">Phạm vi (tùy chọn)</label>
            <input id="ra-scope" class="input" name="scope" [(ngModel)]="scope" placeholder="Mã đơn vị, phân tách bằng dấu phẩy (VD CNTT)" />
          </div>
          @if (formError()) {
            <div class="banner danger small" role="alert">{{ formError() }}</div>
          }
        </form>
        <div modal-foot class="modal-foot">
          <button type="button" class="btn" (click)="close()">Hủy</button>
          <button type="submit" form="access-form" class="btn primary" [disabled]="busy()">Gửi yêu cầu</button>
        </div>
      </aiia-modal>
    }
  `,
})
export class RequestAccessDialogComponent {
  protected readonly dialogs = inject(DialogsService);
  private readonly access = inject(AccessApi);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  level: 'READ' | 'EXPORT' = 'READ';
  days = 90;
  purpose = '';
  scope = '';
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  private readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly errors = computed(() => this.fieldErrors());

  submit(): void {
    const target = this.dialogs.accessState();
    if (!target) return;
    const local: Record<string, string> = {};
    if (this.purpose.trim().length < 10) local['purpose'] = 'Nêu rõ mục đích (tối thiểu 10 ký tự)';
    if (!Number.isInteger(Number(this.days)) || this.days < 1 || this.days > 180) local['requestedDays'] = 'Thời hạn từ 1 đến 180 ngày';
    this.fieldErrors.set(local);
    if (Object.keys(local).length) return;
    this.busy.set(true);
    this.formError.set(null);
    const orgUnitCodes = this.scope.split(',').map((x) => x.trim()).filter(Boolean);
    this.access
      .create({ resourceType: target.resourceType, resourceId: target.resourceId, accessLevel: this.level, purpose: this.purpose.trim(), requestedDays: Number(this.days), scope: orgUnitCodes.length ? { orgUnitCodes } : {} })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.close();
          this.toast.success('Đã gửi yêu cầu truy cập');
          this.toast.info('Theo dõi trạng thái tại “Yêu cầu truy cập”.');
        },
        error: (e: unknown) => {
          this.busy.set(false);
          const p = toProblem(e);
          const fields: Record<string, string> = {};
          for (const err of p.errors ?? []) if (err.field) fields[err.field] = err.message ?? '';
          this.fieldErrors.set(fields);
          this.formError.set(problemMessage(p));
        },
      });
  }

  close(): void {
    this.dialogs.closeAccess();
    this.purpose = '';
    this.scope = '';
    this.days = 90;
    this.level = 'READ';
    this.formError.set(null);
    this.fieldErrors.set({});
  }

  openRequests(): void {
    void this.router.navigate(['/access']);
  }
}
