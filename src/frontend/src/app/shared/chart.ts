import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { QueryResult } from '../core/api/models';
import { isSuppressed } from '../core/api/models';
import { formatNumber } from './pipes';

export type ChartType = 'BAR' | 'LINE' | 'PIE' | 'HEATMAP';

export interface ChartData {
  type: ChartType;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
  unit?: string | null;
  /** HEATMAP: nhãn trục dọc và ô [x, y, giá trị]. */
  yCategories?: string[];
  cells?: [number, number, number | null][];
  /** Dải kỳ vọng (cảnh báo bất thường). */
  band?: { low: (number | null)[]; high: (number | null)[] };
  /** Điểm cần làm nổi bật (bất thường). */
  marks?: number[];
}

const PALETTE = ['#1864ab', '#2b8a3e', '#e8590c', '#5f3dc4', '#0b7285', '#a61e4d'];

/** Chuyển QueryResult của Semantic API thành dữ liệu biểu đồ; ô bị ẩn → null. */
export function toChartData(result: QueryResult, type: ChartType, labelOf: (dim: string, value: string) => string = (_, v) => v, metricName: (code: string) => string = (c) => c): ChartData {
  const columns = result.columns ?? [];
  const rows = result.rows ?? [];
  const dims = columns.map((c, i) => ({ ...c, i })).filter((c) => c.kind === 'DIMENSION');
  const metrics = columns.map((c, i) => ({ ...c, i })).filter((c) => c.kind === 'METRIC');
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  if (type === 'HEATMAP' && dims.length >= 2) {
    const xs = [...new Set(rows.map((r) => String(r[dims[0].i])))];
    const ys = [...new Set(rows.map((r) => String(r[dims[1].i])))];
    return {
      type,
      categories: xs.map((x) => labelOf(dims[0].name ?? '', x)),
      yCategories: ys.map((y) => labelOf(dims[1].name ?? '', y)),
      cells: rows.map((r) => [xs.indexOf(String(r[dims[0].i])), ys.indexOf(String(r[dims[1].i])), num(r[metrics[0].i])]),
      series: [],
      unit: metrics[0]?.unit,
    };
  }
  const dim = dims[0];
  return {
    type,
    categories: rows.map((r) => (dim ? labelOf(dim.name ?? '', String(r[dim.i])) : '')),
    series: metrics.map((m) => ({ name: metricName(m.name ?? ''), values: rows.map((r) => num(r[m.i])) })),
    unit: metrics[0]?.unit,
  };
}

/**
 * Biểu đồ ECharts (nạp lười để không tăng bundle ban đầu). Luôn có chế độ “Xem bảng”
 * làm phương án thay thế cho trình đọc màn hình (docs/04 §6.4).
 */
