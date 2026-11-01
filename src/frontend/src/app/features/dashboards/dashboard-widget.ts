import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, untracked } from '@angular/core';
import type { Filter, QueryResult, SemanticQuery, TabularResult, Widget } from '../../core/api/models';
import { isSuppressed } from '../../core/api/models';
import { SemanticApi } from '../../core/api/services';
import { loader } from '../../shared/async';
import { ChartComponent, toChartData, type ChartType } from '../../shared/chart';
import { DataTableComponent } from '../../shared/data-table';
import { formatCell } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';
import { SemanticCatalog } from './semantic-catalog.service';

/** Áp drill-down: cấp i dùng drillPath[i] làm dimension và lọc theo các giá trị đã chọn ở cấp trước. */
export function effectiveQuery(widget: Widget, globalFilters: Filter[], drill: string[]): SemanticQuery {
  const spec = widget.querySpec;
  const path = spec.drillPath ?? [];
  const filters = [...(spec.filters ?? []), ...globalFilters];
  let dimensions = spec.dimensions ?? [];
  if (path.length && drill.length) {
    drill.forEach((value, i) => filters.push({ dimension: path[i], op: 'eq', value }));
    const next = path[Math.min(drill.length, path.length - 1)];
    dimensions = drill.length >= path.length ? dimensions : [next];
  }
  return { metrics: spec.metrics, dimensions, filters, orderBy: spec.orderBy, limit: spec.limit ?? 500 };
}

/** Một widget dashboard: tự chạy truy vấn ngữ nghĩa dưới quyền người xem (BR11). */
@Component({
  selector: 'aiia-widget',
  standalone: true,
  imports: [ChartComponent, DataTableComponent, StateViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget card">
      <header class="row between">
        <h3>{{ widget().title }}</h3>
        <ng-content />
      </header>
      @if (crumbs().length) {
        <nav class="small crumbs" aria-label="Cấp drill-down">
          <button type="button" class="link-btn" (click)="drillTo.emit(0)">Tất cả</button>
          @for (c of crumbs(); track $index; let i = $index) {
            <span aria-hidden="true">›</span>
            <button type="button" class="link-btn" (click)="drillTo.emit(i + 1)">{{ c }}</button>
          }
        </nav>
      }
      @switch (result.state().status) {
        @case ('loading') {
          <aiia-state kind="loading" />
        }
        @case ('error') {
          <aiia-state kind="error" [message]="result.message()" actionLabel="Thử lại" (action)="run()" />
        }
        @case ('ready') {
          @if (result.state().data; as r) {
            @if (widget().type === 'KPI') {
              <div class="kpi-value" [class.muted]="kpiSuppressed()">{{ kpiText() }}</div>
              @if (kpiSuppressed()) {
                <div class="small muted">Nhóm dưới 5 người được ẩn</div>
              }
            } @else if (widget().type === 'TABLE') {
              <aiia-table [data]="table()" [caption]="widget().title" maxHeight="320px" />
            } @else {
              <aiia-chart [data]="chart()" [height]="chartHeight()" [ariaLabel]="widget().title" [suppressed]="r.suppressedCells ?? 0" (pointClick)="onPoint($event)" />
              @if (canDrill()) {
                <div class="small muted">Nhấn vào cột để xem chi tiết cấp tiếp theo.</div>
              }
            }
          }
        }
      }
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .widget {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .kpi-value {
        font-size: 30px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .crumbs {
        display: flex;
        gap: 6px;
        align-items: center;
      }
    `,
  ],
})
export class DashboardWidgetComponent {
  readonly widget = input.required<Widget>();
  readonly filters = input<Filter[]>([]);
  readonly drill = input<string[]>([]);
  readonly drillDown = output<string>();
  readonly drillTo = output<number>();

  private readonly api = inject(SemanticApi);
  protected readonly catalog = inject(SemanticCatalog);
  protected readonly result = loader<QueryResult>();
  private readonly query = computed(() => effectiveQuery(this.widget(), this.filters(), this.drill()));

  protected readonly crumbs = computed(() => {
    const path = this.widget().querySpec.drillPath ?? [];
    return this.drill().map((v, i) => this.catalog.valueLabel(path[i], v));
  });
  protected readonly canDrill = computed(() => {
    const path = this.widget().querySpec.drillPath ?? [];
    return this.widget().type === 'BAR' && path.length > 0 && this.drill().length < path.length - 1;
  });
  protected readonly chartHeight = computed(() => Math.max(180, (this.widget().position.h ?? 2) * 140 - 90));

  constructor() {
    effect(() => {
      this.query();
      untracked(() => this.run());
    });
  }

  run(): void {
    this.result.load(this.api.query(this.query()), true);
  }

  protected kpiSuppressed(): boolean {
    return isSuppressed(this.result.state().data?.rows?.[0]?.[0]);
  }

  protected kpiText(): string {
    const r = this.result.state().data;
    const code = this.widget().querySpec.metrics[0];
    return formatCell(r?.rows?.[0]?.[0], this.catalog.metricUnit(code));
  }

  protected chart() {
    return toChartData(
      this.result.state().data ?? {},
      this.widget().type as ChartType,
      (dim, v) => this.catalog.valueLabel(dim, v),
      (code) => this.catalog.metricName(code),
    );
  }

  protected table(): TabularResult {
    const r = this.result.state().data;
    const cols = r?.columns ?? [];
    return {
      columns: cols.map((c) => ({ name: c.kind === 'METRIC' ? this.catalog.metricName(c.name ?? '') : this.catalog.dimensionName(c.name ?? ''), type: c.kind === 'METRIC' ? 'decimal' : 'varchar' })),
      rows: (r?.rows ?? []).map((row) => row.map((v, i) => (cols[i]?.kind === 'DIMENSION' ? this.catalog.valueLabel(cols[i].name ?? '', String(v)) : v))),
    };
  }

  protected onPoint(index: number): void {
    if (!this.canDrill()) return;
    const r = this.result.state().data;
    const value = r?.rows?.[index]?.[0];
    if (value !== undefined) this.drillDown.emit(String(value));
  }
}
