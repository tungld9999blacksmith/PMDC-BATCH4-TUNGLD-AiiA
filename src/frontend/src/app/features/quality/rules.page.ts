import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { Dataset, DatasetColumn, DqDimension, DqRule, DqRuleInput, DryRunResult } from '../../core/api/models';
import { CatalogApi, QualityApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { ToastService } from '../../core/ui/toast.service';
import { DIMENSION_LABELS } from '../../core/util/labels';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { DataTableComponent } from '../../shared/data-table';
import { DrawerComponent, PageHeaderComponent } from '../../shared/overlays';
import { LabelPipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

type RuleType = DqRuleInput['ruleType'];
const RULE_TYPES: [RuleType, string, DqDimension][] = [
  ['NOT_NULL', 'Không được rỗng', 'COMPLETENESS'],
  ['UNIQUE', 'Không trùng lặp', 'UNIQUENESS'],
  ['RANGE', 'Trong khoảng giá trị', 'VALIDITY'],
  ['REGEX', 'Khớp định dạng (regex)', 'VALIDITY'],
  ['REFERENCE', 'Tham chiếu tồn tại', 'CONSISTENCY'],
  ['FRESHNESS', 'Độ tươi dữ liệu', 'TIMELINESS'],
  ['CUSTOM_SQL', 'SQL tùy chỉnh', 'VALIDITY'],
];

interface RuleForm {
  datasetId: number;
  columnId: number | null;
  ruleType: RuleType;
  dimension: DqDimension;
  severity: 'BLOCKING' | 'WARNING';
  description: string;
  min: string;
  max: string;
  pattern: string;
  refDataset: string;
  refColumn: string;
  maxAgeHours: string;
  sql: string;
}

function emptyForm(datasetId = 0): RuleForm {
  return { datasetId, columnId: null, ruleType: 'NOT_NULL', dimension: 'COMPLETENESS', severity: 'WARNING', description: '', min: '', max: '', pattern: '', refDataset: '', refColumn: '', maxAgeHours: '24', sql: '' };
}

/** P19 — Quy tắc chất lượng: định nghĩa, chạy thử bắt buộc trước khi kích hoạt (US16, US17, BR06). */
@Component({
  selector: 'aiia-rules-page',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent, DrawerComponent, StateViewComponent, StatusBadgeComponent, DataTableComponent, LabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Quy tắc chất lượng" [crumbs]="[{ label: 'Chất lượng & issue', link: '/quality' }, { label: 'Quy tắc' }]" subtitle="Quy tắc mức Chặn (BLOCKING) đưa bản ghi vi phạm vào vùng cách ly; mức Cảnh báo chỉ ghi nhận. Mỗi phiên bản phải chạy thử trước khi kích hoạt.">
        @if (isSteward) {
          <button type="button" class="btn primary" (click)="openForm(null)">+ Quy tắc</button>
        }
      </aiia-page-header>

      <div class="card row filters">
        <select class="input" aria-label="Dataset" [ngModel]="filterDataset()" (ngModelChange)="setDataset($event)">
          <option [ngValue]="0">Mọi dataset</option>
          @for (d of datasets(); track d.id) {
            <option [ngValue]="d.id">{{ d.schemaName }}.{{ d.tableName }}</option>
          }
        </select>
        <select class="input" aria-label="Chiều chất lượng" [(ngModel)]="dimension" (ngModelChange)="load()">
          <option value="">Mọi chiều</option>
          @for (d of dimensions; track d[0]) {
            <option [value]="d[0]">{{ d[1] }}</option>
          }
        </select>
        <select class="input" aria-label="Trạng thái" [(ngModel)]="status" (ngModelChange)="load()">
          <option value="">Mọi trạng thái</option>
          <option value="DRAFT">Nháp</option>
          <option value="ACTIVE">Hoạt động</option>
          <option value="DISABLED">Tắt</option>
        </select>
      </div>

      <section class="card flush">
        @switch (rules.state().status) {
          @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
          @case ('error') { <aiia-state kind="error" [message]="rules.message()" actionLabel="Thử lại" (action)="load()" /> }
          @default {
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Mô tả</th><th>Dataset · cột</th><th>Loại</th><th>Chiều</th><th>Mức</th><th>Phiên bản</th><th class="num">Tỉ lệ đạt</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  @for (r of rules.data ?? []; track r.id) {
                    <tr class="clickable" tabindex="0" (click)="openForm(r)" (keydown.enter)="openForm(r)">
                      <td>{{ r.description }}</td>
                      <td class="mono small">{{ datasetName(r.datasetId) }}{{ columnName(r) }}</td>
                      <td>{{ typeLabel(r.ruleType) }}</td>
                      <td>{{ r.dimension | label: 'dimension' }}</td>
                      <td><aiia-status [status]="r.severity" /></td>
                      <td>v{{ r.version }} @if (r.lastDryRunVersion === r.version) { <span class="chip ok" title="Đã chạy thử phiên bản này">✓</span> }</td>
                      <td class="num">{{ r.lastPassRate === null || r.lastPassRate === undefined ? '—' : r.lastPassRate + '%' }}</td>
                      <td><aiia-status [status]="r.status" /></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="8"><aiia-state message="Chưa có quy tắc phù hợp" /></td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      </section>

      @if (formOpen()) {
        <aiia-drawer [title]="editing() ? 'Quy tắc #' + editing()!.id : 'Quy tắc mới'" [wide]="true" (closed)="formOpen.set(false)">
          <div class="stack">
            @if (editing(); as r) {
              <div class="row">
                <aiia-status [status]="r.status" />
                <span class="small muted">Phiên bản {{ r.version }} · {{ r.lastDryRunVersion === r.version ? 'đã chạy thử' : 'chưa chạy thử phiên bản này' }}</span>
              </div>
            }
            <div class="form-grid">
              <label class="field full"><span class="small muted">Mô tả *</span><input class="input" [(ngModel)]="form.description" [disabled]="!isSteward" placeholder="VD: Số tiền đã nộp không âm" /></label>
              <label class="field"><span class="small muted">Dataset *</span>
                <select class="input" [ngModel]="form.datasetId" (ngModelChange)="pickDataset($event)" [disabled]="!isSteward || !!editing()">
                  <option [ngValue]="0">— chọn —</option>
                  @for (d of datasets(); track d.id) {
                    <option [ngValue]="d.id">{{ d.schemaName }}.{{ d.tableName }}</option>
                  }
                </select>
              </label>
              <label class="field"><span class="small muted">Cột</span>
                <select class="input" [(ngModel)]="form.columnId" [disabled]="!isSteward">
                  <option [ngValue]="null">— cả bảng —</option>
                  @for (c of columns(); track c.id) {
                    <option [ngValue]="c.id">{{ c.name }}</option>
                  }
                </select>
              </label>
              <label class="field"><span class="small muted">Loại quy tắc *</span>
                <select class="input" [ngModel]="form.ruleType" (ngModelChange)="pickType($event)" [disabled]="!isSteward">
                  @for (t of ruleTypes; track t[0]) {
                    <option [value]="t[0]">{{ t[1] }}</option>
                  }
                </select>
              </label>
              <label class="field"><span class="small muted">Chiều chất lượng *</span>
                <select class="input" [(ngModel)]="form.dimension" [disabled]="!isSteward">
                  @for (d of dimensions; track d[0]) {
                    <option [value]="d[0]">{{ d[1] }}</option>
                  }
                </select>
              </label>
              <fieldset class="field full">
                <legend class="small muted">Mức độ *</legend>
                <div class="row">
                  <label class="row small"><input type="radio" name="sev" value="WARNING" [(ngModel)]="form.severity" [disabled]="!isSteward" /> Cảnh báo — chỉ ghi nhận issue</label>
                  <label class="row small"><input type="radio" name="sev" value="BLOCKING" [(ngModel)]="form.severity" [disabled]="!isSteward" /> Chặn — đưa bản ghi vào vùng cách ly</label>
                </div>
              </fieldset>
              @switch (form.ruleType) {
                @case ('RANGE') {
                  <label class="field"><span class="small muted">Nhỏ nhất</span><input class="input" type="number" [(ngModel)]="form.min" [disabled]="!isSteward" /></label>
                  <label class="field"><span class="small muted">Lớn nhất</span><input class="input" type="number" [(ngModel)]="form.max" [disabled]="!isSteward" /></label>
                }
                @case ('REGEX') {
                  <label class="field full"><span class="small muted">Biểu thức chính quy *</span><input class="input mono" [(ngModel)]="form.pattern" [disabled]="!isSteward" placeholder="^[0-9]{8}$" /></label>
                }
                @case ('REFERENCE') {
                  <label class="field"><span class="small muted">Dataset tham chiếu *</span><input class="input mono" [(ngModel)]="form.refDataset" [disabled]="!isSteward" placeholder="silver.silver_sis_students" /></label>
                  <label class="field"><span class="small muted">Cột tham chiếu *</span><input class="input mono" [(ngModel)]="form.refColumn" [disabled]="!isSteward" placeholder="student_id" /></label>
                }
                @case ('FRESHNESS') {
                  <label class="field"><span class="small muted">Tối đa (giờ) kể từ lần cập nhật</span><input class="input" type="number" [(ngModel)]="form.maxAgeHours" [disabled]="!isSteward" /></label>
                }
                @case ('CUSTOM_SQL') {
                  <label class="field full"><span class="small muted">SQL trả về các dòng vi phạm *</span><textarea class="input mono" [(ngModel)]="form.sql" [disabled]="!isSteward"></textarea></label>
                }
              }
            </div>
            @if (formError()) {
              <div class="banner danger small" role="alert">{{ formError() }}</div>
            }

            @if (dryRun(); as dr) {
              <div class="card stack dry">
                <div class="row">
                  <strong>Kết quả chạy thử</strong>
                  <span class="chip" [class.ok]="!dr.failed" [class.warn]="!!dr.failed">{{ dr.failed }} / {{ dr.evaluated }} dòng vi phạm</span>
                </div>
                @if (dr.failed) {
                  <aiia-table [data]="dr.sample" caption="Mẫu dòng vi phạm" />
                }
              </div>
            }

            @if (isSteward) {
              <div class="row">
                @if (editing(); as r) {
                  <button type="button" class="btn" (click)="runDry(r)">Chạy thử</button>
                  @if (r.status !== 'ACTIVE') {
                    <button type="button" class="btn" [disabled]="r.lastDryRunVersion !== r.version" [title]="r.lastDryRunVersion !== r.version ? 'Chạy thử phiên bản hiện tại trước' : ''" (click)="setStatus(r, 'ACTIVE')">Kích hoạt</button>
                  } @else {
                    <button type="button" class="btn" (click)="setStatus(r, 'DISABLED')">Tắt</button>
                  }
                }
                <span class="spacer"></span>
                <button type="button" class="btn" (click)="formOpen.set(false)">Đóng</button>
                <button type="button" class="btn primary" (click)="save()">{{ editing() ? 'Lưu (tạo phiên bản mới nếu đổi định nghĩa)' : 'Tạo quy tắc (Nháp)' }}</button>
              </div>
            }
          </div>
        </aiia-drawer>
      }
    </div>
  `,
  styles: [
    `
      .filters {
        margin-bottom: 16px;
      }
      .dry {
        background: var(--color-bg);
      }
    `,
  ],
})
export class RulesPage {
  readonly datasetId = input<string | undefined>();

  private readonly api = inject(QualityApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly isSteward = inject(SessionService).hasAnyRole('DATA_STEWARD');
  protected readonly ruleTypes = RULE_TYPES;
  protected readonly dimensions = Object.entries(DIMENSION_LABELS) as [DqDimension, string][];
  protected readonly rules = loader<DqRule[]>();
  protected readonly datasets = signal<Dataset[]>([]);
  protected readonly columns = signal<DatasetColumn[]>([]);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<DqRule | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly dryRun = signal<DryRunResult | null>(null);
  protected readonly filterDataset = computed(() => Number(this.datasetId() ?? 0) || 0);
  private readonly columnCache = new Map<number, DatasetColumn[]>();
  dimension = '';
  status = '';
  form: RuleForm = emptyForm();

  constructor() {
    this.catalog.datasets({ pageSize: 100 }).subscribe((p) => this.datasets.set(p.items));
    effect(() => {
      this.filterDataset();
      untracked(() => this.load());
    });
  }

  load(): void {
    this.rules.load(this.api.rules({ datasetId: this.filterDataset() || undefined, dimension: this.dimension || undefined, status: this.status || undefined }), true);
  }

  setDataset(id: number): void {
    void this.router.navigate([], { queryParams: { datasetId: id || null }, queryParamsHandling: 'merge' });
  }

  datasetName(id: number | undefined): string {
    const d = this.datasets().find((x) => x.id === id);
    return d ? `${d.schemaName}.${d.tableName}` : `#${id}`;
  }

  columnName(r: DqRule): string {
    const c = this.columnCache.get(r.datasetId)?.find((x) => x.id === r.columnId);
    return c ? ` · ${c.name}` : '';
  }

  typeLabel(t: string | undefined): string {
    return RULE_TYPES.find((x) => x[0] === t)?.[1] ?? t ?? '';
  }

  pickDataset(id: number): void {
    this.form.datasetId = id;
    this.form.columnId = null;
    this.loadColumns(id);
  }

  private loadColumns(id: number): void {
    this.columns.set([]);
    if (!id) return;
    const cached = this.columnCache.get(id);
    if (cached) {
      this.columns.set(cached);
      return;
    }
    this.catalog.dataset(id).subscribe((d) => {
      this.columnCache.set(id, d.columns ?? []);
      this.columns.set(d.columns ?? []);
    });
  }

  pickType(t: RuleType): void {
    this.form.ruleType = t;
    this.form.dimension = RULE_TYPES.find((x) => x[0] === t)?.[2] ?? this.form.dimension;
  }

  openForm(r: DqRule | null): void {
    this.editing.set(r);
    this.formError.set(null);
    this.dryRun.set(null);
    if (r) {
      const p = (r.params ?? {}) as Record<string, unknown>;
      const str = (k: string) => (p[k] === undefined || p[k] === null ? '' : String(p[k]));
      this.form = { datasetId: r.datasetId, columnId: r.columnId ?? null, ruleType: r.ruleType, dimension: r.dimension, severity: r.severity, description: r.description, min: str('min'), max: str('max'), pattern: str('pattern'), refDataset: str('ref_dataset'), refColumn: str('ref_column'), maxAgeHours: str('maxAgeHours') || '24', sql: str('sql') };
    } else {
      this.form = emptyForm(this.filterDataset());
    }
    this.loadColumns(this.form.datasetId);
    this.formOpen.set(true);
  }

  private params(): Record<string, unknown> {
    const f = this.form;
    switch (f.ruleType) {
      case 'RANGE':
        return { ...(f.min !== '' ? { min: Number(f.min) } : {}), ...(f.max !== '' ? { max: Number(f.max) } : {}) };
      case 'REGEX':
        return f.pattern ? { pattern: f.pattern } : {};
      case 'REFERENCE':
        return { ref_dataset: f.refDataset || undefined, ref_column: f.refColumn || undefined };
      case 'FRESHNESS':
        return { maxAgeHours: Number(f.maxAgeHours || 24) };
      case 'CUSTOM_SQL':
        return f.sql ? { sql: f.sql } : {};
      default:
        return {};
    }
  }

  save(): void {
    this.formError.set(null);
    const input: DqRuleInput = { datasetId: this.form.datasetId, columnId: this.form.columnId, ruleType: this.form.ruleType, dimension: this.form.dimension, severity: this.form.severity, description: this.form.description, params: this.params() };
    const r = this.editing();
    const req = r?.id ? this.api.updateRule(r.id, input) : this.api.createRule(input);
    req.subscribe({
      next: (saved) => {
        this.toast.success(r ? `Đã lưu (phiên bản ${saved.version})` : 'Đã tạo quy tắc ở trạng thái Nháp — hãy chạy thử');
        this.editing.set(saved);
        this.load();
      },
      error: (e: unknown) => this.formError.set(problemMessage(toProblem(e))),
    });
  }

  runDry(r: DqRule): void {
    if (!r.id) return;
    this.dryRun.set(null);
    this.api.dryRun(r.id).subscribe({
      next: (res) => {
        this.dryRun.set(res);
        this.editing.set({ ...r, lastDryRunVersion: r.version });
        this.load();
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  setStatus(r: DqRule, status: 'ACTIVE' | 'DISABLED'): void {
    if (!r.id) return;
    this.api.updateRule(r.id, { status }).subscribe({
      next: (saved) => {
        this.editing.set(saved);
        this.toast.success(status === 'ACTIVE' ? 'Quy tắc đã hoạt động từ lần chạy pipeline kế tiếp' : 'Đã tắt quy tắc');
        this.load();
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }
}
