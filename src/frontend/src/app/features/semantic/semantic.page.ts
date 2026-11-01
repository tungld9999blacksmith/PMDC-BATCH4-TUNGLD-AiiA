import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Dataset, GlossaryTerm, MetricDetail, MetricInput, QueryResult } from '../../core/api/models';
import { CatalogApi, SemanticApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { DataTableComponent } from '../../shared/data-table';
import { PageHeaderComponent } from '../../shared/overlays';
import { RelTimePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';
import { SemanticCatalog } from '../dashboards/semantic-catalog.service';

const BASE_TABLES = ['mart_student_term_kpi', 'fact_teaching_load', 'fact_research_output', 'mart_dq_daily'];

function emptyForm(): MetricInput {
  return { code: '', name: '', definition: '', expression: 'count_distinct(person_id)', baseDatasetId: 0, allowedDimensions: [], unit: '' };
}

/** P10 — Semantic model (US36): metric và dimension chuẩn; chỉ metric CERTIFIED dùng cho trợ lý. */
@Component({
  selector: 'aiia-semantic-page',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent, StateViewComponent, StatusBadgeComponent, DataTableComponent, RelTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Semantic model" [adv]="true" subtitle="Một định nghĩa cho mỗi chỉ số. Trợ lý hỏi-đáp chỉ dùng metric đã được chứng nhận.">
        @if (isAnalyst()) {
          <button type="button" class="btn primary" (click)="startNew()">+ Metric mới</button>
        }
      </aiia-page-header>
      <div class="layout">
        <section class="card flush">
          <table class="table">
            <thead><tr><th>Metric</th><th>Trạng thái</th><th class="num">Phiên bản</th></tr></thead>
            <tbody>
              @for (m of catalog.metrics(); track m.code) {
                <tr class="clickable" [class.selected]="m.code === selectedCode()" (click)="open(m.code ?? '')">
                  <td><div>{{ m.name }}</div><div class="small muted mono">{{ m.code }}</div></td>
                  <td><aiia-status [status]="m.status" /></td>
                  <td class="num">v{{ m.version }}</td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <section class="card">
          @if (mode() === 'none') {
            <aiia-state message="Chọn một metric để xem hoặc sửa" />
          } @else {
            <div class="card-title">
              <h2>{{ mode() === 'new' ? 'Metric mới' : form.name }}</h2>
              @if (detail.state().data; as d) {
                <span class="row"><aiia-status [status]="d.status" /><span class="small muted">dùng ở {{ d.usedByDashboards }} dashboard</span></span>
              }
            </div>
            @if (detail.state().data?.status === 'CERTIFIED' && isAnalyst()) {
              <div class="banner warn small">Sửa công thức hoặc định nghĩa sẽ tạo phiên bản mới và đưa metric về DRAFT cho tới khi được chứng nhận lại.</div>
            }
            <form class="form-grid" (ngSubmit)="save()">
              <label class="field"><span class="small muted">Mã</span><input class="input mono" name="code" [(ngModel)]="form.code" [disabled]="mode() === 'edit' || !isAnalyst()" placeholder="academic_warning_rate" /></label>
              <label class="field"><span class="small muted">Tên</span><input class="input" name="name" [(ngModel)]="form.name" [disabled]="!isAnalyst()" /></label>
              <label class="field full"><span class="small muted">Định nghĩa nghiệp vụ</span><textarea class="input" name="definition" [(ngModel)]="form.definition" [disabled]="!isAnalyst()"></textarea></label>
              <label class="field"><span class="small muted">Dataset nền</span>
                <select class="input" name="base" [(ngModel)]="form.baseDatasetId" [disabled]="!isAnalyst()">
                  <option [ngValue]="0">— chọn —</option>
                  @for (d of bases(); track d.id) {
                    <option [ngValue]="d.id">{{ d.schemaName }}.{{ d.tableName }}</option>
                  }
                </select>
              </label>
              <label class="field"><span class="small muted">Đơn vị</span><input class="input" name="unit" [(ngModel)]="form.unit" [disabled]="!isAnalyst()" placeholder="%, SV, giờ…" /></label>
              <label class="field full"><span class="small muted">Công thức</span>
                <input class="input mono" name="expression" [(ngModel)]="form.expression" [disabled]="!isAnalyst()" />
                <span class="hint">Dạng: count_distinct(person_id), rate(warning), avg(gpa), sum(hours)…</span>
              </label>
              <fieldset class="field full dims">
                <legend class="small muted">Dimension cho phép</legend>
                <div class="row">
                  @for (d of catalog.dimensions(); track d.code) {
                    <label class="row small"><input type="checkbox" [checked]="(form.allowedDimensions ?? []).includes(d.code ?? '')" [disabled]="!isAnalyst()" (change)="toggleDim(d.code ?? '', $any($event.target).checked)" /> {{ d.name }}</label>
                  }
                </div>
              </fieldset>
              <label class="field full"><span class="small muted">Thuật ngữ glossary</span>
                <select class="input" name="term" [(ngModel)]="form.glossaryTermId" [disabled]="!isAnalyst()">
                  <option [ngValue]="null">—</option>
                  @for (t of terms(); track t.id) {
                    <option [ngValue]="t.id">{{ t.name }}</option>
                  }
                </select>
              </label>
              @if (errors().length) {
                <div class="banner danger small full" role="alert"><ul style="margin: 0; padding-left: 18px">@for (e of errors(); track e) {<li>{{ e }}</li>}</ul></div>
              }
              <div class="row full">
                @if (isAnalyst()) {
                  <button type="button" class="btn" (click)="validate()">Kiểm tra công thức</button>
                  <button type="submit" class="btn primary" [disabled]="busy()">{{ mode() === 'new' ? 'Tạo metric' : 'Lưu phiên bản mới' }}</button>
                }
                <span class="spacer"></span>
                @if (isSteward() && mode() === 'edit') {
                  @if (detail.state().data?.status !== 'CERTIFIED') {
                    <button type="button" class="btn primary" (click)="certify('CERTIFIED')">Chứng nhận</button>
                  }
                  @if (detail.state().data?.status !== 'DEPRECATED') {
                    <button type="button" class="btn" (click)="certify('DEPRECATED')">Ngừng dùng</button>
                  }
                }
              </div>
            </form>

            @if (preview(); as p) {
              <h3 style="margin-top: 16px">Xem trước giá trị</h3>
              <aiia-table [data]="{ columns: p.columns, rows: p.rows }" caption="Xem trước" />
            }

            @if (detail.state().data?.versions?.length) {
              <h3 style="margin-top: 16px">Lịch sử phiên bản</h3>
              <table class="table">
                <thead><tr><th>Phiên bản</th><th>Công thức</th><th>Người sửa</th><th>Thời điểm</th><th></th></tr></thead>
                <tbody>
                  @for (v of detail.state().data?.versions ?? []; track v.version) {
                    <tr>
                      <td>v{{ v.version }}</td>
                      <td class="mono">{{ v.expression }}</td>
                      <td>{{ v.changedBy?.fullName }}</td>
                      <td>{{ v.changedAt | relTime }}</td>
                      <td>@if (isAnalyst() && v.expression !== form.expression) {<button type="button" class="link-btn small" (click)="form.expression = v.expression ?? form.expression">Khôi phục</button>}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          }
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      .layout {
        display: grid;
        grid-template-columns: 360px minmax(0, 1fr);
        gap: 16px;
        align-items: start;
      }
      @media (max-width: 1000px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
      .dims {
        border: 0;
        padding: 0;
        margin: 0;
      }
    `,
  ],
})
export class SemanticPage {
  private readonly api = inject(SemanticApi);
  private readonly catalogApi = inject(CatalogApi);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  protected readonly catalog = inject(SemanticCatalog);

  protected readonly detail = loader<MetricDetail>();
  protected readonly mode = signal<'none' | 'new' | 'edit'>('none');
  protected readonly selectedCode = signal<string | null>(null);
  protected readonly errors = signal<string[]>([]);
  protected readonly preview = signal<QueryResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly bases = signal<Dataset[]>([]);
  protected readonly terms = signal<GlossaryTerm[]>([]);
  protected readonly isAnalyst = computed(() => this.session.hasAnyRole('BI_ANALYST'));
  protected readonly isSteward = computed(() => this.session.hasAnyRole('DATA_STEWARD'));
  form: MetricInput & { glossaryTermId?: number | null } = emptyForm();

  constructor() {
    this.catalogApi.datasets({ layer: 'GOLD', pageSize: 100 }).subscribe((p) => this.bases.set(p.items.filter((d) => BASE_TABLES.includes(d.tableName ?? ''))));
    this.catalogApi.glossary().subscribe((t) => this.terms.set(t));
  }

  startNew(): void {
    this.mode.set('new');
    this.selectedCode.set(null);
    this.detail.state.set({ status: 'idle', data: null, error: null });
    this.form = emptyForm();
    this.errors.set([]);
    this.preview.set(null);
  }

  open(code: string): void {
    this.mode.set('edit');
    this.selectedCode.set(code);
    this.errors.set([]);
    this.preview.set(null);
    this.api.metric(code).subscribe({
      next: (m) => {
        this.detail.set(m);
        this.form = { code: m.code ?? '', name: m.name ?? '', definition: m.definition ?? '', expression: m.expression ?? '', baseDatasetId: m.baseDatasetId ?? 0, allowedDimensions: [...(m.allowedDimensions ?? [])], unit: m.unit ?? '', glossaryTermId: m.glossaryTermId ?? null };
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  toggleDim(code: string, on: boolean): void {
    const dims = new Set(this.form.allowedDimensions ?? []);
    if (on) dims.add(code);
    else dims.delete(code);
    this.form.allowedDimensions = [...dims];
  }

  validate(): void {
    this.api.validate(this.form).subscribe({
      next: (r) => {
        this.errors.set(r.errors ?? []);
        this.preview.set(r.valid ? (r.preview ?? null) : null);
        if (r.valid) this.toast.success('Công thức hợp lệ');
      },
      error: (e: unknown) => this.errors.set([problemMessage(toProblem(e))]),
    });
  }

  save(): void {
    this.busy.set(true);
    const req = this.mode() === 'new' ? this.api.createMetric(this.form) : this.api.updateMetric(this.form.code, this.form);
    req.subscribe({
      next: (m) => {
        this.busy.set(false);
        this.toast.success(this.mode() === 'new' ? 'Đã tạo metric (DRAFT)' : 'Đã lưu phiên bản mới');
        this.catalog.loadMetrics(true).subscribe();
        this.open(m.code ?? this.form.code);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.errors.set([problemMessage(toProblem(e))]);
      },
    });
  }

  async certify(status: 'CERTIFIED' | 'DEPRECATED'): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: status === 'CERTIFIED' ? 'Chứng nhận metric' : 'Ngừng dùng metric',
      message: status === 'CERTIFIED' ? 'Metric sẽ được trợ lý hỏi-đáp sử dụng và hiển thị là chuẩn cho toàn trường.' : 'Dashboard và trợ lý sẽ không dùng metric này nữa.',
      confirmLabel: status === 'CERTIFIED' ? 'Chứng nhận' : 'Ngừng dùng',
      danger: status === 'DEPRECATED',
    });
    if (!ok) return;
    this.api.certify(this.form.code, status).subscribe({
      next: () => {
        this.toast.success('Đã cập nhật trạng thái metric');
        this.catalog.loadMetrics(true).subscribe();
        this.open(this.form.code);
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }
}
