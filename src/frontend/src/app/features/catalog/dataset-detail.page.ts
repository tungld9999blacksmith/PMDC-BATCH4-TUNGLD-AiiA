import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { DatasetColumn, DatasetDetail, DqIssue, DqRule, GlossaryTerm, LineageGraph, Page, Sensitivity, TabularResult } from '../../core/api/models';
import { CatalogApi, OpsApi, QualityApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { loader } from '../../shared/async';
import { FreshnessChipComponent, LayerBadgeComponent, SensitivityBadgeComponent, StatusBadgeComponent } from '../../shared/badges';
import { DataTableComponent } from '../../shared/data-table';
import { PageHeaderComponent } from '../../shared/overlays';
import { LabelPipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

type Tab = 'schema' | 'quality' | 'lineage' | 'usage' | 'preview';
const TABS: [Tab, string][] = [
  ['schema', 'Schema'],
  ['quality', 'Chất lượng'],
  ['lineage', 'Lineage'],
  ['usage', 'Sử dụng'],
  ['preview', 'Xem mẫu'],
];
const SENSITIVITIES: Sensitivity[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

/** P18 — Chi tiết dataset: schema, độ nhạy cột, chất lượng, lineage, nơi sử dụng (US12, US14). */
@Component({
  selector: 'aiia-dataset-detail-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, StateViewComponent, DataTableComponent, LayerBadgeComponent, SensitivityBadgeComponent, StatusBadgeComponent, FreshnessChipComponent, LabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @switch (ds.state().status) {
        @case ('loading') { <aiia-state kind="loading" /> }
        @case ('error') {
          <aiia-state [kind]="ds.state().error?.status === 403 ? 'forbidden' : 'error'" [message]="ds.message()" actionLabel="Về catalog" (action)="back()" />
        }
        @default {
          @if (ds.data; as d) {
            <aiia-page-header [title]="d.displayName ?? ''" [subtitle]="d.description" [crumbs]="[{ label: 'Data catalog', link: '/catalog' }, { label: d.schemaName + '.' + d.tableName }]">
              @if (d.accessible === false) {
                <button type="button" class="btn primary" (click)="requestAccess(d)">Yêu cầu quyền truy cập</button>
              }
            </aiia-page-header>
            <div class="card row meta">
              <aiia-layer [layer]="d.layer!" />
              <span class="mono">{{ d.schemaName }}.{{ d.tableName }}</span>
              <aiia-freshness [freshness]="d.freshness" />
              <span class="small"><span class="muted">Dòng:</span> {{ d.rowCount?.toLocaleString('vi-VN') }}</span>
              <span class="small"><span class="muted">SLA độ tươi:</span> {{ slaText(d.freshnessSlaMinutes) }}</span>
              <span class="small"><span class="muted">Chủ sở hữu:</span> {{ d.owner?.fullName }}</span>
              <span class="small"><span class="muted">Steward:</span> {{ d.steward?.fullName }}</span>
            </div>

            <div class="tabs" role="tablist">
              @for (t of tabs; track t[0]) {
                <button type="button" role="tab" class="tab" [class.active]="activeTab() === t[0]" [attr.aria-selected]="activeTab() === t[0]" (click)="setTab(t[0])">{{ t[1] }}</button>
              }
            </div>

            <section class="card flush">
              @switch (activeTab()) {
                @case ('schema') {
                  <div class="table-wrap">
                    <table class="table">
                      <thead><tr><th>Cột</th><th>Kiểu</th><th>Mô tả</th><th>Độ nhạy</th><th>Thuật ngữ</th></tr></thead>
                      <tbody>
                        @for (c of d.columns ?? []; track c.id) {
                          <tr>
                            <td class="mono">{{ c.name }}</td>
                            <td class="small muted">{{ c.dataType }}</td>
                            <td>{{ c.description }}</td>
                            <td>
                              @if (isSteward) {
                                <select class="input sm" [ngModel]="c.sensitivity" (ngModelChange)="changeSensitivity(c, $event)" [attr.aria-label]="'Độ nhạy của ' + c.name">
                                  @for (s of sensitivities; track s) {
                                    <option [value]="s">{{ s }}</option>
                                  }
                                </select>
                              } @else {
                                <aiia-sens [level]="c.sensitivity!" />
                              }
                            </td>
                            <td>
                              @if (isSteward) {
                                <select class="input sm" [ngModel]="c.glossaryTerm?.id ?? null" (ngModelChange)="changeTerm(c, $event)" [attr.aria-label]="'Thuật ngữ của ' + c.name">
                                  <option [ngValue]="null">—</option>
                                  @for (g of glossary(); track g.id) {
                                    <option [ngValue]="g.id">{{ g.name }}</option>
                                  }
                                </select>
                              } @else {
                                <span [title]="c.glossaryTerm?.definition ?? ''">{{ c.glossaryTerm?.name ?? '—' }}</span>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  @if (isSteward) {
                    <p class="small muted pad">Thay đổi độ nhạy có hiệu lực ngay với chính sách che cột và được ghi nhật ký kiểm toán.</p>
                  }
                }
                @case ('quality') {
                  @if (rules.state().status === 'error') {
                    <aiia-state [kind]="rules.state().error?.status === 403 ? 'forbidden' : 'error'" [message]="rules.message()" />
                  } @else {
                    <div class="pad stack">
                      <div class="row between">
                        <h3 style="margin: 0">Quy tắc đang áp dụng</h3>
                        <a class="btn sm" routerLink="/quality/rules" [queryParams]="{ datasetId: d.id }">Quản lý quy tắc</a>
                      </div>
                      <table class="table">
                        <thead><tr><th>Quy tắc</th><th>Chiều</th><th>Mức</th><th class="num">Tỉ lệ đạt</th><th>Trạng thái</th></tr></thead>
                        <tbody>
                          @for (r of rules.data ?? []; track r.id) {
                            <tr>
                              <td>{{ r.description }}</td>
                              <td>{{ r.dimension | label: 'dimension' }}</td>
                              <td><aiia-status [status]="r.severity" /></td>
                              <td class="num">{{ r.lastPassRate === null || r.lastPassRate === undefined ? '—' : r.lastPassRate + '%' }}</td>
                              <td><aiia-status [status]="r.status" /></td>
                            </tr>
                          } @empty {
                            <tr><td colspan="5" class="muted">Chưa có quy tắc cho dataset này.</td></tr>
                          }
                        </tbody>
                      </table>
                      <h3 style="margin: 0">Issue đang mở</h3>
                      @for (i of openIssues(); track i.id) {
                        <a class="issue" routerLink="/quality" [queryParams]="{ issue: i.id }">
                          <aiia-status [status]="i.severity" /> {{ i.rule?.description }} · {{ i.affectedRows }} dòng · <aiia-status [status]="i.status" />
                        </a>
                      } @empty {
                        <p class="small muted" style="margin: 0">Không có issue đang mở.</p>
                      }
                    </div>
                  }
                }
                @case ('lineage') {
                  <div class="pad stack">
                    @if (lineage(); as g) {
                      <div class="grid cols-2">
                        <div>
                          <h3>Nguồn phía trước</h3>
                          <ul class="nodes">
                            @for (n of upstream(); track n.id) {
                              <li><a [routerLink]="['/lineage']" [queryParams]="{ nodeType: n.type, refId: n.refId }">{{ n.type | label: 'node' }} · {{ n.name }}</a></li>
                            } @empty {
                              <li class="muted small">Không có.</li>
                            }
                          </ul>
                        </div>
                        <div>
                          <h3>Phụ thuộc phía sau</h3>
                          <ul class="nodes">
                            @for (n of downstream(); track n.id) {
                              <li><a [routerLink]="['/lineage']" [queryParams]="{ nodeType: n.type, refId: n.refId }">{{ n.type | label: 'node' }} · {{ n.name }}</a></li>
                            } @empty {
                              <li class="muted small">Không có.</li>
                            }
                          </ul>
                        </div>
                      </div>
                      <div><a class="btn sm" [routerLink]="['/lineage']" [queryParams]="{ nodeType: 'DATASET', refId: d.id }">Mở đồ thị lineage đầy đủ</a></div>
                    } @else if (lineageError()) {
                      <aiia-state kind="error" [message]="lineageError()!" />
                    } @else {
                      <aiia-state kind="loading" />
                    }
                  </div>
                }
                @case ('usage') {
                  <div class="pad grid cols-2">
                    <div>
                      <h3>Metric dùng dataset này</h3>
                      <ul class="nodes">
                        @for (m of d.usedBy?.metrics ?? []; track m) {
                          <li><a routerLink="/semantic" [queryParams]="{ metric: m }" class="mono">{{ m }}</a></li>
                        } @empty {
                          <li class="muted small">Chưa có metric.</li>
                        }
                      </ul>
                    </div>
                    <div>
                      <h3>Dashboard</h3>
                      <ul class="nodes">
                        @for (b of d.usedBy?.dashboards ?? []; track b.id) {
                          <li><a [routerLink]="['/dashboards', b.id]">{{ b.title }}</a></li>
                        } @empty {
                          <li class="muted small">Chưa có dashboard bạn xem được.</li>
                        }
                      </ul>
                    </div>
                  </div>
                }
                @case ('preview') {
                  @switch (preview.state().status) {
                    @case ('loading') { <div class="pad"><aiia-state kind="loading" /></div> }
                    @case ('error') {
                      <aiia-state [kind]="preview.state().error?.status === 403 ? 'forbidden' : 'error'" [message]="preview.message()" [detail]="preview.state().error?.status === 403 ? 'Xem mẫu dữ liệu dành cho Data Engineer và Data Steward.' : null" />
                    }
                    @default {
                      <aiia-table [data]="preview.data" caption="20 dòng mẫu (đã áp chính sách che cột)" maxHeight="60vh" />
                    }
                  }
                }
              }
            </section>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .meta {
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      .tabs {
        margin-bottom: 12px;
      }
      .pad {
        padding: 16px;
      }
      .input.sm {
        height: 28px;
      }
      .nodes {
        margin: 0;
        padding-left: 18px;
      }
      .issue {
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 6px 0;
        color: inherit;
      }
    `,
  ],
})
export class DatasetDetailPage {
  readonly id = input.required<string>();
  readonly tab = input<string | undefined>();

  private readonly api = inject(CatalogApi);
  private readonly quality = inject(QualityApi);
  private readonly ops = inject(OpsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  protected readonly isSteward = inject(SessionService).hasAnyRole('DATA_STEWARD');
  protected readonly tabs = TABS;
  protected readonly sensitivities = SENSITIVITIES;
  protected readonly ds = loader<DatasetDetail>();
  protected readonly rules = loader<DqRule[]>();
  protected readonly issues = loader<Page<DqIssue>>();
  protected readonly preview = loader<TabularResult>();
  protected readonly glossary = signal<GlossaryTerm[]>([]);
  protected readonly lineage = signal<LineageGraph | null>(null);
  protected readonly lineageError = signal<string | null>(null);
  protected readonly activeTab = computed<Tab>(() => (TABS.some((t) => t[0] === this.tab()) ? (this.tab() as Tab) : 'schema'));
  protected readonly openIssues = computed(() => (this.issues.state().data?.items ?? []).filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS'));
  protected readonly upstream = computed(() => this.neighbours('up'));
  protected readonly downstream = computed(() => this.neighbours('down'));

  constructor() {
    effect(() => {
      const id = Number(this.id());
      untracked(() => {
        this.ds.load(this.api.dataset(id));
        this.lineage.set(null);
        this.rules.state.set({ status: 'idle', data: null, error: null });
        this.preview.state.set({ status: 'idle', data: null, error: null });
      });
    });
    effect(() => {
      const tab = this.activeTab();
      const id = Number(this.id());
      untracked(() => this.loadTab(tab, id));
    });
    if (this.isSteward) this.api.glossary().subscribe((g) => this.glossary.set(g));
  }

  private loadTab(tab: Tab, id: number): void {
    if (tab === 'quality' && this.rules.state().status === 'idle') {
      this.rules.load(this.quality.rules({ datasetId: id }));
      this.issues.load(this.quality.issues({ datasetId: id, pageSize: 50 }));
    }
    if (tab === 'lineage' && !this.lineage()) {
      this.lineageError.set(null);
      this.ops.lineage({ nodeType: 'DATASET', refId: String(id), direction: 'BOTH', depth: 1 }).subscribe({
        next: (g) => this.lineage.set(g),
        error: (e: unknown) => this.lineageError.set(problemMessage(toProblem(e))),
      });
    }
    if (tab === 'preview' && this.preview.state().status === 'idle') this.preview.load(this.api.preview(id, { limit: 20 }));
  }

  private neighbours(dir: 'up' | 'down') {
    const g = this.lineage();
    const center = g?.center?.id;
    if (!g || center === undefined) return [];
    const ids = new Set((g.edges ?? []).filter((e) => (dir === 'up' ? e.to === center : e.from === center)).map((e) => (dir === 'up' ? e.from : e.to)));
    return (g.nodes ?? []).filter((n) => ids.has(n.id));
  }

  setTab(tab: Tab): void {
    void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  back(): void {
    void this.router.navigate(['/catalog']);
  }

  slaText(min: number | undefined): string {
    if (!min) return '—';
    return min >= 1440 ? `${Math.round(min / 1440)} ngày` : `${Math.round(min / 60)} giờ`;
  }

  requestAccess(d: DatasetDetail): void {
    this.dialogs.requestAccess({ resourceType: 'DATASET', resourceId: String(d.id), resourceName: `${d.schemaName}.${d.tableName}` });
  }

  async changeSensitivity(c: DatasetColumn, level: Sensitivity): Promise<void> {
    const d = this.ds.data;
    if (!d?.id || !c.id || level === c.sensitivity) return;
    const lowering = SENSITIVITIES.indexOf(level) < SENSITIVITIES.indexOf(c.sensitivity ?? 'PUBLIC');
    if (lowering) {
      const ok = await this.dialogs.confirm({
        title: 'Hạ mức nhạy cảm',
        message: `Cột ${c.name} sẽ chuyển từ ${c.sensitivity} xuống ${level}; người dùng có thể thấy giá trị không còn bị che.`,
        confirmLabel: 'Hạ mức',
        danger: true,
      });
      if (!ok) {
        this.ds.set({ ...d });
        return;
      }
    }
    this.patchColumn(d.id, c.id, { sensitivity: level });
  }

  changeTerm(c: DatasetColumn, termId: number | null): void {
    const d = this.ds.data;
    if (d?.id && c.id) this.patchColumn(d.id, c.id, { glossaryTermId: termId });
  }

  private patchColumn(datasetId: number, columnId: number, patch: { sensitivity?: Sensitivity; glossaryTermId?: number | null }): void {
    this.api.updateColumn(datasetId, columnId, patch).subscribe({
      next: (col) => {
        const d = this.ds.data;
        if (d) this.ds.set({ ...d, columns: (d.columns ?? []).map((x) => (x.id === col.id ? col : x)) });
        this.toast.success('Đã cập nhật cột');
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }
}
