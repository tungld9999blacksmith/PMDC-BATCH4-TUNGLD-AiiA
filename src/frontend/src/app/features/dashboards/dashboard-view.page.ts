import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, filter, of, switchMap, take, timer } from 'rxjs';
import type { Dashboard, Filter, SemanticQuery, Widget } from '../../core/api/models';
import { DashboardsApi, ReportsApi, SemanticApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { ToastService } from '../../core/ui/toast.service';
import { TOPIC_LABELS } from '../../core/util/labels';
import { loader } from '../../shared/async';
import { FreshnessChipComponent, StatusBadgeComponent } from '../../shared/badges';
import { ModalComponent, PageHeaderComponent } from '../../shared/overlays';
import { StateViewComponent } from '../../shared/state-view';
import { DashboardWidgetComponent } from './dashboard-widget';
import { SemanticCatalog } from './semantic-catalog.service';

/** P08 — Xem dashboard (US27, US29): bộ lọc toàn cục đồng bộ URL, drill-down, export, đăng ký, hỏi AI. */
@Component({
  selector: 'aiia-dashboard-view-page',
  standalone: true,
  imports: [RouterLink, PageHeaderComponent, StateViewComponent, FreshnessChipComponent, StatusBadgeComponent, DashboardWidgetComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-view.page.html',
  styleUrl: './dashboard-view.page.css',
})
export class DashboardViewPage {
  readonly id = input.required<string>();
  readonly spec = input<string | undefined>();

  private readonly api = inject(DashboardsApi);
  private readonly semantic = inject(SemanticApi);
  private readonly reports = inject(ReportsApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly session = inject(SessionService);
  protected readonly catalog = inject(SemanticCatalog);

  protected readonly board = loader<Dashboard>();
  protected readonly options = signal<Record<string, string[]>>({});
  protected readonly drill = signal<Record<number, string[]>>({});
  protected readonly exportOpen = signal(false);
  protected readonly subscribeOpen = signal(false);
  protected readonly exporting = signal(false);
  protected readonly cron = signal('0 7 * * MON');
  protected readonly includeAi = signal(true);
  protected readonly topicLabels = TOPIC_LABELS;
  protected readonly watermark = signal('');

  private readonly queryParams = toSignal(this.route.queryParamMap);
  protected readonly isExplore = computed(() => this.id() === 'explore');
  protected readonly selected = computed<Record<string, string>>(() => {
    const params = this.queryParams();
    const out: Record<string, string> = {};
    for (const dim of this.board.state().data?.globalFilters ?? []) {
      const v = params?.get(dim);
      if (v) out[dim] = v;
    }
    return out;
  });
  protected readonly filters = computed<Filter[]>(() => Object.entries(this.selected()).map(([dimension, value]) => ({ dimension, op: 'eq' as const, value })));
  protected readonly widgets = computed(() => [...(this.board.state().data?.widgets ?? [])].sort((a, b) => (a.position.y ?? 0) - (b.position.y ?? 0) || (a.position.x ?? 0) - (b.position.x ?? 0)));
  protected readonly canExport = computed(() => this.session.hasAnyRole('REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD') && !this.isExplore());
  protected readonly canAsk = computed(() => this.session.hasAnyRole('REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD'));
  protected readonly canLineage = computed(() => this.session.hasAnyRole('PLATFORM_ADMIN', 'DATA_ENGINEER', 'DATA_STEWARD', 'BI_ANALYST'));

  constructor() {
    effect(() => {
      const id = this.id();
      const spec = this.spec();
      untracked(() => {
        this.drill.set({});
        if (id === 'explore') this.board.set(exploreBoard(spec));
        else this.board.load(this.api.get(Number(id)));
      });
    });
    effect(() => {
      const d = this.board.state().data;
      if (d) untracked(() => this.loadOptions(d));
    });
  }

  /** Giá trị bộ lọc lấy từ chính Semantic API nên chỉ gồm giá trị trong phạm vi quyền. */
  private loadOptions(d: Dashboard): void {
    const metric = d.widgets?.[0]?.querySpec.metrics[0];
    if (!metric) return;
    for (const dim of d.globalFilters ?? []) {
      this.semantic
        .query({ metrics: [metric], dimensions: [dim], limit: 200 })
        .pipe(catchError(() => of(null)))
        .subscribe((r) => {
          if (r) this.options.update((o) => ({ ...o, [dim]: (r.rows ?? []).map((row) => String(row[0])) }));
        });
    }
  }

  setFilter(dim: string, value: string): void {
    this.drill.set({});
    void this.router.navigate([], { queryParams: { [dim]: value || null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  resetFilters(): void {
    this.drill.set({});
    const cleared = Object.fromEntries((this.board.state().data?.globalFilters ?? []).map((d) => [d, null]));
    void this.router.navigate([], { queryParams: cleared, queryParamsHandling: 'merge', replaceUrl: true });
  }

  drillDown(w: Widget, value: string): void {
    if (w.id === undefined) return;
    const id = w.id;
    this.drill.update((d) => ({ ...d, [id]: [...(d[id] ?? []), value] }));
  }

  drillTo(w: Widget, level: number): void {
    if (w.id === undefined) return;
    const id = w.id;
    this.drill.update((d) => ({ ...d, [id]: (d[id] ?? []).slice(0, level) }));
  }

  gridArea(w: Widget): string {
    const p = w.position;
    return `${(p.y ?? 0) + 1} / ${(p.x ?? 0) + 1} / span ${p.h ?? 1} / span ${p.w ?? 12}`;
  }

  toggleFavorite(d: Dashboard): void {
    if (!d.id) return;
    const on = !d.favorite;
    this.api.favorite(d.id, on).subscribe(() => this.board.set({ ...d, favorite: on }));
  }

  copyLink(): void {
    void navigator.clipboard?.writeText(window.location.href).then(
      () => this.toast.success('Đã sao chép liên kết (giữ nguyên bộ lọc)'),
      () => this.toast.info(window.location.href),
    );
  }

  /** PDF: ghi nhận export (audit) rồi mở hộp thoại in với watermark (BR13). */
  exportPdf(d: Dashboard): void {
    if (!d.id) return;
    this.exporting.set(true);
    this.api.export(d.id, 'PDF', undefined, this.filters()).subscribe({
      next: (job) => {
        this.exporting.set(false);
        this.exportOpen.set(false);
        this.watermark.set(job.watermark ?? '');
        setTimeout(() => window.print(), 50);
      },
      error: (e: unknown) => {
        this.exporting.set(false);
        this.toast.error(problemMessage(toProblem(e)));
      },
    });
  }

  exportCsv(d: Dashboard, w: Widget): void {
    if (!d.id || w.id === undefined) return;
    this.exporting.set(true);
    this.api
      .export(d.id, 'CSV', w.id, this.filters())
      .pipe(
        switchMap((job) => timer(600, 600).pipe(switchMap(() => this.api.exportStatus(job.id ?? '')), filter((j) => j.status !== 'PENDING'), take(1))),
      )
      .subscribe({
        next: (job) => {
          this.exporting.set(false);
          this.exportOpen.set(false);
          if (job.status === 'READY' && job.downloadUrl) {
            const a = document.createElement('a');
            a.href = job.downloadUrl;
            a.download = `${(d.title ?? 'dashboard').replace(/\s+/g, '_')}-${w.id}.csv`;
            a.click();
            this.toast.success(`Đã xuất CSV — watermark: ${job.watermark}`);
          } else {
            this.toast.error('Xuất file thất bại');
          }
        },
        error: (e: unknown) => {
          this.exporting.set(false);
          this.toast.error(problemMessage(toProblem(e)));
        },
      });
  }

  subscribe(d: Dashboard): void {
    if (!d.id) return;
    this.reports.create({ dashboardId: d.id, cron: this.cron(), format: 'PDF', includeAiSummary: this.includeAi(), filters: this.filters() }).subscribe({
      next: () => {
        this.subscribeOpen.set(false);
        this.toast.success('Đã đăng ký nhận báo cáo định kỳ');
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  askAbout(d: Dashboard): void {
    void this.router.navigate(['/assistant'], { queryParams: { dashboardId: d.id } });
  }
}

/** Dashboard tạm cho chế độ “Mở trong dashboard” từ câu trả lời của trợ lý. */
function exploreBoard(spec: string | undefined): Dashboard {
  let query: SemanticQuery = { metrics: [] };
  try {
    query = JSON.parse(decodeURIComponent(spec ?? '')) as SemanticQuery;
  } catch {
    /* spec không hợp lệ → dashboard rỗng */
  }
  const dim = query.dimensions?.[0];
  const type: Widget['type'] = !dim ? 'KPI' : ['term', 'academic_year', 'year', 'date'].includes(dim) ? 'LINE' : 'BAR';
  return {
    id: 0,
    title: 'Khám phá từ trợ lý',
    description: 'Truy vấn do trợ lý đề xuất, chạy lại dưới quyền của bạn.',
    topic: 'TRAINING',
    status: 'DRAFT',
    globalFilters: [],
    version: 0,
    canEdit: false,
    widgets: query.metrics.length
      ? [
          { id: 1, type, title: 'Kết quả', querySpec: query, position: { x: 0, y: 0, w: 12, h: 3 } },
          { id: 2, type: 'TABLE', title: 'Bảng số liệu', querySpec: query, position: { x: 0, y: 3, w: 12, h: 2 } },
        ]
      : [],
  };
}
