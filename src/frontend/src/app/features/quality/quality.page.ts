import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Dataset, DqIssue, DqIssueStatus, DqScoreBoard, Page } from '../../core/api/models';
import { CatalogApi, IntegrationApi, QualityApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { DIMENSION_LABELS } from '../../core/util/labels';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { ChartComponent, type ChartData } from '../../shared/chart';
import { DrawerComponent, PageHeaderComponent, PagerComponent } from '../../shared/overlays';
import { RelTimePipe, ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

const DIMS = Object.keys(DIMENSION_LABELS);
const TRANSITIONS: Record<DqIssueStatus, [DqIssueStatus, string][]> = {
  OPEN: [
    ['IN_PROGRESS', 'Bắt đầu xử lý'],
    ['RESOLVED', 'Đánh dấu đã xử lý'],
    ['WONT_FIX', 'Không sửa'],
  ],
  IN_PROGRESS: [
    ['RESOLVED', 'Đánh dấu đã xử lý'],
    ['OPEN', 'Trả về Mở'],
    ['WONT_FIX', 'Không sửa'],
  ],
  RESOLVED: [['OPEN', 'Mở lại']],
  WONT_FIX: [['OPEN', 'Mở lại']],
};

/** P20 — Điểm chất lượng theo chiều và issue (US18, US19). */
@Component({
  selector: 'aiia-quality-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, PagerComponent, DrawerComponent, StateViewComponent, StatusBadgeComponent, ChartComponent, RelTimePipe, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Chất lượng & issue" subtitle="Điểm = tỉ lệ bản ghi đạt các quy tắc đang hoạt động, theo 5 chiều chất lượng.">
        <a class="btn" routerLink="/quality/rules">Quy tắc chất lượng</a>
      </aiia-page-header>

      @switch (scores.state().status) {
        @case ('loading') { <aiia-state kind="loading" /> }
        @case ('error') { <aiia-state kind="error" [message]="scores.message()" /> }
        @default {
          @if (scores.data; as s) {
            <div class="grid kpis">
              <div class="card kpi main-kpi">
                <div class="label">Điểm tổng</div>
                <div class="value" [class]="tone(s.overall)">{{ s.overall }}</div>
              </div>
              @for (d of dims; track d) {
                <div class="card kpi">
                  <div class="label">{{ dimLabel(d) }}</div>
                  <div class="value" [class]="tone(s.byDimension?.[d])">{{ s.byDimension?.[d] ?? '—' }}</div>
                </div>
              }
            </div>
            <div class="grid cols-2 charts">
              <section class="card">
                <div class="row between">
                  <h2 class="card-title">Điểm theo {{ groupBy() === 'source' ? 'nguồn' : 'dataset' }} × chiều</h2>
                  <div class="row small">
                    <button type="button" class="chip selectable" [class.on]="groupBy() === 'dataset'" (click)="setGroup('dataset')">Dataset</button>
                    <button type="button" class="chip selectable" [class.on]="groupBy() === 'source'" (click)="setGroup('source')">Nguồn</button>
                  </div>
                </div>
                @if (heatmap(); as h) {
                  <aiia-chart [data]="h" [height]="Math.max(220, (h.yCategories?.length ?? 0) * 34 + 80)" ariaLabel="Bản đồ nhiệt điểm chất lượng" />
                }
              </section>
              <section class="card">
                <h2 class="card-title">Xu hướng 30 ngày</h2>
                @if (trend(); as t) {
                  <aiia-chart [data]="t" [height]="260" ariaLabel="Xu hướng điểm chất lượng" />
                }
              </section>
            </div>
          }
        }
      }

      <section class="card flush">
        <div class="row issues-head">
          <h2 class="card-title" style="margin: 0">Issue</h2>
          <span class="spacer"></span>
          <select class="input" aria-label="Trạng thái issue" [(ngModel)]="status" (ngModelChange)="page.set(1); loadIssues()">
            <option value="">Mọi trạng thái</option>
            <option value="OPEN">Mở</option>
            <option value="IN_PROGRESS">Đang xử lý</option>
            <option value="RESOLVED">Đã xử lý</option>
            <option value="WONT_FIX">Không sửa</option>
          </select>
          <label class="row small"><input type="checkbox" [(ngModel)]="mine" (ngModelChange)="page.set(1); loadIssues()" /> Của tôi</label>
        </div>
        @switch (issues.state().status) {
          @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
          @case ('error') { <aiia-state kind="error" [message]="issues.message()" /> }
          @default {
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>#</th><th>Quy tắc</th><th>Dataset</th><th>Mức</th><th class="num">Dòng ảnh hưởng</th><th>Người xử lý</th><th>Tạo</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  @for (i of issues.data?.items ?? []; track i.id) {
                    <tr class="clickable" [class.selected]="i.id === selectedId()" tabindex="0" (click)="openIssue(i)" (keydown.enter)="openIssue(i)">
                      <td>{{ i.id }}</td>
                      <td>{{ i.rule?.description }}</td>
                      <td class="mono small">{{ datasetName(i.datasetId) }}</td>
                      <td><aiia-status [status]="i.severity" /></td>
                      <td class="num">{{ i.affectedRows }}</td>
                      <td>{{ i.assignee?.fullName ?? '—' }}</td>
                      <td>{{ i.createdAt | relTime }}</td>
                      <td><aiia-status [status]="i.status" /></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="8"><aiia-state message="Không có issue" detail="Dữ liệu đang đạt mọi quy tắc đang hoạt động." /></td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (issues.data; as p) {
              <aiia-pager [page]="page()" [pageSize]="20" [total]="p.total" (pageChange)="page.set($event); loadIssues()" />
            }
          }
        }
      </section>

      @if (selected(); as i) {
        <aiia-drawer [title]="'Issue #' + i.id" (closed)="closeIssue()">
          <div class="stack">
            <div class="row"><aiia-status [status]="i.status" /> <aiia-status [status]="i.severity" /></div>
            <div>
              <div><strong>{{ i.rule?.description }}</strong></div>
              <div class="small muted">{{ dimLabel(i.rule?.dimension) }} · <span class="mono">{{ datasetName(i.datasetId) }}</span> · {{ i.affectedRows }} dòng</div>
            </div>
            <div class="row small">
              <span class="muted">Lần chạy gần nhất:</span>
              <a [routerLink]="['/runs', i.lastRunId]" class="mono">{{ (i.lastRunId ?? '').slice(0, 8) }}</a>
              <a [routerLink]="['/catalog/datasets', i.datasetId]" [queryParams]="{ tab: 'quality' }">Mở dataset</a>
            </div>
            <div class="row small">
              <span class="muted">Người xử lý:</span> {{ i.assignee?.fullName ?? 'Chưa gán' }}
              @if (isSteward) {
                @if (i.assignee?.id !== myId()) {
                  <button type="button" class="link-btn small" (click)="assign(i, myId())">Nhận xử lý</button>
                } @else {
                  <button type="button" class="link-btn small" (click)="assign(i, null)">Bỏ nhận</button>
                }
              }
            </div>
            @if (isSteward) {
              <div class="row">
                @for (t of transitions(i.status); track t[0]) {
                  <button type="button" class="btn sm" (click)="transition(i, t[0])">{{ t[1] }}</button>
                }
              </div>
            }
            @if (i.severity === 'BLOCKING' && canReprocess && i.lastRunId) {
              <div class="banner info small">
                <div>
                  Sau khi nguồn đã sửa dữ liệu, xử lý lại các bản ghi đang cách ly để đưa vào Silver.
                  <div><button type="button" class="btn sm" style="margin-top: 6px" (click)="reprocess(i)">Xử lý lại bản ghi cách ly</button></div>
                </div>
              </div>
            }
            <h3 style="margin: 8px 0 0">Trao đổi</h3>
            @for (c of i.comments ?? []; track c.id) {
              <div class="comment">
                <div class="small"><strong>{{ c.author?.fullName }}</strong> <span class="muted">· {{ c.createdAt | viDate: true }}</span></div>
                <div>{{ c.body }}</div>
              </div>
            } @empty {
              <p class="small muted" style="margin: 0">Chưa có bình luận.</p>
            }
            <form class="stack" (ngSubmit)="comment(i)">
              <textarea class="input" name="comment" aria-label="Bình luận" placeholder="Ghi chú cho người xử lý…" [(ngModel)]="commentText"></textarea>
              <div class="row"><span class="spacer"></span><button type="submit" class="btn" [disabled]="!commentText.trim()">Gửi</button></div>
            </form>
          </div>
        </aiia-drawer>
      }
    </div>
  `,
  styles: [
    `
      .kpis {
        grid-template-columns: repeat(6, minmax(0, 1fr));
        margin-bottom: 16px;
      }
      @media (max-width: 900px) {
        .kpis {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      .main-kpi {
        border-left: 4px solid var(--color-accent);
      }
      .value.good {
        color: #2b8a3e;
      }
      .value.fair {
        color: #e8590c;
      }
      .value.bad {
        color: #c92a2a;
      }
      .charts {
        margin-bottom: 16px;
      }
      .issues-head {
        padding: 12px 16px;
      }
      .comment {
        padding: 8px 10px;
        border-radius: 6px;
        background: var(--color-bg);
      }
    `,
  ],
})
export class QualityPage {
  readonly issue = input<string | undefined>();

  private readonly api = inject(QualityApi);
  private readonly catalog = inject(CatalogApi);
  private readonly integration = inject(IntegrationApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  private readonly session = inject(SessionService);
  protected readonly isSteward = this.session.hasAnyRole('DATA_STEWARD');
  protected readonly canReprocess = this.session.hasAnyRole('DATA_ENGINEER');
  protected readonly myId = computed(() => this.session.me()?.id ?? null);
  protected readonly Math = Math;
  protected readonly dims = DIMS;
  protected readonly scores = loader<DqScoreBoard>();
  protected readonly issues = loader<Page<DqIssue>>();
  protected readonly datasets = signal<Dataset[]>([]);
  protected readonly groupBy = signal<'dataset' | 'source'>('dataset');
  protected readonly page = signal(1);
  protected readonly selected = signal<DqIssue | null>(null);
  protected readonly selectedId = computed(() => (this.issue() ? Number(this.issue()) : null));
  status = 'OPEN';
  mine = false;
  commentText = '';

  protected readonly heatmap = computed<ChartData | null>(() => {
    const rows = this.scores.state().data?.rows ?? [];
    if (!rows.length) return null;
    const cells: [number, number, number | null][] = [];
    rows.forEach((r, y) => DIMS.forEach((d, x) => cells.push([x, y, r.byDimension?.[d] ?? null])));
    return { type: 'HEATMAP', categories: DIMS.map((d) => DIMENSION_LABELS[d]), yCategories: rows.map((r) => r.key ?? ''), series: [], cells, unit: '%' };
  });

  protected readonly trend = computed<ChartData | null>(() => {
    const t = this.scores.state().data?.trend ?? [];
    if (!t.length) return null;
    return { type: 'LINE', categories: t.map((p) => (p.date ?? '').slice(5)), series: [{ name: 'Điểm chất lượng', values: t.map((p) => p.score ?? null) }], unit: '%' };
  });

  constructor() {
    this.loadScores();
    this.loadIssues();
    this.catalog.datasets({ pageSize: 100 }).subscribe((p) => this.datasets.set(p.items));
    effect(() => {
      const id = this.selectedId();
      untracked(() => {
        if (!id) {
          this.selected.set(null);
          return;
        }
        const found = this.issues.state().data?.items.find((i) => i.id === id);
        if (found) this.selected.set(found);
        else
          this.api.issues({ pageSize: 200 }).subscribe((p) => {
            const i = p.items.find((x) => x.id === id);
            this.selected.set(i ?? null);
            if (!i) this.toast.error('Không tìm thấy issue');
          });
      });
    });
  }

  private loadScores(): void {
    this.scores.load(this.api.scores({ groupBy: this.groupBy(), days: 30 }), true);
  }

  loadIssues(): void {
    this.issues.load(this.api.issues({ status: this.status || undefined, assignee: this.mine ? (this.myId() ?? undefined) : undefined, page: this.page(), pageSize: 20 }), true);
  }

  setGroup(g: 'dataset' | 'source'): void {
    this.groupBy.set(g);
    this.loadScores();
  }

  dimLabel(d: string | undefined): string {
    return DIMENSION_LABELS[d ?? ''] ?? d ?? '';
  }

  tone(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'value';
    return v >= 95 ? 'value good' : v >= 85 ? 'value fair' : 'value bad';
  }

  transitions(s: DqIssueStatus | undefined): [DqIssueStatus, string][] {
    return s ? TRANSITIONS[s] : [];
  }

  datasetName(id: number | undefined): string {
    const d = this.datasets().find((x) => x.id === id);
    return d ? `${d.schemaName}.${d.tableName}` : `#${id}`;
  }

  openIssue(i: DqIssue): void {
    this.selected.set(i);
    void this.router.navigate([], { queryParams: { issue: i.id }, queryParamsHandling: 'merge' });
  }

  closeIssue(): void {
    this.selected.set(null);
    void this.router.navigate([], { queryParams: { issue: null }, queryParamsHandling: 'merge' });
  }

  private patch(i: DqIssue, patch: { status?: DqIssueStatus; assigneeId?: string | null }, okText: string): void {
    if (!i.id) return;
    this.api.updateIssue(i.id, patch).subscribe({
      next: (updated) => {
        this.selected.set(updated);
        this.toast.success(okText);
        this.loadIssues();
        this.loadScores();
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  transition(i: DqIssue, to: DqIssueStatus): void {
    this.patch(i, { status: to }, 'Đã cập nhật trạng thái');
  }

  assign(i: DqIssue, userId: string | null): void {
    this.patch(i, { assigneeId: userId }, userId ? 'Bạn đang xử lý issue này' : 'Đã bỏ nhận');
  }

  comment(i: DqIssue): void {
    const text = this.commentText.trim();
    if (!i.id || !text) return;
    this.api.comment(i.id, text).subscribe({
      next: (c) => {
        this.commentText = '';
        this.selected.set({ ...i, comments: [...(i.comments ?? []), c] });
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  async reprocess(i: DqIssue): Promise<void> {
    if (!i.lastRunId) return;
    const ok = await this.dialogs.confirm({ title: 'Xử lý lại bản ghi cách ly', message: `Chạy lại kiểm tra chất lượng cho ${i.affectedRows} bản ghi đang cách ly của issue #${i.id}.`, confirmLabel: 'Xử lý lại' });
    if (!ok) return;
    this.integration.rerun(i.lastRunId, 'REPROCESS_QUARANTINE').subscribe({
      next: (run) => {
        this.toast.success('Đã đưa vào hàng đợi');
        void this.router.navigate(['/runs', run.id]);
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }
}
