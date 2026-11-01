import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Alert, AlertDetail, AlertStatus, Page } from '../../core/api/models';
import { OpsApi } from '../../core/api/services';
import { problemMessage, toProblem } from '../../core/http/problem';
import { ToastService } from '../../core/ui/toast.service';
import { KIND_LABELS } from '../../core/util/labels';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { ChartComponent, type ChartData } from '../../shared/chart';
import { DrawerComponent, PageHeaderComponent, PagerComponent } from '../../shared/overlays';
import { RelTimePipe, ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

const TRANSITIONS: Record<string, [AlertStatus & ('ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED'), string][]> = {
  OPEN: [
    ['ACKNOWLEDGED', 'Ghi nhận'],
    ['DISMISSED', 'Bỏ qua (báo động giả)'],
  ],
  ACKNOWLEDGED: [
    ['RESOLVED', 'Đã xử lý'],
    ['DISMISSED', 'Bỏ qua (báo động giả)'],
  ],
};
const SEVERITY_TONE: Record<string, string> = { CRITICAL: 'danger', HIGH: 'danger', MEDIUM: 'warn', LOW: 'neutral', WARNING: 'warn', INFO: 'info' };

/** P23 — Cảnh báo bất thường: khối lượng, độ tươi, biến động chỉ số (US22, BR17). */
@Component({
  selector: 'aiia-alerts-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, PagerComponent, DrawerComponent, StateViewComponent, StatusBadgeComponent, ChartComponent, RelTimePipe, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Cảnh báo bất thường" [adv]="true" subtitle="Hệ thống so giá trị quan sát với dải kỳ vọng học từ lịch sử. Ghi nhận khi bạn đã biết, bỏ qua nếu là báo động giả để mô hình học lại." />
      <div class="card row filters">
        <select class="input" aria-label="Loại" [(ngModel)]="kind" (ngModelChange)="reload()">
          <option value="">Mọi loại</option>
          @for (k of kinds; track k[0]) {
            <option [value]="k[0]">{{ k[1] }}</option>
          }
        </select>
        <select class="input" aria-label="Trạng thái" [(ngModel)]="status" (ngModelChange)="reload()">
          <option value="">Mọi trạng thái</option>
          <option value="OPEN">Mới</option>
          <option value="ACKNOWLEDGED">Đã ghi nhận</option>
          <option value="RESOLVED">Đã xử lý</option>
          <option value="DISMISSED">Đã bỏ qua</option>
        </select>
      </div>

      <section class="card flush">
        @switch (alerts.state().status) {
          @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
          @case ('error') { <aiia-state kind="error" [message]="alerts.message()" actionLabel="Thử lại" (action)="reload()" /> }
          @default {
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Mức</th><th>Loại</th><th>Đối tượng</th><th class="num">Quan sát</th><th>Dải kỳ vọng</th><th>Phát hiện</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  @for (a of alerts.data?.items ?? []; track a.id) {
                    <tr class="clickable" [class.selected]="a.id === selectedId()" tabindex="0" (click)="open(a)" (keydown.enter)="open(a)">
                      <td><span class="chip" [class]="'chip ' + tone(a.severity)">{{ a.severity }}</span></td>
                      <td>{{ kindLabel(a.kind) }}</td>
                      <td><span class="small muted">{{ a.target?.type === 'METRIC' ? 'Metric' : 'Dataset' }}</span> {{ a.target?.name }}</td>
                      <td class="num">{{ fmt(a.observedValue) }}</td>
                      <td class="small">{{ fmt(a.expectedLow) }} – {{ fmt(a.expectedHigh) }}</td>
                      <td>{{ a.detectedAt | relTime }}</td>
                      <td><aiia-status [status]="a.status" /></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7"><aiia-state message="Không có cảnh báo" detail="Mọi chỉ số đang trong dải kỳ vọng." /></td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (alerts.data; as p) {
              <aiia-pager [page]="page()" [pageSize]="20" [total]="p.total" (pageChange)="page.set($event); reload()" />
            }
          }
        }
      </section>

      @if (selectedId()) {
        <aiia-drawer [title]="detail() ? kindLabel(detail()!.kind) + ' · ' + detail()!.target?.name : 'Cảnh báo'" [wide]="true" (closed)="close()">
          @if (detail(); as d) {
            <div class="stack">
              <div class="row">
                <span class="chip" [class]="'chip ' + tone(d.severity)">{{ d.severity }}</span>
                <aiia-status [status]="d.status" />
                <span class="small muted">Phát hiện {{ d.detectedAt | viDate: true }}</span>
              </div>
              <p style="margin: 0">
                Giá trị quan sát <strong>{{ fmt(d.observedValue) }}</strong> nằm ngoài dải kỳ vọng {{ fmt(d.expectedLow) }} – {{ fmt(d.expectedHigh) }}.
              </p>
              @if (chart(); as c) {
                <aiia-chart [data]="c" [height]="280" ariaLabel="Chuỗi giá trị và dải kỳ vọng" />
              }
              <div class="row small">
                @if (d.target?.type === 'DATASET') {
                  <a [routerLink]="['/catalog/datasets', d.target?.id]">Mở dataset</a>
                  <a [routerLink]="['/lineage']" [queryParams]="{ nodeType: 'DATASET', refId: d.target?.id }">Ảnh hưởng (lineage)</a>
                } @else {
                  <a routerLink="/semantic" [queryParams]="{ metric: d.target?.id }">Mở metric</a>
                  <a [routerLink]="['/lineage']" [queryParams]="{ nodeType: 'METRIC', refId: d.target?.id }">Dashboard bị ảnh hưởng</a>
                }
                @if (d.runId) {
                  <a [routerLink]="['/runs', d.runId]">Lần chạy liên quan</a>
                }
              </div>
              @if (d.acknowledgedBy) {
                <div class="small">Ghi nhận bởi {{ d.acknowledgedBy.fullName }}</div>
              }
              @if (d.note) {
                <div class="banner info small">{{ d.note }}</div>
              }
              @if (transitions(d.status).length) {
                <label class="field"><span class="small muted">Ghi chú (tùy chọn)</span><textarea class="input" [(ngModel)]="note" placeholder="VD: Đầu học kỳ nên số đăng ký tăng đột biến"></textarea></label>
                <div class="row">
                  <span class="spacer"></span>
                  @for (t of transitions(d.status); track t[0]) {
                    <button type="button" class="btn" [class.primary]="t[0] !== 'DISMISSED'" (click)="transition(d, t[0])">{{ t[1] }}</button>
                  }
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
    `,
  ],
})
export class AlertsPage {
  readonly alert = input<string | undefined>();

  private readonly api = inject(OpsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly kinds = Object.entries(KIND_LABELS);
  protected readonly alerts = loader<Page<Alert>>();
  protected readonly page = signal(1);
  protected readonly detail = signal<AlertDetail | null>(null);
  protected readonly detailError = signal<string | null>(null);
  protected readonly selectedId = computed(() => (this.alert() ? Number(this.alert()) : null));
  protected readonly chart = computed<ChartData | null>(() => {
    const s = this.detail()?.series ?? [];
    if (!s.length) return null;
    return {
      type: 'LINE',
      categories: s.map((p) => (p.at ?? '').slice(5, 10)),
      series: [{ name: 'Giá trị', values: s.map((p) => p.value ?? null) }],
      band: { low: s.map((p) => p.low ?? null), high: s.map((p) => p.high ?? null) },
      marks: s.flatMap((p, i) => (p.anomalous ? [i] : [])),
    };
  });
  kind = '';
  status = 'OPEN';
  note = '';

  constructor() {
    this.reload();
    effect(() => {
      const id = this.selectedId();
      untracked(() => this.loadDetail(id));
    });
  }

  reload(): void {
    this.alerts.load(this.api.alerts({ kind: this.kind || undefined, status: this.status || undefined, page: this.page(), pageSize: 20 }), true);
  }

  private loadDetail(id: number | null): void {
    this.detail.set(null);
    this.detailError.set(null);
    this.note = '';
    if (!id) return;
    this.api.alert(id).subscribe({ next: (d) => this.detail.set(d), error: (e: unknown) => this.detailError.set(problemMessage(toProblem(e))) });
  }

  open(a: Alert): void {
    void this.router.navigate([], { queryParams: { alert: a.id }, queryParamsHandling: 'merge' });
  }

  close(): void {
    void this.router.navigate([], { queryParams: { alert: null }, queryParamsHandling: 'merge' });
  }

  kindLabel(k: string | undefined): string {
    return KIND_LABELS[k ?? ''] ?? k ?? '';
  }

  tone(s: string | undefined): string {
    return SEVERITY_TONE[s ?? ''] ?? 'neutral';
  }

  transitions(s: string | undefined) {
    return TRANSITIONS[s ?? ''] ?? [];
  }

  fmt(v: number | null | undefined): string {
    return v === null || v === undefined ? '—' : v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  }

  transition(a: AlertDetail, to: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED'): void {
    if (!a.id) return;
    this.api.transition(a.id, to, this.note.trim() || undefined).subscribe({
      next: (updated) => {
        this.detail.set({ ...a, ...updated });
        this.note = '';
        this.toast.success('Đã cập nhật cảnh báo');
        this.reload();
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }
}