@Component({
  selector: 'aiia-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row between toolbar">
      <span class="small muted">
        @if (suppressed()) {
          {{ suppressed() }} ô nhóm dưới 5 người đã ẩn
        }
      </span>
      <button type="button" class="link-btn small" (click)="asTable.set(!asTable())" [attr.aria-pressed]="asTable()">
        {{ asTable() ? 'Xem biểu đồ' : 'Xem bảng' }}
      </button>
    </div>
    @if (asTable()) {
      <div class="table-wrap" [style.maxHeight.px]="height()">
        <table class="table">
          <caption class="sr-only">{{ ariaLabel() }}</caption>
          <thead>
            <tr>
              <th scope="col"></th>
              @for (s of data().series; track s.name) {
                <th scope="col">{{ s.name }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (c of data().categories; track $index; let i = $index) {
              <tr>
                <th scope="row">{{ c }}</th>
                @for (s of data().series; track s.name) {
                  <td class="num">{{ fmt(s.values[i]) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div #host class="host" [style.height.px]="height()" role="img" [attr.aria-label]="ariaLabel()"></div>
    }
  `,
  styles: [
    `
      .toolbar {
        min-height: 20px;
      }
      .host {
        width: 100%;
      }
    `,
  ],
})
export class ChartComponent {
  readonly data = input.required<ChartData>();
  readonly height = input(260);
  readonly ariaLabel = input('Biểu đồ');
  readonly suppressed = input(0);
  readonly pointClick = output<number>();

  protected readonly asTable = signal(false);
  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
  private chart: { setOption: (o: unknown, notMerge?: boolean) => void; resize: () => void; dispose: () => void; on: (e: string, cb: (p: { dataIndex: number }) => void) => void } | null = null;
  private observer: ResizeObserver | null = null;
  private readonly option = computed(() => buildOption(this.data()));

  constructor() {
    afterRenderEffect(() => {
      const el = this.host()?.nativeElement;
      const option = this.option();
      if (!el) {
        this.dispose();
        return;
      }
      void import('echarts').then((echarts) => {
        if (!this.chart) {
          this.chart = echarts.init(el) as unknown as NonNullable<ChartComponent['chart']>;
          this.chart.on('click', (p) => this.pointClick.emit(p.dataIndex));
          this.observer = new ResizeObserver(() => this.chart?.resize());
          this.observer.observe(el);
        }
        this.chart.setOption(option, true);
      });
    });
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  fmt(v: number | null): string {
    return v === null ? '< 5' : formatNumber(v, this.data().unit);
  }

  private dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.chart?.dispose();
    this.chart = null;
  }
}

function buildOption(d: ChartData): Record<string, unknown> {
  const valueFmt = (v: number) => formatNumber(v, d.unit);
  const base = { color: PALETTE, textStyle: { fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif' }, grid: { left: 48, right: 16, top: 24, bottom: 48, containLabel: true }, tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v === null || v === undefined ? '< 5' : valueFmt(v)) } };
  if (d.type === 'PIE') {
    return {
      ...base,
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, type: 'scroll' },
      series: [{ type: 'pie', radius: ['40%', '68%'], data: d.categories.map((c, i) => ({ name: c, value: d.series[0]?.values[i] ?? 0 })), label: { formatter: '{b}: {c}' } }],
    };
  }
  if (d.type === 'HEATMAP') {
    const values = (d.cells ?? []).map((c) => c[2]).filter((v): v is number => v !== null);
    return {
      ...base,
      tooltip: { position: 'top' },
      grid: { left: 8, right: 16, top: 8, bottom: 64, containLabel: true },
      xAxis: { type: 'category', data: d.categories, axisLabel: { rotate: 30, fontSize: 11 } },
      yAxis: { type: 'category', data: d.yCategories },
      visualMap: { min: Math.min(...values, 90), max: Math.max(...values, 100), calculable: true, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#fde2e1', '#fff3bf', '#b2f2bb', '#2b8a3e'] } },
      series: [{ type: 'heatmap', data: (d.cells ?? []).map((c) => [c[0], c[1], c[2] ?? '-']), label: { show: true, fontSize: 11 } }],
    };
  }
  const series: Record<string, unknown>[] = d.series.map((s) => ({
    name: s.name,
    type: d.type === 'LINE' ? 'line' : 'bar',
    data: s.values,
    smooth: d.type === 'LINE',
    connectNulls: false,
    barMaxWidth: 36,
    markPoint: d.marks?.length ? { data: d.marks.map((i) => ({ coord: [i, s.values[i]], value: '!', itemStyle: { color: '#e03131' } })) } : undefined,
  }));
  if (d.band) {
    series.unshift(
      { name: 'Ngưỡng dưới', type: 'line', data: d.band.low, lineStyle: { opacity: 0 }, stack: 'band', symbol: 'none', tooltip: { show: false } },
      { name: 'Dải kỳ vọng', type: 'line', data: d.band.high.map((h, i) => (h === null || d.band!.low[i] === null ? null : h - (d.band!.low[i] as number))), lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(24,100,171,0.12)' }, stack: 'band', symbol: 'none' },
    );
  }
  return {
    ...base,
    legend: d.series.length > 1 || d.band ? { bottom: 0 } : undefined,
    xAxis: { type: 'category', data: d.categories, axisLabel: { interval: 0, rotate: d.categories.length > 6 ? 30 : 0, fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => valueFmt(v) } },
    series,
  };
}
