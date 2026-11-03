import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { AccessRequest, Dataset, Page } from '../../core/api/models';
import { AccessApi, CatalogApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { DrawerComponent, PageHeaderComponent } from '../../shared/overlays';
import { RelTimePipe, ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

const MAX_DAYS = 180;
const RESOURCE_LABELS: Record<string, string> = { DATASET: 'Dataset', DASHBOARD: 'Dashboard', PROFILE_FACET: 'Nhóm thông tin hồ sơ', METRIC: 'Metric' };

/** P24 — Yêu cầu truy cập: của tôi và hàng đợi duyệt (US23, BR09). */
@Component({
  selector: 'aiia-access-page',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent, DrawerComponent, StateViewComponent, StatusBadgeComponent, RelTimePipe, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Yêu cầu truy cập" subtitle="Quyền được cấp có thời hạn tối đa 180 ngày, người duyệt phải khác người yêu cầu và mọi quyết định đều được ghi nhật ký (BR09).">
        <div class="row">
          <select class="input" aria-label="Chọn dataset để yêu cầu quyền" [(ngModel)]="pickDataset">
            <option [ngValue]="null">Yêu cầu quyền dataset…</option>
            @for (d of restricted(); track d.id) {
              <option [ngValue]="d">{{ d.schemaName }}.{{ d.tableName }}</option>
            }
          </select>
          <button type="button" class="btn primary" [disabled]="!pickDataset" (click)="newRequest()">Gửi yêu cầu</button>
        </div>
      </aiia-page-header>

      @if (isSteward) {
        <div class="tabs" role="tablist">
          <button type="button" role="tab" class="tab" [class.active]="activeBox() === 'mine'" [attr.aria-selected]="activeBox() === 'mine'" (click)="setBox('mine')">Yêu cầu của tôi</button>
          <button type="button" role="tab" class="tab" [class.active]="activeBox() === 'review'" [attr.aria-selected]="activeBox() === 'review'" (click)="setBox('review')">
            Cần duyệt @if (pendingCount()) { <span class="chip warn">{{ pendingCount() }}</span> }
          </button>
        </div>
      }

      <div class="card row filters">
        <select class="input" aria-label="Trạng thái" [(ngModel)]="status" (ngModelChange)="load()">
          <option value="">Mọi trạng thái</option>
          <option value="PENDING">Chờ duyệt</option>
          <option value="APPROVED">Đã duyệt</option>
          <option value="REJECTED">Từ chối</option>
          <option value="CANCELLED">Đã hủy</option>
          <option value="EXPIRED">Hết hạn</option>
          <option value="REVOKED">Thu hồi</option>
        </select>
      </div>

      <section class="card flush">
        @switch (requests.state().status) {
          @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
          @case ('error') { <aiia-state kind="error" [message]="requests.message()" actionLabel="Thử lại" (action)="load()" /> }
          @default {
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    @if (activeBox() === 'review') { <th>Người yêu cầu</th> }
                    <th>Tài nguyên</th><th>Mức</th><th>Mục đích</th><th class="num">Số ngày</th><th>Gửi</th><th>Hết hạn</th><th>Trạng thái</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of requests.data?.items ?? []; track r.id) {
                    <tr [class.clickable]="activeBox() === 'review'" tabindex="0" (click)="activeBox() === 'review' && open(r)" (keydown.enter)="activeBox() === 'review' && open(r)">
                      @if (activeBox() === 'review') { <td>{{ r.requester?.fullName }}</td> }
                      <td><span class="small muted">{{ resourceLabel(r.resourceType) }}</span> {{ r.resourceName }}</td>
                      <td>{{ r.accessLevel === 'EXPORT' ? 'Xuất' : 'Đọc' }}</td>
                      <td class="purpose" [title]="r.purpose">{{ r.purpose }}</td>
                      <td class="num">{{ r.requestedDays }}</td>
                      <td>{{ r.createdAt | relTime }}</td>
                      <td>{{ r.expiresAt ? (r.expiresAt | viDate) : '—' }}</td>
                      <td>
                        <aiia-status [status]="r.status" />
                        @if (r.reviewNote) { <div class="small muted" [title]="r.reviewNote">“{{ r.reviewNote }}”</div> }
                      </td>
                      <td>
                        @if (activeBox() === 'mine' && r.status === 'PENDING') {
                          <button type="button" class="link-btn small" (click)="$event.stopPropagation(); cancel(r)">Hủy</button>
                        } @else if (activeBox() === 'review' && r.status === 'PENDING') {
                          <button type="button" class="btn sm" (click)="$event.stopPropagation(); open(r)">Xem xét</button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td [attr.colspan]="activeBox() === 'review' ? 9 : 8">
                      <aiia-state [message]="activeBox() === 'review' ? 'Không có yêu cầu cần duyệt' : 'Bạn chưa gửi yêu cầu nào'" [detail]="activeBox() === 'mine' ? 'Khi gặp dữ liệu bị khóa, bấm “Yêu cầu quyền” ngay tại đó.' : null" />
                    </td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      </section>

      @if (reviewing(); as r) {
        <aiia-drawer title="Xem xét yêu cầu" (closed)="reviewing.set(null)">
          <div class="stack">
            <dl class="facts">
              <dt>Người yêu cầu</dt><dd>{{ r.requester?.fullName }}</dd>
              <dt>Tài nguyên</dt><dd>{{ resourceLabel(r.resourceType) }} · <strong>{{ r.resourceName }}</strong></dd>
              <dt>Mức truy cập</dt><dd>{{ r.accessLevel === 'EXPORT' ? 'Đọc và xuất' : 'Chỉ đọc' }}</dd>
              <dt>Mục đích</dt><dd>{{ r.purpose }}</dd>
              <dt>Thời hạn xin</dt><dd>{{ r.requestedDays }} ngày</dd>
              @if (scopeText(r)) { <dt>Phạm vi</dt><dd class="mono small">{{ scopeText(r) }}</dd> }
              <dt>Gửi lúc</dt><dd>{{ r.createdAt | viDate: true }}</dd>
            </dl>
            @if (isSelf(r)) {
              <div class="banner warn small">Bạn không thể tự duyệt yêu cầu của chính mình (BR09). Một Data Steward khác cần xem xét.</div>
            } @else if (r.status === 'PENDING') {
              <label class="field">
                <span class="small muted">Số ngày cấp (1–{{ maxDays }})</span>
                <input class="input" type="number" min="1" [max]="maxDays" [(ngModel)]="grantedDays" [class.invalid]="!daysValid()" />
                @if (!daysValid()) { <span class="error">Từ 1 đến {{ maxDays }} ngày.</span> }
              </label>
              <label class="field">
                <span class="small muted">Ghi chú (bắt buộc khi từ chối)</span>
                <textarea class="input" [(ngModel)]="note" [class.invalid]="noteMissing()"></textarea>
                @if (noteMissing()) { <span class="error">Nêu lý do từ chối để người yêu cầu biết cách bổ sung.</span> }
              </label>
              @if (decisionError()) {
                <div class="banner danger small" role="alert">{{ decisionError() }}</div>
              }
              <div class="row">
                <span class="spacer"></span>
                <button type="button" class="btn danger" (click)="decide(r, 'REJECT')">Từ chối</button>
                <button type="button" class="btn primary" [disabled]="!daysValid()" (click)="decide(r, 'APPROVE')">Duyệt {{ grantedDays }} ngày</button>
              </div>
            } @else {
              <div class="row"><aiia-status [status]="r.status" /> <span class="small muted">bởi {{ r.reviewer?.fullName }} · {{ r.decidedAt | viDate: true }}</span></div>
            }
          </div>
        </aiia-drawer>
      }
    </div>
  `,
  styles: [
    `
      .tabs {
        margin-bottom: 12px;
      }
      .filters {
        margin-bottom: 16px;
      }
      .purpose {
        max-width: 280px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .facts {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 6px 12px;
        margin: 0;
      }
      .facts dt {
        color: var(--color-muted);
        font-size: 13px;
      }
      .facts dd {
        margin: 0;
      }
    `,
  ],
})
export class AccessPage {
  readonly box = input<string | undefined>();

  private readonly api = inject(AccessApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  private readonly session = inject(SessionService);
  protected readonly isSteward = this.session.hasAnyRole('DATA_STEWARD');
  protected readonly maxDays = MAX_DAYS;
  protected readonly requests = loader<Page<AccessRequest>>();
  protected readonly datasets = signal<Dataset[]>([]);
  protected readonly restricted = computed(() => this.datasets().filter((d) => d.accessible === false));
  protected readonly pendingCount = signal(0);
  protected readonly reviewing = signal<AccessRequest | null>(null);
  protected readonly decisionError = signal<string | null>(null);
  protected readonly noteMissing = signal(false);
  protected readonly activeBox = computed<'mine' | 'review'>(() => (this.box() === 'review' && this.isSteward ? 'review' : 'mine'));
  status = '';
  note = '';
  grantedDays = 30;
  pickDataset: Dataset | null = null;
  private dialogWasOpen = false;

  constructor() {
    this.catalog.datasets({ pageSize: 100 }).subscribe((p) => this.datasets.set(p.items));
    effect(() => {
      const box = this.activeBox();
      untracked(() => {
        this.status = box === 'review' ? 'PENDING' : '';
        this.load();
      });
    });
    // Dialog yêu cầu quyền đóng lại → tải lại danh sách để thấy yêu cầu mới.
    effect(() => {
      const open = this.dialogs.accessState() !== null;
      if (this.dialogWasOpen && !open) untracked(() => this.load());
      this.dialogWasOpen = open;
    });
  }

  load(): void {
    this.requests.load(this.api.list(this.activeBox(), { status: this.status || undefined }), true);
    if (this.isSteward) this.api.list('review', { status: 'PENDING' }).subscribe({ next: (p) => this.pendingCount.set(p.items.filter((r) => !this.isSelf(r)).length), error: () => undefined });
  }

  setBox(box: 'mine' | 'review'): void {
    void this.router.navigate([], { queryParams: { box }, queryParamsHandling: 'merge' });
  }

  resourceLabel(t: string | undefined): string {
    return RESOURCE_LABELS[t ?? ''] ?? t ?? '';
  }

  scopeText(r: AccessRequest): string {
    const s = r.scope ?? {};
    return Object.keys(s).length ? JSON.stringify(s) : '';
  }

  isSelf(r: AccessRequest): boolean {
    return !!r.requester?.id && r.requester.id === this.session.me()?.id;
  }

  daysValid(): boolean {
    return Number.isInteger(Number(this.grantedDays)) && this.grantedDays >= 1 && this.grantedDays <= MAX_DAYS;
  }

  newRequest(): void {
    const d = this.pickDataset;
    if (!d) return;
    this.dialogs.requestAccess({ resourceType: 'DATASET', resourceId: String(d.id), resourceName: `${d.schemaName}.${d.tableName}` });
    this.pickDataset = null;
  }

  open(r: AccessRequest): void {
    this.reviewing.set(r);
    this.note = '';
    this.grantedDays = Math.min(MAX_DAYS, r.requestedDays);
    this.decisionError.set(null);
    this.noteMissing.set(false);
  }

  async cancel(r: AccessRequest): Promise<void> {
    if (!r.id) return;
    const ok = await this.dialogs.confirm({ title: 'Hủy yêu cầu', message: `Hủy yêu cầu truy cập “${r.resourceName}”?`, confirmLabel: 'Hủy yêu cầu' });
    if (!ok) return;
    this.api.cancel(r.id).subscribe({
      next: () => {
        this.toast.success('Đã hủy yêu cầu');
        this.load();
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  decide(r: AccessRequest, decision: 'APPROVE' | 'REJECT'): void {
    if (!r.id) return;
    this.decisionError.set(null);
    if (decision === 'REJECT' && !this.note.trim()) {
      this.noteMissing.set(true);
      return;
    }
    this.noteMissing.set(false);
    this.api.decide(r.id, decision, decision === 'APPROVE' ? Number(this.grantedDays) : undefined, this.note.trim() || undefined).subscribe({
      next: () => {
        this.toast.success(decision === 'APPROVE' ? `Đã cấp quyền ${this.grantedDays} ngày` : 'Đã từ chối yêu cầu');
        this.reviewing.set(null);
        this.load();
      },
      error: (e: unknown) => this.decisionError.set(problemMessage(toProblem(e))),
    });
  }
}
