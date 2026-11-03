import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Dashboard, DashboardInput, DashboardTopic, Metric, Share, Widget } from '../../core/api/models';
import { DashboardsApi } from '../../core/api/services';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { ROLE_LABELS, TOPIC_LABELS } from '../../core/util/labels';
import { StatusBadgeComponent } from '../../shared/badges';
import { ModalComponent, PageHeaderComponent } from '../../shared/overlays';
import { StateViewComponent } from '../../shared/state-view';
import { DashboardWidgetComponent } from './dashboard-widget';
import { SemanticCatalog } from './semantic-catalog.service';

const WIDGET_TYPES: Widget['type'][] = ['KPI', 'BAR', 'LINE', 'PIE', 'HEATMAP', 'TABLE'];
const TYPE_LABELS: Record<string, string> = { KPI: 'Chỉ số (KPI)', BAR: 'Cột', LINE: 'Đường', PIE: 'Tròn', HEATMAP: 'Bản đồ nhiệt', TABLE: 'Bảng' };

/** Xếp widget theo thứ tự vào lưới 12 cột, tính lại x, y (bố cục tự chảy). */
export function packLayout(widgets: Widget[]): Widget[] {
  let x = 0;
  let y = 0;
  let rowH = 0;
  return widgets.map((w) => {
    const width = Math.min(12, w.position.w ?? 6);
    const height = w.position.h ?? 2;
    if (x + width > 12) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const placed = { ...w, position: { x, y, w: width, h: height } };
    x += width;
    rowH = Math.max(rowH, height);
    return placed;
  });
}

/** P09 — Thiết kế dashboard (US28, US30). */
@Component({
  selector: 'aiia-dashboard-builder-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, StateViewComponent, StatusBadgeComponent, ModalComponent, DashboardWidgetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-builder.page.html',
  styleUrl: './dashboard-builder.page.css',
})
export class DashboardBuilderPage {
  readonly id = input<string | undefined>();

  private readonly api = inject(DashboardsApi);
  protected readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  protected readonly catalog = inject(SemanticCatalog);

  protected readonly status = signal<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  protected readonly errorText = signal('');
  protected readonly dashboardId = signal<number | null>(null);
  protected readonly version = signal(0);
  protected readonly state = signal<Dashboard['status']>('DRAFT');
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly topic = signal<DashboardTopic>('TRAINING');
  protected readonly globalFilters = signal<string[]>([]);
  protected readonly widgets = signal<Widget[]>([]);
  protected readonly shares = signal<Share[]>([]);
  protected readonly selected = signal<number | null>(null);
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly preview = signal(false);
  protected readonly shareOpen = signal(false);
  protected readonly metricQuery = signal('');
  private readonly undoStack = signal<Widget[][]>([]);
  private readonly redoStack = signal<Widget[][]>([]);
  private dragIndex: number | null = null;
  private nextTempId = -1;

