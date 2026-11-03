import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Dataset, LineageGraph, LineageNode } from '../../core/api/models';
import { CatalogApi, OpsApi } from '../../core/api/services';
import { problemMessage, toProblem } from '../../core/http/problem';
import { NODE_LABELS } from '../../core/util/labels';
import { PageHeaderComponent } from '../../shared/overlays';
import { StateViewComponent } from '../../shared/state-view';

const NODE_W = 190;
const NODE_H = 46;
const COL_GAP = 70;
const ROW_GAP = 16;
const COLORS: Record<string, string> = { SOURCE: '#5f3dc4', DATASET: '#1864ab', COLUMN: '#0b7285', METRIC: '#2b8a3e', DASHBOARD: '#e8590c' };

interface Placed {
  node: LineageNode;
  x: number;
  y: number;
  depth: number;
}

/** Xếp nút theo khoảng cách có dấu tới tâm: âm = phía trước, dương = phía sau. */
export function layoutLineage(g: LineageGraph): { placed: Placed[]; width: number; height: number } {
  const nodes = g.nodes ?? [];
  const edges = g.edges ?? [];
  const center = g.center?.id;
  const depth = new Map<number, number>();
  if (center !== undefined) depth.set(center, 0);
  const walk = (dir: 1 | -1) => {
    const queue = center !== undefined ? [center] : [];
    while (queue.length) {
      const id = queue.shift() as number;
      const d = depth.get(id) ?? 0;
      for (const e of edges) {
        const next = dir === 1 ? (e.from === id ? e.to : undefined) : e.to === id ? e.from : undefined;
        if (next === undefined || depth.has(next)) continue;
        depth.set(next, d + dir);
        queue.push(next);
      }
    }
  };
  walk(1);
  walk(-1);
  for (const n of nodes) if (n.id !== undefined && !depth.has(n.id)) depth.set(n.id, 0);
  const depths = [...new Set(depth.values())].sort((a, b) => a - b);
  const minD = depths[0] ?? 0;
  const columns = new Map<number, LineageNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id ?? -1) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }
  const maxRows = Math.max(1, ...[...columns.values()].map((c) => c.length));
  const height = maxRows * (NODE_H + ROW_GAP) + ROW_GAP;
  const placed: Placed[] = [];
  for (const [d, col] of columns) {
    const offset = (height - col.length * (NODE_H + ROW_GAP)) / 2;
    col.sort((a, b) => (a.type ?? '').localeCompare(b.type ?? '') || (a.name ?? '').localeCompare(b.name ?? ''));
    col.forEach((node, i) => placed.push({ node, depth: d, x: (d - minD) * (NODE_W + COL_GAP) + 10, y: offset + i * (NODE_H + ROW_GAP) + ROW_GAP / 2 }));
  }
  return { placed, width: depths.length * (NODE_W + COL_GAP) - COL_GAP + 20, height };
}

