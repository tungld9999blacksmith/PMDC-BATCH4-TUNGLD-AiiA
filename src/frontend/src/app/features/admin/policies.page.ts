import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Observable } from 'rxjs';
import type { AdminUser, ColumnRule, Dataset, DatasetColumn, Policy, PolicyVersion, RoleCode, TabularResult } from '../../core/api/models';
import { AdminApi, CatalogApi } from '../../core/api/services';
import { problemMessage, toProblem } from '../../core/http/problem';
import { ToastService } from '../../core/ui/toast.service';
import { ROLE_LABELS } from '../../core/util/labels';
import { loader } from '../../shared/async';
import { DataTableComponent } from '../../shared/data-table';
import { PageHeaderComponent } from '../../shared/overlays';
import { LabelPipe, ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

const ACTIONS: [ColumnRule['action'], string][] = [
  ['MASK_PARTIAL', 'Che một phần'],
  ['HASH', 'Băm'],
  ['DENY', 'Ẩn hoàn toàn'],
];
const FILTER_EXAMPLES = ["faculty_code = current_user_attr('faculty_code')", "faculty_code = 'CNTT'", "faculty_code IN ('CNTT', 'KT')"];

interface Draft {
  id: number | null;
  name: string;
  datasetId: number;
  roleCode: RoleCode;
  rowFilter: string;
  columnRules: ColumnRule[];
  changeNote: string;
}

/** P26 — Chính sách RLS/CLS có phiên bản và mô phỏng "xem như người dùng" (US25, BR10, BR11). */
@Component({
  selector: 'aiia-policies-page',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent, StateViewComponent, DataTableComponent, LabelPipe, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Chính sách phân quyền" [adv]="true" subtitle="Lọc dòng theo phạm vi (RLS) và che cột nhạy cảm (CLS). Mặc định từ chối; mỗi lần sửa tạo phiên bản mới. Hãy mô phỏng trước khi lưu.">
        <button type="button" class="btn primary" (click)="newPolicy()">+ Chính sách</button>
      </aiia-page-header>

      <div class="layout">
        <aside class="card flush list" aria-label="Danh sách chính sách">
          @switch (policies.state().status) {
            @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
            @case ('error') { <aiia-state kind="error" [message]="policies.message()" /> }
            @default {
              @for (p of policies.data ?? []; track p.id) {
                <button type="button" class="item" [class.active]="draft()?.id === p.id" (click)="select(p)">
                  <strong>{{ p.name }}</strong>
                  <span class="small muted">{{ p.roleCode | label: 'role' }} · {{ datasetName(p.datasetId) }}</span>
                  <span class="small muted">v{{ p.currentVersion?.version }} · {{ p.active ? 'đang áp dụng' : 'tắt' }}</span>
                </button>
              } @empty {
                <aiia-state message="Chưa có chính sách" />
              }
            }
          }
        </aside>

        @if (draft(); as d) {
          <div class="stack main">
            <section class="card stack">
              <div class="form-grid">
                <label class="field"><span class="small muted">Tên *</span><input class="input" [(ngModel)]="d.name" [disabled]="!!d.id" /></label>
                <label class="field"><span class="small muted">Vai trò áp dụng *</span>
                  <select class="input" [(ngModel)]="d.roleCode" [disabled]="!!d.id">
                    @for (r of roles; track r[0]) {
                      <option [value]="r[0]">{{ r[1] }}</option>
                    }
                  </select>
                </label>
                <label class="field full"><span class="small muted">Dataset *</span>
                  <select class="input" [ngModel]="d.datasetId" (ngModelChange)="pickDataset(d, $event)" [disabled]="!!d.id">
                    <option [ngValue]="0">— chọn —</option>
                    @for (x of datasets(); track x.id) {
                      <option [ngValue]="x.id">{{ x.schemaName }}.{{ x.tableName }}</option>
                    }
                  </select>
                </label>
                <label class="field full"><span class="small muted">Lọc dòng (RLS)</span>
                  <input class="input mono" [(ngModel)]="d.rowFilter" list="filter-examples" placeholder="Để trống = thấy mọi dòng" />
                  <datalist id="filter-examples">
                    @for (f of examples; track f) {
                      <option [value]="f"></option>
                    }
                  </datalist>
                  <span class="hint">Hỗ trợ: cột = current_user_attr('faculty_code') · cột = 'X' · cột IN ('A','B')</span>
                </label>
              </div>
              <div>
                <div class="small muted" style="margin-bottom: 6px">Che cột (CLS)</div>
                @for (r of d.columnRules; track $index; let i = $index) {
                  <div class="row rule-row">
                    <select class="input" [(ngModel)]="r.column" [attr.aria-label]="'Cột ' + (i + 1)">
                      @for (c of columns(); track c.id) {
                        <option [value]="c.name">{{ c.name }} ({{ c.sensitivity }})</option>
                      }
                    </select>
                    <select class="input" [(ngModel)]="r.action" [attr.aria-label]="'Hành động ' + (i + 1)">
                      @for (a of actions; track a[0]) {
                        <option [value]="a[0]">{{ a[1] }}</option>
                      }
                    </select>
                    <button type="button" class="btn ghost sm" aria-label="Bỏ quy tắc" (click)="d.columnRules.splice(i, 1)">✕</button>
                  </div>
                }
                <button type="button" class="link-btn" [disabled]="!columns().length" (click)="d.columnRules.push({ column: columns()[0].name ?? '', action: 'MASK_PARTIAL' })">+ Quy tắc cột</button>
              </div>
              @if (d.id) {
                <label class="field"><span class="small muted">Ghi chú thay đổi</span><input class="input" [(ngModel)]="d.changeNote" placeholder="VD: Mở rộng cho khoa Kinh tế" /></label>
              }
              @if (formError()) {
                <div class="banner danger small" role="alert">{{ formError() }}</div>
              }
              <div class="row">
                <span class="spacer"></span>
                <button type="button" class="btn primary" (click)="save(d)">{{ d.id ? 'Lưu phiên bản mới' : 'Tạo chính sách' }}</button>
              </div>
            </section>

            <section class="card stack">
              <h2 class="card-title" style="margin: 0">Mô phỏng: xem như người dùng</h2>
              <div class="row">
                <select class="input grow" aria-label="Người dùng mô phỏng" [(ngModel)]="asUserId">
                  <option value="">— chọn người dùng —</option>
                  @for (u of users(); track u.id) {
                    <option [value]="u.id">{{ u.fullName }} · {{ u.orgUnit?.code }} · {{ roleText(u) }}</option>
                  }
                </select>
                <button type="button" class="btn" [disabled]="!asUserId || !d.datasetId" (click)="simulate(d)">Chạy mô phỏng</button>
              </div>
              @if (simError()) {
                <div class="banner danger small" role="alert">{{ simError() }}</div>
              }
              @if (sim(); as s) {
                <div class="small">Thấy <strong>{{ s.visibleRowCount }}</strong> / {{ s.totalRowCount }} dòng mẫu; cột có dấu 🔒 bị che.</div>
                <aiia-table [data]="s" caption="Kết quả mô phỏng (tối đa 20 dòng)" maxHeight="360px" />
              }
            </section>

            @if (versions().length) {
              <section class="card">
                <h2 class="card-title">Lịch sử phiên bản</h2>
                <table class="table">
                  <thead><tr><th>Phiên bản</th><th>Lọc dòng</th><th>Che cột</th><th>Ghi chú</th><th>Người sửa</th><th>Thời điểm</th></tr></thead>
                  <tbody>
                    @for (v of versions(); track v.version) {
                      <tr>
                        <td>v{{ v.version }}</td>
                        <td class="mono small">{{ v.rowFilter || '—' }}</td>
                        <td class="small">{{ rulesText(v) }}</td>
                        <td>{{ v.changeNote }}</td>
                        <td>{{ v.createdBy?.fullName }}</td>
                        <td>{{ v.createdAt | viDate: true }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </section>
            }
          </div>
        } @else {
          <section class="card main"><aiia-state message="Chọn một chính sách để xem hoặc sửa" /></section>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .layout {
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        gap: 16px;
        align-items: start;
      }
      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
      .item {
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
        padding: 10px 12px;
        border: 0;
        border-bottom: 1px solid var(--color-border);
        background: none;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .item.active {
        background: var(--color-accent-soft);
      }
      .main {
        min-width: 0;
      }
      .grow {
        flex: 1;
      }
      .rule-row {
        flex-wrap: nowrap;
        margin-bottom: 6px;
      }
      .rule-row .input {
        flex: 1;
      }
    `,
  ],
})
export class PoliciesPage {
  private readonly api = inject(AdminApi);
  private readonly catalog = inject(CatalogApi);
  private readonly toast = inject(ToastService);
  protected readonly roles = Object.entries(ROLE_LABELS) as [RoleCode, string][];
  protected readonly actions = ACTIONS;
  protected readonly examples = FILTER_EXAMPLES;
  protected readonly policies = loader<Policy[]>();
  protected readonly datasets = signal<Dataset[]>([]);
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly columns = signal<DatasetColumn[]>([]);
  protected readonly versions = signal<PolicyVersion[]>([]);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly sim = signal<(TabularResult & { visibleRowCount?: number; totalRowCount?: number }) | null>(null);
  protected readonly simError = signal<string | null>(null);
  private readonly datasetMap = computed(() => new Map(this.datasets().map((d) => [d.id, `${d.schemaName}.${d.tableName}`])));
  asUserId = '';

  constructor() {
    this.policies.load(this.api.policies());
    this.catalog.datasets({ pageSize: 100 }).subscribe((p) => this.datasets.set(p.items));
    this.api.users({ pageSize: 100, status: 'ACTIVE' }).subscribe((p) => this.users.set(p.items));
  }

  datasetName(id: number | undefined): string {
    return this.datasetMap().get(id) ?? `#${id}`;
  }

  roleText(u: AdminUser): string {
    return (u.roles ?? []).map((r) => ROLE_LABELS[r.role] ?? r.role).join(', ');
  }

  rulesText(v: PolicyVersion): string {
    return (v.columnRules ?? []).map((r) => `${r.column}: ${ACTIONS.find((a) => a[0] === r.action)?.[1] ?? r.action}`).join('; ') || '—';
  }

  private reset(): void {
    this.formError.set(null);
    this.sim.set(null);
    this.simError.set(null);
    this.versions.set([]);
  }

  newPolicy(): void {
    this.reset();
    this.columns.set([]);
    this.draft.set({ id: null, name: '', datasetId: 0, roleCode: 'REPORT_VIEWER', rowFilter: FILTER_EXAMPLES[0], columnRules: [], changeNote: '' });
  }

  select(p: Policy): void {
    this.reset();
    const v = p.currentVersion;
    this.draft.set({ id: p.id ?? null, name: p.name ?? '', datasetId: p.datasetId ?? 0, roleCode: p.roleCode ?? 'REPORT_VIEWER', rowFilter: v?.rowFilter ?? '', columnRules: (v?.columnRules ?? []).map((r) => ({ ...r })), changeNote: '' });
    this.loadColumns(p.datasetId ?? 0);
    if (p.id) this.api.policyVersions(p.id).subscribe((list) => this.versions.set(list));
  }

  pickDataset(d: Draft, id: number): void {
    d.datasetId = id;
    d.columnRules = [];
    this.loadColumns(id);
  }

  private loadColumns(id: number): void {
    this.columns.set([]);
    if (id) this.catalog.dataset(id).subscribe((ds) => this.columns.set(ds.columns ?? []));
  }

  save(d: Draft): void {
    this.formError.set(null);
    const rules = { rowFilter: d.rowFilter.trim() || null, columnRules: d.columnRules };
    const req: Observable<Policy | PolicyVersion> = d.id ? this.api.createPolicyVersion(d.id, { ...rules, changeNote: d.changeNote.trim() || undefined }) : this.api.createPolicy({ ...rules, name: d.name.trim(), datasetId: d.datasetId, roleCode: d.roleCode });
    req.subscribe({
      next: (res) => {
        this.toast.success(d.id ? 'Đã lưu phiên bản mới — áp dụng ngay cho truy vấn kế tiếp' : 'Đã tạo chính sách');
        this.policies.load(this.api.policies(), true);
        const id = d.id ?? ('id' in res ? res.id : null) ?? null;
        if (id) {
          this.draft.set({ ...d, id, changeNote: '' });
          this.api.policyVersions(id).subscribe((list) => this.versions.set(list));
        }
      },
      error: (e: unknown) => this.formError.set(problemMessage(toProblem(e))),
    });
  }

  simulate(d: Draft): void {
    this.sim.set(null);
    this.simError.set(null);
    this.api.simulate({ datasetId: d.datasetId, asUserId: this.asUserId, rowFilter: d.rowFilter.trim() || null, columnRules: d.columnRules }).subscribe({
      next: (r) => this.sim.set(r),
      error: (e: unknown) => this.simError.set(problemMessage(toProblem(e))),
    });
  }
}