  protected readonly types = WIDGET_TYPES;
  protected readonly typeLabels = TYPE_LABELS;
  protected readonly topics = Object.entries(TOPIC_LABELS) as [DashboardTopic, string][];
  protected readonly roleOptions = Object.entries(ROLE_LABELS);
  protected readonly unitOptions = [['CNTT', 'Khoa CNTT'], ['KT', 'Khoa Kinh tế'], ['NN', 'Khoa Ngoại ngữ'], ['PDT', 'Phòng Đào tạo'], ['TCCB', 'Phòng TCCB']];
  protected readonly widthOptions = [3, 4, 6, 8, 12];
  protected readonly canUndo = computed(() => this.undoStack().length > 0);
  protected readonly canRedo = computed(() => this.redoStack().length > 0);
  protected readonly current = computed(() => {
    const i = this.selected();
    return i === null ? null : (this.widgets()[i] ?? null);
  });
  protected readonly metricList = computed(() => {
    const q = this.metricQuery().toLowerCase();
    return this.catalog.metrics().filter((m) => m.status !== 'DEPRECATED' && (!q || `${m.name} ${m.code}`.toLowerCase().includes(q)));
  });
  /** Metric cùng dataset nền với metric đầu tiên của widget đang chọn. */
  protected readonly compatibleMetrics = computed(() => {
    const w = this.current();
    const first = this.metricOf(w?.querySpec.metrics[0]);
    return first ? this.catalog.metrics().filter((m) => m.baseDatasetId === first.baseDatasetId && m.status !== 'DEPRECATED') : [];
  });
  protected readonly allowedDims = computed(() => this.metricOf(this.current()?.querySpec.metrics[0])?.allowedDimensions ?? []);
  protected readonly boardDims = computed(() => this.metricOf(this.widgets()[0]?.querySpec.metrics[0])?.allowedDimensions ?? []);
  protected readonly previewWidgets = computed(() => packLayout(this.widgets()));

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => (id ? this.load(Number(id)) : this.status.set('ready')));
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) e.preventDefault();
  }

  @HostListener('document:keydown', ['$event'])
  shortcuts(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
    }
  }

  /** Dùng bởi guard canDeactivate. */
  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  private load(id: number): void {
    this.status.set('loading');
    this.api.get(id).subscribe({
      next: (d) => {
        if (!d.canEdit) {
          this.status.set('forbidden');
          return;
        }
        this.apply(d);
        this.status.set('ready');
      },
      error: (e: unknown) => {
        this.errorText.set(problemMessage(toProblem(e)));
        this.status.set('error');
      },
    });
  }

  private apply(d: Dashboard): void {
    this.dashboardId.set(d.id ?? null);
    this.version.set(d.version ?? 1);
    this.state.set(d.status);
    this.title.set(d.title ?? '');
    this.description.set(d.description ?? '');
    this.topic.set(d.topic ?? 'TRAINING');
    this.globalFilters.set(d.globalFilters ?? []);
    this.widgets.set([...(d.widgets ?? [])].sort((a, b) => (a.position.y ?? 0) - (b.position.y ?? 0) || (a.position.x ?? 0) - (b.position.x ?? 0)));
    this.shares.set(d.shares ?? []);
    this.dirty.set(false);
  }

  metricOf(code: string | undefined): Metric | undefined {
    return code ? this.catalog.metrics().find((m) => m.code === code) : undefined;
  }

  markDirty(): void {
    this.dirty.set(true);
  }

  /** Mọi thay đổi widget đi qua đây để có hoàn tác/làm lại. */
  private mutate(fn: (list: Widget[]) => Widget[]): void {
    this.undoStack.update((s) => [...s.slice(-49), structuredClone(this.widgets())]);
    this.redoStack.set([]);
    this.widgets.set(fn(structuredClone(this.widgets())));
    this.dirty.set(true);
  }

  undo(): void {
    const stack = this.undoStack();
    if (!stack.length) return;
    this.redoStack.update((s) => [...s, structuredClone(this.widgets())]);
    this.widgets.set(stack[stack.length - 1]);
    this.undoStack.set(stack.slice(0, -1));
    this.dirty.set(true);
  }

  redo(): void {
    const stack = this.redoStack();
    if (!stack.length) return;
    this.undoStack.update((s) => [...s, structuredClone(this.widgets())]);
    this.widgets.set(stack[stack.length - 1]);
    this.redoStack.set(stack.slice(0, -1));
    this.dirty.set(true);
  }

  addWidget(m: Metric): void {
    const widget: Widget = { id: this.nextTempId--, type: 'KPI', title: m.name ?? m.code ?? 'Widget', querySpec: { metrics: [m.code ?? ''], dimensions: [] }, position: { x: 0, y: 0, w: 3, h: 1 } };
    this.mutate((list) => [...list, widget]);
    this.selected.set(this.widgets().length - 1);
  }

  removeWidget(i: number): void {
    this.mutate((list) => list.filter((_, j) => j !== i));
    this.selected.set(null);
  }

  updateCurrent(patch: (w: Widget) => void): void {
    const i = this.selected();
    if (i === null) return;
    this.mutate((list) => {
      patch(list[i]);
      return list;
    });
  }

  setType(type: Widget['type']): void {
    this.updateCurrent((w) => {
      w.type = type;
      if (type === 'KPI') {
        w.querySpec.dimensions = [];
        w.position = { ...w.position, w: Math.min(w.position.w ?? 3, 4), h: 1 };
      } else {
        if (!w.querySpec.dimensions?.length && this.allowedDims().length) w.querySpec.dimensions = [this.allowedDims().includes('faculty') ? 'faculty' : this.allowedDims()[0]];
        if (type === 'HEATMAP' && (w.querySpec.dimensions ?? []).length < 2) w.querySpec.dimensions = this.allowedDims().slice(0, 2);
        w.position = { ...w.position, w: Math.max(w.position.w ?? 6, 6), h: Math.max(w.position.h ?? 2, 2) };
      }
    });
  }

  toggleMetric(code: string, on: boolean): void {
    this.updateCurrent((w) => {
      const set = new Set(w.querySpec.metrics);
      if (on) set.add(code);
      else if (set.size > 1) set.delete(code);
      w.querySpec.metrics = [...set];
    });
  }

  setDimension(index: number, dim: string): void {
    this.updateCurrent((w) => {
      const dims = [...(w.querySpec.dimensions ?? [])];
      if (dim) dims[index] = dim;
      else dims.splice(index, 1);
      w.querySpec.dimensions = dims.filter(Boolean);
    });
  }

  setDrillPath(text: string): void {
    const path = text.split(',').map((x) => x.trim()).filter((x) => this.allowedDims().includes(x));
    this.updateCurrent((w) => {
      w.querySpec.drillPath = path.length ? path : undefined;
      if (path.length) w.querySpec.dimensions = [path[0]];
    });
  }

  setSize(key: 'w' | 'h', value: number): void {
    this.updateCurrent((w) => (w.position = { ...w.position, [key]: Number(value) }));
  }

  setTitle(value: string): void {
    this.updateCurrent((w) => (w.title = value));
  }

  toggleGlobalFilter(dim: string, on: boolean): void {
    this.globalFilters.update((list) => (on ? [...new Set([...list, dim])] : list.filter((d) => d !== dim)));
    this.dirty.set(true);
  }

  // ── Kéo-thả sắp xếp ──
  onDragStart(i: number): void {
    this.dragIndex = i;
  }

  onDrop(i: number): void {
    const from = this.dragIndex;
    this.dragIndex = null;
    if (from === null || from === i) return;
    this.mutate((list) => {
      const [moved] = list.splice(from, 1);
      list.splice(i, 0, moved);
      return list;
    });
    this.selected.set(i);
  }

  move(i: number, delta: number): void {
    const j = i + delta;
    if (j < 0 || j >= this.widgets().length) return;
    this.mutate((list) => {
      [list[i], list[j]] = [list[j], list[i]];
      return list;
    });
    this.selected.set(j);
  }

  private input(): DashboardInput {
    return {
      title: this.title().trim(),
      description: this.description(),
      topic: this.topic(),
      globalFilters: this.globalFilters(),
      widgets: packLayout(this.widgets()).map((w) => ({ ...w, id: (w.id ?? 0) > 0 ? w.id : undefined })),
    };
  }

  save(): void {
    if (!this.title().trim()) {
      this.toast.error('Nhập tiêu đề dashboard trước khi lưu');
      return;
    }
    this.saving.set(true);
    const id = this.dashboardId();
    const done = (d: Dashboard) => {
      this.saving.set(false);
      this.apply(d);
      this.toast.success('Đã lưu dashboard');
      if (!id) void this.router.navigate(['/dashboards', d.id, 'edit'], { replaceUrl: true });
    };
    const fail = (e: unknown) => {
      this.saving.set(false);
      const p = toProblem(e);
      if (p.status === 412) this.toast.error(problemMessage(p), { label: 'Tải lại', run: () => id && this.load(id) });
      else this.toast.error(problemMessage(p));
    };
    if (id) {
      this.api.save(id, this.version(), this.input()).subscribe({ next: done, error: fail });
    } else {
      this.api.create({ title: this.title().trim(), description: this.description(), topic: this.topic(), globalFilters: this.globalFilters() }).subscribe({
        next: (created) => this.api.save(created.id ?? 0, created.version ?? 1, this.input()).subscribe({ next: done, error: fail }),
        error: fail,
      });
    }
  }

  async publish(): Promise<void> {
    const id = this.dashboardId();
    if (!id || this.dirty()) {
      this.toast.error('Lưu thay đổi trước khi chia sẻ');
      return;
    }
    const ok = await this.dialogs.confirm({
      title: 'Chia sẻ dashboard',
      message: 'Dashboard sẽ hiển thị với những người được chia sẻ. Mỗi người chỉ thấy số liệu trong phạm vi quyền của họ (BR11).',
      confirmLabel: 'Chia sẻ dashboard',
    });
    if (!ok) return;
    this.api.publish(id).subscribe({
      next: (d) => {
        this.apply(d);
        this.toast.success('Dashboard đã được chia sẻ');
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  hasShare(type: Share['principalType'], id: string): boolean {
    return this.shares().some((s) => s.principalType === type && s.principalId === id);
  }

  toggleShare(type: Share['principalType'], id: string, on: boolean): void {
    this.shares.update((list) => (on ? [...list, { principalType: type, principalId: id }] : list.filter((s) => !(s.principalType === type && s.principalId === id))));
  }

  saveShares(): void {
    const id = this.dashboardId();
    if (!id) return;
    this.api.setShares(id, this.shares()).subscribe({
      next: () => {
        this.shareOpen.set(false);
        this.toast.success('Đã cập nhật danh sách chia sẻ');
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }
}
