import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { DashboardSummary, Delivery, Subscription, SubscriptionInput } from '../../core/api/models';
import { DashboardsApi, ReportsApi } from '../../core/api/services';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { DrawerComponent, ModalComponent, PageHeaderComponent } from '../../shared/overlays';
import { RelTimePipe, ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

const CRON_TEXT: Record<string, string> = { '0 7 * * MON': 'Hằng tuần, 7:00 thứ Hai', '0 7 * * *': 'Hằng ngày, 7:00', '0 7 1 * *': 'Hằng tháng, 7:00 ngày 1', '0 8 * * *': 'Hằng ngày, 8:00' };

/** P11 — Báo cáo tự động (US37, US38). */
@Component({
  selector: 'aiia-reports-page',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent, StateViewComponent, StatusBadgeComponent, DrawerComponent, ModalComponent, RelTimePipe, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Báo cáo tự động" [adv]="true" subtitle="Nhận dashboard qua email nội bộ theo lịch. Số liệu tính theo quyền của người nhận tại thời điểm gửi (BR18).">
        <button type="button" class="btn primary" (click)="openForm(null)">+ Đăng ký mới</button>
      </aiia-page-header>
      <section class="card flush">
        @switch (subs.state().status) {
          @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
          @case ('error') { <aiia-state kind="error" [message]="subs.message()" actionLabel="Thử lại" (action)="load()" /> }
          @default {
            @if (subs.data?.length) {
              <table class="table">
                <thead><tr><th>Dashboard</th><th>Lịch gửi</th><th>Định dạng</th><th>Tóm tắt AI</th><th>Lần gửi gần nhất</th><th>Lần kế tiếp</th><th>Trạng thái</th><th></th></tr></thead>
                <tbody>
                  @for (s of subs.data; track s.id) {
                    <tr>
                      <td>{{ boardName(s.dashboardId) }}</td>
                      <td>{{ cronText(s.cron) }}</td>
                      <td>{{ s.format }}</td>
                      <td>{{ s.includeAiSummary ? 'Có' : 'Không' }}</td>
                      <td>@if (s.lastDelivery; as d) {<aiia-status [status]="d.status" /> {{ d.sentAt | relTime }}} @else {—}</td>
                      <td>{{ s.nextRunAt | viDate: true }}</td>
                      <td><aiia-status [status]="s.status" /></td>
                      <td class="row">
                        <button type="button" class="link-btn small" (click)="history(s)">Lịch sử</button>
                        <button type="button" class="link-btn small" (click)="toggle(s)">{{ s.status === 'ACTIVE' ? 'Tạm dừng' : 'Tiếp tục' }}</button>
                        <button type="button" class="link-btn small" (click)="openForm(s)">Sửa</button>
                        <button type="button" class="link-btn small" (click)="remove(s)">Hủy</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <aiia-state message="Chưa có đăng ký nào" detail="Mở một dashboard và chọn “Đăng ký” hoặc tạo mới tại đây." actionLabel="Đăng ký mới" (action)="openForm(null)" />
            }
          }
        }
      </section>

      @if (formOpen()) {
        <aiia-modal [title]="editing() ? 'Sửa đăng ký' : 'Đăng ký báo cáo'" (closed)="formOpen.set(false)">
          <div class="stack">
            <label class="field"><span class="small muted">Dashboard</span>
              <select class="input" [(ngModel)]="form.dashboardId" [disabled]="!!editing()">
                @for (b of boards(); track b.id) {
                  <option [ngValue]="b.id">{{ b.title }}</option>
                }
              </select>
            </label>
            <label class="field"><span class="small muted">Lịch gửi</span>
              <select class="input" [(ngModel)]="form.cron">
                @for (c of cronOptions; track c[0]) {
                  <option [value]="c[0]">{{ c[1] }}</option>
                }
              </select>
            </label>
            <label class="field"><span class="small muted">Định dạng</span>
              <select class="input" [(ngModel)]="form.format"><option value="PDF">PDF đính kèm</option><option value="LINK">Liên kết tới dashboard</option></select>
            </label>
            <label class="row small"><input type="checkbox" [(ngModel)]="form.includeAiSummary" /> Kèm tóm tắt tiếng Việt (nhãn “Do AI tạo”)</label>
            <p class="small muted" style="margin: 0">Người nhận: chính bạn. Chỉ gửi tới email nội bộ của trường.</p>
            @if (formError()) {
              <div class="banner danger small" role="alert">{{ formError() }}</div>
            }
          </div>
          <div modal-foot class="modal-foot">
            <button type="button" class="btn" (click)="formOpen.set(false)">Hủy</button>
            <button type="button" class="btn primary" (click)="submit()">Lưu</button>
          </div>
        </aiia-modal>
      }

      @if (historyOf(); as s) {
        <aiia-drawer [title]="'Lịch sử gửi — ' + boardName(s.dashboardId)" (closed)="historyOf.set(null)">
          @for (d of deliveries.state().data ?? []; track d.id) {
            <article class="delivery">
              <div class="row between"><aiia-status [status]="d.status" /><span class="small muted">{{ d.sentAt | viDate: true }}</span></div>
              @if (d.aiSummary) {
                <p style="margin: 6px 0">{{ d.aiSummary }}</p>
                <span class="chip info">Do AI tạo</span>
              }
            </article>
          } @empty {
            <aiia-state message="Chưa có lần gửi nào" />
          }
        </aiia-drawer>
      }
    </div>
  `,
  styles: [
    `
      .delivery {
        padding: 10px 0;
        border-bottom: 1px solid var(--color-border);
      }
    `,
  ],
})
export class ReportsPage {
  private readonly api = inject(ReportsApi);
  private readonly dashboards = inject(DashboardsApi);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  protected readonly subs = loader<Subscription[]>();
  protected readonly deliveries = loader<Delivery[]>();
  protected readonly boards = signal<DashboardSummary[]>([]);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Subscription | null>(null);
  protected readonly historyOf = signal<Subscription | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly cronOptions = Object.entries(CRON_TEXT);
  private readonly boardMap = computed(() => new Map(this.boards().map((b) => [b.id, b.title])));
  form: SubscriptionInput = { dashboardId: 0, cron: '0 7 * * MON', format: 'PDF', includeAiSummary: true };

  constructor() {
    this.load();
    this.dashboards.list().subscribe((b) => this.boards.set(b.filter((x) => x.status === 'PUBLISHED')));
  }

  load(): void {
    this.subs.load(this.api.list(), true);
  }

  boardName(id: number | undefined): string {
    return this.boardMap().get(id) ?? `Dashboard #${id}`;
  }

  cronText(cron: string | undefined): string {
    return CRON_TEXT[cron ?? ''] ?? cron ?? '';
  }

  openForm(s: Subscription | null): void {
    this.editing.set(s);
    this.formError.set(null);
    this.form = s
      ? { dashboardId: s.dashboardId, cron: s.cron, format: s.format ?? 'PDF', includeAiSummary: s.includeAiSummary ?? true }
      : { dashboardId: this.boards()[0]?.id ?? 0, cron: '0 7 * * MON', format: 'PDF', includeAiSummary: true };
    this.formOpen.set(true);
  }

  submit(): void {
    const s = this.editing();
    const req = s?.id ? this.api.update(s.id, this.form) : this.api.create(this.form);
    req.subscribe({
      next: () => {
        this.formOpen.set(false);
        this.toast.success('Đã lưu đăng ký');
        this.load();
      },
      error: (e: unknown) => this.formError.set(problemMessage(toProblem(e))),
    });
  }

  toggle(s: Subscription): void {
    if (!s.id) return;
    this.api.update(s.id, { status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }).subscribe(() => this.load());
  }

  async remove(s: Subscription): Promise<void> {
    if (!s.id) return;
    const ok = await this.dialogs.confirm({ title: 'Hủy đăng ký', message: `Bạn sẽ không nhận báo cáo “${this.boardName(s.dashboardId)}” nữa.`, confirmLabel: 'Hủy đăng ký', danger: true });
    if (ok) this.api.remove(s.id).subscribe(() => this.load());
  }

  history(s: Subscription): void {
    if (!s.id) return;
    this.historyOf.set(s);
    this.deliveries.load(this.api.deliveries(s.id));
  }
}
