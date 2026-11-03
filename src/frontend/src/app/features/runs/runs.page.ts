import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import type { DataSource, Page, PipelineRun, PipelineRunDetail, RunLogEvent } from '../../core/api/models';
import { IntegrationApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { DrawerComponent, PageHeaderComponent, PagerComponent } from '../../shared/overlays';
import { RelTimePipe, ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

type LogLine = Extract<RunLogEvent, { event: 'log' }>['data'];
const STEP_LABELS: Record<string, string> = { BRONZE: 'Nạp Bronze', DQ: 'Kiểm tra chất lượng', SILVER: 'Chuẩn hóa Silver', GOLD: 'Tổng hợp Gold' };
const TRIGGER_LABELS: Record<string, string> = { MANUAL: 'Thủ công', SCHEDULE: 'Theo lịch', RERUN: 'Chạy lại', REPROCESS: 'Xử lý lại cách ly' };
const ACTIVE = new Set(['QUEUED', 'RUNNING']);

/** P15 — Giám sát pipeline: danh sách lần chạy, chi tiết bước, log trực tiếp (US09, US10). */
@Component({
  selector: 'aiia-runs-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, PagerComponent, DrawerComponent, StateViewComponent, StatusBadgeComponent, RelTimePipe, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Giám sát pipeline" subtitle="Mỗi lần chạy đi qua Bronze → kiểm tra chất lượng → Silver → Gold. Bản ghi vi phạm quy tắc chặn được đưa vào vùng cách ly." />

      <div class="card row filters">
        <select class="input" aria-label="Nguồn" [(ngModel)]="sourceId" (ngModelChange)="reload()">
          <option value="">Mọi nguồn</option>
          @for (s of sources(); track s.id) {
            <option [value]="s.id">{{ s.code }} · {{ s.name }}</option>
          }
        </select>
        <select class="input" aria-label="Trạng thái" [(ngModel)]="status" (ngModelChange)="reload()">
          <option value="">Mọi trạng thái</option>
          @for (s of statuses; track s) {
            <option [value]="s">{{ s }}</option>
          }
        </select>
        <span class="spacer"></span>
        @if (hasActive()) {
          <span class="small muted" aria-live="polite">● Tự làm mới mỗi 5 giây</span>
        }
      </div>

      <section class="card flush">
        @switch (runs.state().status) {
          @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
          @case ('error') { <aiia-state kind="error" [message]="runs.message()" actionLabel="Thử lại" (action)="reload()" /> }
          @default {
            @if (runs.data?.items?.length) {
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Nguồn</th><th>Kích hoạt</th><th>Trạng thái</th><th class="num">Đọc</th><th class="num">Ghi</th><th class="num">Cách ly</th><th>Bắt đầu</th><th>Thời lượng</th></tr></thead>
                  <tbody>
                    @for (r of runs.data!.items; track r.id) {
                      <tr class="clickable" [class.selected]="r.id === runId()" tabindex="0" (click)="open(r)" (keydown.enter)="open(r)">
                        <td class="mono">{{ r.sourceCode }}</td>
                        <td>{{ trigger(r.trigger) }}</td>
                        <td><aiia-status [status]="r.status" /></td>
                        <td class="num">{{ r.rowsRead ?? '—' }}</td>
                        <td class="num">{{ r.rowsWritten ?? '—' }}</td>
                        <td class="num" [class.warn-text]="(r.rowsQuarantined ?? 0) > 0">{{ r.rowsQuarantined ?? 0 }}</td>
                        <td>{{ (r.startedAt ?? r.queuedAt) | relTime }}</td>
                        <td>{{ duration(r) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <aiia-pager [page]="page()" [pageSize]="20" [total]="runs.data!.total" (pageChange)="page.set($event); reload()" />
            } @else {
              <aiia-state message="Chưa có lần chạy nào" detail="Ingest một nguồn ở trang Nguồn dữ liệu để bắt đầu." />
            }
          }
        }
      </section>

      @if (runId()) {
        <aiia-drawer [title]="'Lần chạy ' + (detail()?.sourceCode ?? '')" [wide]="true" (closed)="close()">
          @if (detail(); as d) {
            <div class="stack">
              <div class="row">
                <aiia-status [status]="d.status" />
                <span class="small muted">{{ trigger(d.trigger) }} · xếp hàng {{ d.queuedAt | viDate: true }}</span>
                <span class="spacer"></span>
                <span class="small mono muted">{{ d.id }}</span>
              </div>

              <ol class="steps" aria-label="Các bước">
                @for (s of d.steps ?? []; track s.name) {
                  <li [class]="'st-' + (s.status ?? '').toLowerCase()">
                    <span class="dot" aria-hidden="true"></span>
                    <div>
                      <div><strong>{{ stepLabel(s.name) }}</strong></div>
                      <aiia-status [status]="s.status" />
                    </div>
                  </li>
                }
              </ol>

              <div class="grid cols-3">
                <div class="kpi"><div class="label">Bản ghi đọc</div><div class="value">{{ d.rowsRead ?? 0 }}</div></div>
                <div class="kpi"><div class="label">Đã ghi</div><div class="value">{{ d.rowsWritten ?? 0 }}</div></div>
                <div class="kpi"><div class="label">Cách ly</div><div class="value">{{ d.rowsQuarantined ?? 0 }}</div></div>
              </div>

              @if (d.errorMessage) {
                <div class="banner danger small" role="alert">{{ d.errorMessage }}</div>
              }
              @if (d.status === 'PARTIAL') {
                <div class="banner warn small">
                  <div>
                    {{ d.rowsQuarantined }} bản ghi vi phạm quy tắc chặn đã vào vùng cách ly.
                    <a routerLink="/quality">Xem issue chất lượng</a> ·
                    <a routerLink="/explorer" [queryParams]="{ layer: 'QUARANTINE' }">Xem bản ghi cách ly</a>
                  </div>
                </div>
              }

              @if (d.dqResults?.length) {
                <div>
                  <h3>Kết quả kiểm tra chất lượng</h3>
                  <table class="table">
                    <thead><tr><th>Quy tắc</th><th>Mức</th><th class="num">Kiểm</th><th class="num">Lỗi</th><th>Kết quả</th></tr></thead>
                    <tbody>
                      @for (q of d.dqResults; track q.ruleId) {
                        <tr>
                          <td>{{ q.description }}</td>
                          <td><aiia-status [status]="q.severity" /></td>
                          <td class="num">{{ q.evaluated }}</td>
                          <td class="num">{{ q.failed }}</td>
                          <td><aiia-status [status]="q.status" /></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }

              <div>
                <div class="row between">
                  <h3 style="margin: 0">Log</h3>
                  @if (streaming()) { <span class="small muted">● đang nhận log</span> }
                </div>
                <pre class="log mono" role="log" aria-live="polite">@for (l of logs(); track $index) {<span [class]="'lv-' + l.level.toLowerCase()">{{ l.ts.slice(11, 19) }} {{ l.level.padEnd(5) }} [{{ l.step }}] {{ l.message }}</span>
}@if (!logs().length) {<span class="muted">Chưa có log.</span>}</pre>
              </div>

              @if (canRerun && !isActive(d.status)) {
                <div class="row">
                  <span class="spacer"></span>
                  @if ((d.rowsQuarantined ?? 0) > 0) {
                    <button type="button" class="btn" (click)="rerun(d, 'REPROCESS_QUARANTINE')">Xử lý lại bản ghi cách ly</button>
                  }
                  <button type="button" class="btn primary" (click)="rerun(d, 'RERUN')">Chạy lại</button>
                </div>
              }
            </div>
          } @else if (detailError()) {
            <aiia-state kind="error" [message]="detailError()!" />
          } @else {
            <aiia-state kind="loading" />
          }
        </aiia-drawer>
      }
    </div>
  `,
  styles: [
    `
      .filters {
        margin-bottom: 16px;
      }
      .warn-text {
        color: var(--color-warn, #e8590c);
        font-weight: 600;
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .steps li {
        display: flex;
        gap: 8px;
        padding: 8px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
      }
      .dot {
        width: 10px;
        height: 10px;
        margin-top: 5px;
        border-radius: 999px;
        background: var(--color-border);
        flex-shrink: 0;
      }
      .st-succeeded .dot {
        background: #2b8a3e;
      }
      .st-running .dot {
        background: #1864ab;
        animation: pulse 1s infinite;
      }
      .st-partial .dot {
        background: #e8590c;
      }
      .st-failed .dot {
        background: #c92a2a;
      }
      @keyframes pulse {
        50% {
          opacity: 0.3;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .st-running .dot {
          animation: none;
        }
      }
      @media (max-width: 640px) {
        .steps {
          grid-template-columns: 1fr 1fr;
        }
      }
      .log {
        margin: 6px 0 0;
        max-height: 260px;
        overflow: auto;
        padding: 10px;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 6px;
        font-size: 12px;
        white-space: pre-wrap;
      }
      .lv-warn {
        color: #ffd43b;
      }
      .lv-error {
        color: #ff8787;
      }
    `,
  ],
})
export class RunsPage {
  readonly runId = input<string | undefined>();

  private readonly api = inject(IntegrationApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  protected readonly canRerun = inject(SessionService).hasAnyRole('DATA_ENGINEER');
  protected readonly runs = loader<Page<PipelineRun>>();
  protected readonly sources = signal<DataSource[]>([]);
  protected readonly page = signal(1);
  protected readonly detail = signal<PipelineRunDetail | null>(null);
  protected readonly detailError = signal<string | null>(null);
  protected readonly logs = signal<LogLine[]>([]);
  protected readonly streaming = signal(false);
  protected readonly statuses = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED'];
  protected readonly hasActive = computed(() => (this.runs.state().data?.items ?? []).some((r) => this.isActive(r.status)) || this.isActive(this.detail()?.status));
  private logSub: Subscription | null = null;
  sourceId = '';
  status = '';

  constructor() {
    this.reload();
    this.api.sources().subscribe((p) => this.sources.set(p.items));
    effect(() => {
      const id = this.runId();
      untracked(() => this.openDetail(id));
    });
    const tick = interval(5000).subscribe(() => {
      if (!this.hasActive()) return;
      this.runs.load(this.query(), true);
      const id = this.runId();
      if (id) this.refreshDetail(id);
    });
    inject(DestroyRef).onDestroy(() => {
      tick.unsubscribe();
      this.logSub?.unsubscribe();
    });
  }

  private query() {
    return this.api.runs({ page: this.page(), pageSize: 20, sourceId: this.sourceId || undefined, status: this.status || undefined });
  }

  reload(): void {
    this.runs.load(this.query(), true);
  }

  isActive(status: string | undefined): boolean {
    return ACTIVE.has(status ?? '');
  }

  trigger(t: string | undefined): string {
    return TRIGGER_LABELS[t ?? ''] ?? t ?? '';
  }

  stepLabel(s: string | undefined): string {
    return STEP_LABELS[s ?? ''] ?? s ?? '';
  }

  duration(r: PipelineRun): string {
    if (!r.startedAt) return '—';
    const end = r.finishedAt ? Date.parse(r.finishedAt) : Date.now();
    const sec = Math.max(0, Math.round((end - Date.parse(r.startedAt)) / 1000));
    return sec < 60 ? `${sec} giây` : `${Math.floor(sec / 60)} phút ${sec % 60} giây`;
  }

  open(r: PipelineRun): void {
    void this.router.navigate(['/runs', r.id], { queryParamsHandling: 'preserve' });
  }

  close(): void {
    void this.router.navigate(['/runs'], { queryParamsHandling: 'preserve' });
  }

  private openDetail(id: string | undefined): void {
    this.logSub?.unsubscribe();
    this.detail.set(null);
    this.detailError.set(null);
    this.logs.set([]);
    if (!id) return;
    this.refreshDetail(id);
    this.streaming.set(true);
    this.logSub = this.api.runLogs(id).subscribe({
      next: (e) => {
        if (e.event === 'log') this.logs.update((l) => [...l, e.data]);
        else if (e.event === 'status') this.detail.update((d) => (d ? { ...d, ...e.data } : d));
        else if (e.event === 'end') {
          this.streaming.set(false);
          this.refreshDetail(id);
        }
      },
      error: () => this.streaming.set(false),
      complete: () => this.streaming.set(false),
    });
  }

  private refreshDetail(id: string): void {
    this.api.run(id).subscribe({
      next: (d) => this.detail.set(d),
      error: (e: unknown) => this.detailError.set(problemMessage(toProblem(e))),
    });
  }

  async rerun(d: PipelineRunDetail, mode: 'RERUN' | 'REPROCESS_QUARANTINE'): Promise<void> {
    if (!d.id) return;
    const ok = await this.dialogs.confirm(
      mode === 'RERUN'
        ? { title: 'Chạy lại', message: `Chạy lại toàn bộ pipeline cho ${d.sourceCode}? Bronze là append-only nên dữ liệu cũ không bị ghi đè.`, confirmLabel: 'Chạy lại' }
        : { title: 'Xử lý lại bản ghi cách ly', message: `Đưa ${d.rowsQuarantined} bản ghi cách ly qua kiểm tra chất lượng lần nữa (sau khi nguồn đã sửa).`, confirmLabel: 'Xử lý lại' },
    );
    if (!ok) return;
    this.api.rerun(d.id, mode).subscribe({
      next: (run) => {
        this.toast.success('Đã đưa vào hàng đợi');
        this.reload();
        void this.router.navigate(['/runs', run.id]);
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }
}
