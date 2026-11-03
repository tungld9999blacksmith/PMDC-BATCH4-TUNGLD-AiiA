import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Dataset, GlossaryTerm, Page } from '../../core/api/models';
import { CatalogApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { loader } from '../../shared/async';
import { FreshnessChipComponent, LayerBadgeComponent } from '../../shared/badges';
import { ModalComponent, PageHeaderComponent, PagerComponent } from '../../shared/overlays';
import { StateViewComponent } from '../../shared/state-view';

/** P17 — Data catalog: tìm dataset và quản lý glossary (US12, US13). */
@Component({
  selector: 'aiia-catalog-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, PagerComponent, ModalComponent, StateViewComponent, LayerBadgeComponent, FreshnessChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Data catalog" subtitle="Tìm dataset theo tên, mô tả, thẻ; xem chủ sở hữu, độ tươi và mức nhạy cảm trước khi dùng." />
      <div class="tabs" role="tablist">
        <button type="button" role="tab" class="tab" [class.active]="activeTab() === 'datasets'" [attr.aria-selected]="activeTab() === 'datasets'" (click)="setTab('datasets')">Dataset</button>
        <button type="button" role="tab" class="tab" [class.active]="activeTab() === 'glossary'" [attr.aria-selected]="activeTab() === 'glossary'" (click)="setTab('glossary')">Glossary nghiệp vụ</button>
      </div>

      @if (activeTab() === 'datasets') {
        <form class="card row filters" (ngSubmit)="search()">
          <input class="input grow" name="q" placeholder="VD: học phí, sinh viên, gpa" aria-label="Tìm dataset" [(ngModel)]="q" />
          <select class="input" name="layer" aria-label="Tầng" [(ngModel)]="layer" (ngModelChange)="search()">
            <option value="">Mọi tầng</option>
            <option value="BRONZE">Bronze</option>
            <option value="SILVER">Silver</option>
            <option value="GOLD">Gold</option>
            <option value="QUARANTINE">Quarantine</option>
          </select>
          <select class="input" name="sens" aria-label="Có cột nhạy cảm" [(ngModel)]="sensitivity" (ngModelChange)="search()">
            <option value="">Mọi mức nhạy cảm</option>
            <option value="CONFIDENTIAL">Có cột Mật</option>
            <option value="RESTRICTED">Có cột Hạn chế</option>
          </select>
          <label class="row small"><input type="checkbox" name="acc" [(ngModel)]="accessible" (ngModelChange)="search()" /> Chỉ dataset tôi truy cập được</label>
          <button type="submit" class="btn">Tìm</button>
        </form>
        @switch (datasets.state().status) {
          @case ('loading') { <aiia-state kind="loading" /> }
          @case ('error') { <aiia-state kind="error" [message]="datasets.message()" actionLabel="Thử lại" (action)="search()" /> }
          @default {
            <div class="results">
              @for (d of datasets.data?.items ?? []; track d.id) {
                <article class="card ds">
                  <div class="row between">
                    <div class="row">
                      <aiia-layer [layer]="d.layer!" />
                      <a class="mono strong" [routerLink]="['/catalog/datasets', d.id]">{{ d.schemaName }}.{{ d.tableName }}</a>
                    </div>
                    <aiia-freshness [freshness]="d.freshness" />
                  </div>
                  <div><strong>{{ d.displayName }}</strong></div>
                  <p class="small muted desc">{{ d.description }}</p>
                  <div class="row small">
                    <span class="muted">Chủ sở hữu:</span> {{ d.owner?.fullName }}
                    <span class="muted">· Steward:</span> {{ d.steward?.fullName }}
                    <span class="spacer"></span>
                    @for (t of d.tags ?? []; track t) {
                      <span class="chip neutral">#{{ t }}</span>
                    }
                    @if (d.accessible === false) {
                      <button type="button" class="chip warn" (click)="requestAccess(d)">🔒 Yêu cầu quyền</button>
                    }
                  </div>
                </article>
              } @empty {
                <aiia-state message="Không tìm thấy dataset" detail="Thử từ khóa khác hoặc bỏ bộ lọc. Tìm kiếm không phân biệt dấu." />
              }
            </div>
            @if (datasets.data; as p) {
              <aiia-pager [page]="page()" [pageSize]="20" [total]="p.total" (pageChange)="page.set($event); load()" />
            }
          }
        }
      } @else {
        <div class="card row filters">
          <input class="input grow" placeholder="Tìm thuật ngữ" aria-label="Tìm thuật ngữ" [ngModel]="termQuery()" (ngModelChange)="termQuery.set($event)" />
          @if (isSteward) {
            <button type="button" class="btn primary" (click)="editTerm(null)">+ Thuật ngữ</button>
          }
        </div>
        <section class="card flush">
          @switch (glossary.state().status) {
            @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
            @case ('error') { <aiia-state kind="error" [message]="glossary.message()" /> }
            @default {
              <dl class="terms">
                @for (t of terms(); track t.id) {
                  <div class="term">
                    <dt>
                      <strong>{{ t.name }}</strong>
                      <span class="small muted">· {{ t.owner?.fullName }}</span>
                      @if (isSteward) {
                        <button type="button" class="link-btn small" (click)="editTerm(t)">Sửa</button>
                      }
                    </dt>
                    <dd>{{ t.definition }}</dd>
                  </div>
                } @empty {
                  <aiia-state message="Không có thuật ngữ phù hợp" />
                }
              </dl>
            }
          }
        </section>
      }

      @if (termForm(); as f) {
        <aiia-modal [title]="f.id ? 'Sửa thuật ngữ' : 'Thêm thuật ngữ'" (closed)="termForm.set(null)">
          <div class="stack">
            <label class="field"><span class="small muted">Tên *</span><input class="input" [(ngModel)]="f.name" /></label>
            <label class="field"><span class="small muted">Định nghĩa *</span><textarea class="input" [(ngModel)]="f.definition"></textarea></label>
            @if (termError()) {
              <div class="banner danger small" role="alert">{{ termError() }}</div>
            }
          </div>
          <div modal-foot class="modal-foot">
            <button type="button" class="btn" (click)="termForm.set(null)">Hủy</button>
            <button type="button" class="btn primary" (click)="saveTerm(f)">Lưu</button>
          </div>
        </aiia-modal>
      }
    </div>
  `,
  styles: [
    `
      .tabs {
        margin-bottom: 12px;
      }
      .filters {
        margin-bottom: 16px;
      }
      .grow {
        flex: 1;
        min-width: 200px;
      }
      .results {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .ds {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .strong {
        font-weight: 600;
      }
      .desc {
        margin: 0;
      }
      .terms {
        margin: 0;
      }
      .term {
        padding: 12px 16px;
        border-bottom: 1px solid var(--color-border);
      }
      .term dd {
        margin: 4px 0 0;
      }
    `,
  ],
})
export class CatalogPage {
  readonly tab = input<string | undefined>();

  private readonly api = inject(CatalogApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  protected readonly isSteward = inject(SessionService).hasAnyRole('DATA_STEWARD');
  protected readonly datasets = loader<Page<Dataset>>();
  protected readonly glossary = loader<GlossaryTerm[]>();
  protected readonly page = signal(1);
  protected readonly termQuery = signal('');
  protected readonly termForm = signal<{ id?: number; name: string; definition: string } | null>(null);
  protected readonly termError = signal<string | null>(null);
  protected readonly activeTab = computed(() => (this.tab() === 'glossary' ? 'glossary' : 'datasets'));
  protected readonly terms = computed(() => {
    const q = this.termQuery().toLowerCase();
    return (this.glossary.state().data ?? []).filter((t) => !q || `${t.name} ${t.definition}`.toLowerCase().includes(q));
  });
  q = '';
  layer = '';
  sensitivity = '';
  accessible = false;

  constructor() {
    effect(() => {
      const t = this.activeTab();
      untracked(() => {
        if (t === 'datasets' && this.datasets.state().status === 'idle') this.load();
        if (t === 'glossary' && this.glossary.state().status === 'idle') this.glossary.load(this.api.glossary());
      });
    });
  }

  setTab(tab: 'datasets' | 'glossary'): void {
    void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge' });
  }

  search(): void {
    this.page.set(1);
    this.load();
  }

  load(): void {
    this.datasets.load(
      this.api.datasets({ q: this.q || undefined, layer: this.layer || undefined, sensitivity: this.sensitivity || undefined, accessible: this.accessible || undefined, page: this.page(), pageSize: 20 }),
      true,
    );
  }

  requestAccess(d: Dataset): void {
    this.dialogs.requestAccess({ resourceType: 'DATASET', resourceId: String(d.id), resourceName: `${d.schemaName}.${d.tableName}` });
  }

  editTerm(t: GlossaryTerm | null): void {
    this.termError.set(null);
    this.termForm.set(t ? { id: t.id, name: t.name, definition: t.definition } : { name: '', definition: '' });
  }

  saveTerm(f: { id?: number; name: string; definition: string }): void {
    const req = f.id ? this.api.updateTerm(f.id, { name: f.name, definition: f.definition }) : this.api.createTerm({ name: f.name, definition: f.definition });
    req.subscribe({
      next: () => {
        this.termForm.set(null);
        this.toast.success('Đã lưu thuật ngữ');
        this.glossary.load(this.api.glossary(), true);
      },
      error: (e: unknown) => this.termError.set(problemMessage(toProblem(e))),
    });
  }
}
