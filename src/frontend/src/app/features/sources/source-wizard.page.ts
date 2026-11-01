import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { ConnectionTestResult, DataSource, DataSourceInput, Dataset, DatasetColumn, MappingPreview, MappingRule, Problem, SchemaMapping, SubjectType, UploadResult } from '../../core/api/models';
import { CatalogApi, IntegrationApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { SUBJECT_LABELS } from '../../core/util/labels';
import { StatusBadgeComponent } from '../../shared/badges';
import { DataTableComponent } from '../../shared/data-table';
import { PageHeaderComponent } from '../../shared/overlays';
import { ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

const STEPS = ['Thông tin & căn cứ', 'Kết nối / file', 'Ánh xạ schema', 'Lịch & kích hoạt'];
const CRON_PRESETS: [string, string][] = [
  ['0 2 * * *', 'Hằng ngày 2:00'],
  ['0 */6 * * *', 'Mỗi 6 giờ'],
  ['0 3 * * 1', 'Thứ Hai 3:00'],
  ['0 2 1 * *', 'Ngày 1 hằng tháng'],
];

function emptyForm(): DataSourceInput {
  return { code: 'SRC-', name: '', type: 'FILE', businessOwner: '', purpose: '', legalBasisRef: '', legalDocUri: '', sensitivity: 'INTERNAL', subjectTypes: ['STUDENT'], connectionConfig: {}, fileTemplate: { requiredColumns: [] } };
}

/** P14 — Đăng ký và cấu hình nguồn: 4 bước (US04–US08, BR01). */
@Component({
  selector: 'aiia-source-wizard-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, StateViewComponent, StatusBadgeComponent, DataTableComponent, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './source-wizard.page.html',
  styleUrl: './source-wizard.page.css',
})
export class SourceWizardPage {
  readonly id = input<string | undefined>();
  readonly step = input<string | undefined>();

  private readonly api = inject(IntegrationApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  private readonly session = inject(SessionService);
  protected readonly canEdit = this.session.hasAnyRole('DATA_ENGINEER');
  private readonly canSeeMappings = this.session.hasAnyRole('DATA_ENGINEER', 'DATA_STEWARD');

  protected readonly steps = STEPS;
  protected readonly cronPresets = CRON_PRESETS;
  protected readonly subjects = Object.entries(SUBJECT_LABELS) as [SubjectType, string][];
  protected readonly isNew = computed(() => !this.id() || this.id() === 'new');
  protected readonly current = computed(() => {
    const n = Number(this.step() ?? 1);
    return this.isNew() ? 1 : Math.min(4, Math.max(1, Number.isFinite(n) ? n : 1));
  });

  protected readonly source = signal<DataSource | null>(null);
  protected readonly loadError = signal<Problem | null>(null);
  protected readonly saving = signal(false);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly formError = signal<string | null>(null);
  form: DataSourceInput = emptyForm();
  requiredColumnsText = '';

  // Bước 2
  connection: Record<string, string> = {};
  secret = '';
  protected readonly testResult = signal<ConnectionTestResult | null>(null);
  protected readonly upload = signal<UploadResult | null>(null);
  protected readonly uploadError = signal<Problem | null>(null);
  protected readonly dragOver = signal(false);

  // Bước 3
  protected readonly targets = signal<Dataset[]>([]);
  protected readonly targetColumns = signal<DatasetColumn[]>([]);
  protected readonly mappings = signal<SchemaMapping[]>([]);
  protected readonly mappingPreview = signal<MappingPreview | null>(null);
  targetDatasetId = 0;
  rules: MappingRule[] = [];

  // Bước 4
  cron = '0 2 * * *';
  paused = false;
  protected readonly nextRunAt = signal<string | null>(null);

  protected readonly sourceColumns = computed(() => this.source()?.fileTemplate?.requiredColumns ?? []);
  protected readonly connectionKeys = computed(() => (this.form.type === 'API' ? ['baseUrl', 'pageSize'] : ['host', 'port', 'database', 'username']));

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        if (!id || id === 'new') {
          this.source.set(null);
          this.form = emptyForm();
          this.requiredColumnsText = '';
        } else this.loadSource(Number(id));
      });
    });
    this.catalog.datasets({ pageSize: 100 }).subscribe((p) => this.targets.set(p.items.filter((d) => d.layer === 'SILVER' || d.layer === 'GOLD')));
  }

  private loadSource(id: number): void {
    this.loadError.set(null);
    this.api.source(id).subscribe({
      next: (s) => {
        this.source.set(s);
        this.form = { ...emptyForm(), ...s, connectionConfig: { ...(s.connectionConfig ?? {}) }, fileTemplate: { requiredColumns: [...(s.fileTemplate?.requiredColumns ?? [])] } };
        this.requiredColumnsText = (s.fileTemplate?.requiredColumns ?? []).join(', ');
        this.connection = Object.fromEntries(Object.entries(s.connectionConfig ?? {}).map(([k, v]) => [k, String(v ?? '')]));
        this.cron = s.schedule?.cron ?? '0 2 * * *';
        this.paused = s.schedule?.paused ?? false;
        this.loadMappings(id);
      },
      error: (e: unknown) => this.loadError.set(toProblem(e)),
    });
  }

  private loadMappings(id: number): void {
    if (!this.canSeeMappings) return;
    this.api.mappings(id).subscribe({
      next: (list) => {
        this.mappings.set(list);
        const active = list.find((m) => m.active) ?? list[0];
        if (active) {
          this.selectTarget(active.targetDatasetId, active.rules);
        } else if (this.targets().length && !this.targetDatasetId) {
          this.selectTarget(this.targets()[0].id ?? 0, []);
        }
      },
      error: () => this.mappings.set([]),
    });
  }

  goStep(n: number): void {
    if (this.isNew() && n > 1) return;
    void this.router.navigate([], { queryParams: { step: n }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  toggleSubject(code: SubjectType, on: boolean): void {
    const set = new Set(this.form.subjectTypes);
    if (on) set.add(code);
    else set.delete(code);
    this.form.subjectTypes = [...set];
  }

  private applyErrors(e: unknown): void {
    const p = toProblem(e);
    const map: Record<string, string> = {};
    for (const err of p.errors ?? []) if (err.field) map[err.field] = err.message ?? '';
    this.fieldErrors.set(map);
    this.formError.set(Object.keys(map).length ? null : problemMessage(p));
  }

  /** Bước 1: tạo nguồn (DRAFT) hoặc lưu thông tin. */
  saveInfo(): void {
    this.fieldErrors.set({});
    this.formError.set(null);
    const columns = this.requiredColumnsText
      .split(/[,;\n]/)
      .map((c) => c.trim())
      .filter(Boolean);
    this.saving.set(true);
    const s = this.source();
    if (!s?.id) {
      const payload: DataSourceInput = { ...this.form, code: this.form.code.trim().toUpperCase(), fileTemplate: this.form.type === 'FILE' ? { requiredColumns: columns } : undefined, legalDocUri: this.form.legalDocUri || undefined };
      this.api.createSource(payload).subscribe({
        next: (created) => {
          this.saving.set(false);
          this.toast.success('Đã tạo nguồn ở trạng thái Nháp');
          void this.router.navigate(['/sources', created.id], { queryParams: { step: 2 } });
        },
        error: (e: unknown) => {
          this.saving.set(false);
          this.applyErrors(e);
        },
      });
      return;
    }
    this.api
      .updateSource(s.id, {
        name: this.form.name,
        businessOwner: this.form.businessOwner,
        purpose: this.form.purpose,
        legalBasisRef: this.form.legalBasisRef,
        sensitivity: this.form.sensitivity,
        fileTemplate: s.type === 'FILE' ? { requiredColumns: columns } : undefined,
      })
      .subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.source.set(updated);
          this.toast.success('Đã lưu thông tin nguồn');
          this.goStep(2);
        },
        error: (e: unknown) => {
          this.saving.set(false);
          this.applyErrors(e);
        },
      });
  }

  /** Bước 2 (JDBC/API): lưu cấu hình rồi kiểm tra kết nối; bí mật chỉ gửi đi, không hiển thị lại. */
  testConnection(): void {
    const s = this.source();
    if (!s?.id) return;
    this.testResult.set(null);
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.connection)) if (v !== '') config[k] = k === 'port' || k === 'pageSize' ? Number(v) : v;
    this.saving.set(true);
    this.api.updateSource(s.id, { connectionConfig: config }).subscribe({
      next: () =>
        this.api.testConnection(s.id!, this.secret || undefined).subscribe({
          next: (r) => {
            this.saving.set(false);
            this.secret = '';
            this.testResult.set(r);
            this.loadSource(s.id!);
          },
          error: (e: unknown) => {
            this.saving.set(false);
            this.toast.error(problemMessage(toProblem(e)));
          },
        }),
      error: (e: unknown) => {
        this.saving.set(false);
        this.toast.error(problemMessage(toProblem(e)));
      },
    });
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.uploadFile(file);
  }

  onPick(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    if (file) this.uploadFile(file);
    el.value = '';
  }

  private uploadFile(file: File): void {
    const s = this.source();
    if (!s?.id) return;
    this.upload.set(null);
    this.uploadError.set(null);
    this.saving.set(true);
    this.api.upload(s.id, file).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.upload.set(r);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.uploadError.set(toProblem(e));
      },
    });
  }

  async ingestUpload(confirmDuplicate = false): Promise<void> {
    const s = this.source();
    const u = this.upload();
    if (!s?.id || !u?.uploadId) return;
    if (u.duplicateOfBatchId && !confirmDuplicate) {
      const ok = await this.dialogs.confirm({
        title: 'File trùng nội dung',
        message: `File này giống hệt lô #${u.duplicateOfBatchId} đã ingest (cùng checksum). Vẫn ingest lại?`,
        confirmLabel: 'Vẫn ingest',
      });
      if (!ok) return;
      confirmDuplicate = true;
    }
    this.trigger({ uploadId: u.uploadId, confirmDuplicate });
  }

  private trigger(body: { uploadId?: string; confirmDuplicate?: boolean } = {}): void {
    const s = this.source();
    if (!s?.id) return;
    this.saving.set(true);
    this.api.triggerRun(s.id, body).subscribe({
      next: (run) => {
        this.saving.set(false);
        this.toast.success('Đã đưa vào hàng đợi ingest');
        void this.router.navigate(['/runs', run.id]);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.toast.error(problemMessage(toProblem(e)));
      },
    });
  }

  ingestNow(): void {
    this.trigger();
  }

  /** Bước 3: chọn dataset đích, dựng một dòng ánh xạ cho mỗi cột đích. */
  selectTarget(datasetId: number, existing: MappingRule[] = this.rules): void {
    this.targetDatasetId = datasetId;
    this.mappingPreview.set(null);
    if (!datasetId) return;
    this.catalog.dataset(datasetId).subscribe((d) => {
      const cols = d.columns ?? [];
      this.targetColumns.set(cols);
      const byTarget = new Map(existing.map((r) => [r.targetColumn, r]));
      this.rules = cols.map((c) => ({ targetColumn: c.name ?? '', sourceColumn: byTarget.get(c.name ?? '')?.sourceColumn ?? this.guessSource(c.name ?? ''), transform: byTarget.get(c.name ?? '')?.transform ?? null }));
    });
  }

  private guessSource(target: string): string | null {
    const src = this.sourceColumns();
    return src.find((c) => c === target) ?? null;
  }

  private mappingInput() {
    return { targetDatasetId: this.targetDatasetId, rules: this.rules.map((r) => ({ targetColumn: r.targetColumn, sourceColumn: r.sourceColumn || null, transform: r.transform || null })) };
  }

  previewMapping(): void {
    const s = this.source();
    if (!s?.id || !this.targetDatasetId) return;
    this.api.previewMapping(s.id, this.mappingInput()).subscribe({
      next: (p) => this.mappingPreview.set(p),
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  ruleError(target: string): string | null {
    return this.mappingPreview()?.errors?.find((e) => e.targetColumn === target)?.message ?? null;
  }

  saveMapping(): void {
    const s = this.source();
    if (!s?.id) return;
    this.saving.set(true);
    this.api.createMapping(s.id, this.mappingInput()).subscribe({
      next: (m) => {
        this.saving.set(false);
        this.toast.success(`Đã lưu mapping phiên bản ${m.version}`);
        this.loadMappings(s.id!);
        this.goStep(4);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        const p = toProblem(e);
        this.mappingPreview.update((prev) => ({ ...(prev ?? {}), valid: false, errors: (p.errors ?? []).map((x) => ({ targetColumn: x.field, message: x.message })) }));
        this.toast.error(problemMessage(p));
      },
    });
  }

  /** Bước 4. */
  saveSchedule(): void {
    const s = this.source();
    if (!s?.id) return;
    this.api.setSchedule(s.id, { cron: this.cron.trim(), paused: this.paused }).subscribe({
      next: (r) => {
        this.nextRunAt.set(r.nextRunAt ?? null);
        this.toast.success('Đã lưu lịch ingest');
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  setStatus(status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'): void {
    const s = this.source();
    if (!s?.id) return;
    this.api.updateSource(s.id, { status }).subscribe({
      next: (updated) => {
        this.source.set(updated);
        this.toast.success(status === 'ACTIVE' ? 'Nguồn đã hoạt động' : 'Đã cập nhật trạng thái');
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  datasetName(id: number | undefined): string {
    const d = this.targets().find((x) => x.id === id);
    return d ? `${d.schemaName}.${d.tableName}` : `#${id}`;
  }
}