/** P22 — Lineage: đồ thị nguồn → dataset → metric → dashboard và phân tích ảnh hưởng (US21). */
@Component({
  selector: 'aiia-lineage-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, StateViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Lineage" [adv]="true" subtitle="Dữ liệu đi từ đâu tới đâu. Bấm một nút để đặt làm tâm; phân tích ảnh hưởng cho biết những gì sẽ bị tác động khi nút thay đổi." />
      <div class="card row filters">
        <label class="row small">Tâm
          <select class="input" aria-label="Chọn dataset làm tâm" [ngModel]="nodeType() === 'DATASET' ? refId() : ''" (ngModelChange)="center('DATASET', $event)">
            <option value="" disabled>— chọn dataset —</option>
            @for (d of datasets(); track d.id) {
              <option [value]="'' + d.id">{{ d.schemaName }}.{{ d.tableName }}</option>
            }
          </select>
        </label>
        <label class="row small">Hướng
          <select class="input" [ngModel]="dir()" (ngModelChange)="setParam('direction', $event)">
            <option value="BOTH">Hai chiều</option>
            <option value="UPSTREAM">Phía trước</option>
            <option value="DOWNSTREAM">Phía sau</option>
          </select>
        </label>
        <label class="row small">Độ sâu
          <select class="input" [ngModel]="dep()" (ngModelChange)="setParam('depth', $event)">
            @for (d of [1, 2, 3, 4]; track d) {
              <option [ngValue]="d">{{ d }}</option>
            }
          </select>
        </label>
        <span class="spacer"></span>
        <div class="legend small">
          @for (t of legend; track t[0]) {
            <span><i [style.background]="t[2]"></i>{{ t[1] }}</span>
          }
        </div>
      </div>

      @if (error()) {
        <aiia-state kind="error" [message]="error()!" />
      } @else if (!graph()) {
        <aiia-state kind="loading" />
      } @else {
        <div class="layout">
          <section class="card flush canvas" aria-label="Đồ thị lineage">
            <svg [attr.width]="layout().width" [attr.height]="layout().height" role="img" [attr.aria-label]="'Lineage của ' + graph()!.center?.name">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#adb5bd" />
                </marker>
              </defs>
              @for (e of paths(); track $index) {
                <path [attr.d]="e.d" fill="none" [attr.stroke]="e.hot ? '#1864ab' : '#ced4da'" [attr.stroke-width]="e.hot ? 2 : 1.5" marker-end="url(#arrow)">
                  @if (e.label) { <title>{{ e.label }}</title> }
                </path>
              }
              @for (p of layout().placed; track p.node.id) {
                <g class="node" [class.center]="p.node.id === graph()!.center?.id" [attr.transform]="'translate(' + p.x + ',' + p.y + ')'" tabindex="0" role="button" [attr.aria-label]="typeLabel(p.node.type) + ' ' + p.node.name" (click)="select(p.node)" (keydown.enter)="select(p.node)" (mouseenter)="hover.set(p.node.id ?? null)" (mouseleave)="hover.set(null)">
                  <rect [attr.width]="NODE_W" [attr.height]="NODE_H" rx="8" [attr.stroke]="color(p.node.type)" />
                  <rect width="5" [attr.height]="NODE_H" rx="2" [attr.fill]="color(p.node.type)" />
                  <text x="14" y="18" class="type">{{ typeLabel(p.node.type) }}{{ p.node.layer ? ' · ' + p.node.layer : '' }}</text>
                  <text x="14" y="35" class="name">{{ short(p.node.name) }}</text>
                  <title>{{ p.node.name }}</title>
                </g>
              }
            </svg>
          </section>

          <aside class="card side">
            @if (graph()!.center; as c) {
              <div class="small muted">{{ typeLabel(c.type) }}</div>
              <h2 class="mono" style="margin: 2px 0 8px; word-break: break-all">{{ c.name }}</h2>
              @if (c.type === 'DATASET') {
                <a class="btn sm" [routerLink]="['/catalog/datasets', c.refId]">Mở trong catalog</a>
              } @else if (c.type === 'DASHBOARD') {
                <a class="btn sm" [routerLink]="['/dashboards', c.refId]">Mở dashboard</a>
              } @else if (c.type === 'METRIC') {
                <a class="btn sm" routerLink="/semantic" [queryParams]="{ metric: c.refId }">Mở metric</a>
              }
              <h3>Phân tích ảnh hưởng</h3>
              @if (impact(); as list) {
                @if (list.length) {
                  <p class="small" style="margin: 0 0 6px">Thay đổi nút này ảnh hưởng tới <strong>{{ list.length }}</strong> đối tượng phía sau:</p>
                  <div class="row small" style="margin-bottom: 8px">
                    @for (g of impactGroups(); track g[0]) {
                      <span class="chip neutral">{{ typeLabel(g[0]) }}: {{ g[1] }}</span>
                    }
                  </div>
                  <ul class="impact">
                    @for (n of list; track n.id) {
                      <li><button type="button" class="link-btn" (click)="select(n)"><i [style.background]="color(n.type)"></i>{{ n.name }}</button></li>
                    }
                  </ul>
                } @else {
                  <p class="small muted">Không có đối tượng phụ thuộc phía sau.</p>
                }
              } @else {
                <aiia-state kind="loading" />
              }
            }
          </aside>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .filters {
        margin-bottom: 16px;
      }
      .legend {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .legend i,
      .impact i {
        display: inline-block;
        width: 10px;
        height: 10px;
        margin-right: 4px;
        border-radius: 2px;
        vertical-align: middle;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 300px;
        gap: 16px;
      }
      @media (max-width: 1000px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
      .canvas {
        overflow: auto;
        padding: 12px;
        max-height: calc(100vh - 230px);
      }
      .node {
        cursor: pointer;
        outline: none;
      }
      .node rect:first-child {
        fill: var(--color-surface);
        stroke-width: 1.5;
      }
      .node:hover rect:first-child,
      .node:focus rect:first-child {
        fill: var(--color-accent-soft);
      }
      .node.center rect:first-child {
        stroke-width: 3;
        fill: var(--color-accent-soft);
      }
      .type {
        font-size: 10px;
        fill: var(--color-muted);
      }
      .name {
        font-size: 12px;
        font-weight: 600;
        fill: currentColor;
      }
      .impact {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 50vh;
        overflow-y: auto;
      }
      .impact li {
        padding: 3px 0;
      }
    `,
  ],
})
export class LineagePage {
  readonly nodeType = input<string | undefined>();
  readonly refId = input<string | undefined>();
  readonly direction = input<string | undefined>();
  readonly depth = input<string | undefined>();

  private readonly ops = inject(OpsApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);
  protected readonly NODE_W = NODE_W;
  protected readonly NODE_H = NODE_H;
  protected readonly legend = Object.entries(NODE_LABELS)
    .filter(([k]) => k !== 'COLUMN')
    .map(([k, v]) => [k, v, COLORS[k]] as const);
  protected readonly datasets = signal<Dataset[]>([]);
  protected readonly graph = signal<LineageGraph | null>(null);
  protected readonly impact = signal<LineageNode[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly hover = signal<number | null>(null);
  protected readonly dir = computed(() => this.direction() ?? 'BOTH');
  protected readonly dep = computed(() => Number(this.depth() ?? 2) || 2);
  protected readonly layout = computed(() => layoutLineage(this.graph() ?? {}));
  protected readonly paths = computed(() => {
    const pos = new Map(this.layout().placed.map((p) => [p.node.id, p]));
    const focus = this.hover() ?? this.graph()?.center?.id;
    return (this.graph()?.edges ?? []).flatMap((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return [];
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      return [{ d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 2},${y2}`, hot: e.from === focus || e.to === focus, label: e.transformRef ?? '' }];
    });
  });
  protected readonly impactGroups = computed(() => {
    const counts = new Map<string, number>();
    for (const n of this.impact() ?? []) counts.set(n.type ?? '', (counts.get(n.type ?? '') ?? 0) + 1);
    return [...counts.entries()];
  });

  constructor() {
    this.catalog.datasets({ pageSize: 100 }).subscribe((p) => {
      this.datasets.set(p.items);
      if (!this.refId()) {
        const mart = p.items.find((d) => d.tableName === 'mart_student_term_kpi') ?? p.items[0];
        if (mart) this.center('DATASET', String(mart.id), true);
      }
    });
    effect(() => {
      const type = this.nodeType();
      const ref = this.refId();
      const direction = this.dir();
      const depth = this.dep();
      if (!type || !ref) return;
      untracked(() => this.load(type, ref, direction, depth));
    });
  }

  private load(nodeType: string, refId: string, direction: string, depth: number): void {
    this.error.set(null);
    this.impact.set(null);
    this.ops.lineage({ nodeType, refId, direction, depth }).subscribe({
      next: (g) => this.graph.set(g),
      error: (e: unknown) => this.error.set(problemMessage(toProblem(e))),
    });
    this.ops.impact(nodeType, refId).subscribe({ next: (list) => this.impact.set(list), error: () => this.impact.set([]) });
  }

  center(nodeType: string, refId: string, replaceUrl = false): void {
    void this.router.navigate([], { queryParams: { nodeType, refId }, queryParamsHandling: 'merge', replaceUrl });
  }

  setParam(key: 'direction' | 'depth', value: string | number): void {
    void this.router.navigate([], { queryParams: { [key]: value }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  select(n: LineageNode): void {
    if (n.type && n.refId) this.center(n.type, n.refId);
  }

  color(type: string | undefined): string {
    return COLORS[type ?? ''] ?? '#868e96';
  }

  typeLabel(type: string | undefined): string {
    return NODE_LABELS[type ?? ''] ?? type ?? '';
  }

  short(name: string | undefined): string {
    const n = name ?? '';
    return n.length > 26 ? n.slice(0, 25) + '…' : n;
  }
}
