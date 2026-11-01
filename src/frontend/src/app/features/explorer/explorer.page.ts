import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { DataLayer, Dataset, Page, TabularResult } from '../../core/api/models';
import { CatalogApi } from '../../core/api/services';
import { matchesQuery } from '../../core/util/text';
import { loader } from '../../shared/async';
import { FreshnessChipComponent, LayerBadgeComponent } from '../../shared/badges';
import { DataTableComponent } from '../../shared/data-table';
import { PageHeaderComponent } from '../../shared/overlays';
import { StateViewComponent } from '../../shared/state-view';

const LAYERS: DataLayer[] = ['BRONZE', 'SILVER', 'GOLD', 'QUARANTINE'];

/** P16 — Data explorer: duyệt dataset theo tầng và xem mẫu dữ liệu đã áp chính sách (US11). */
@Component({
  selector: 'aiia-explorer-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, StateViewComponent, LayerBadgeComponent, FreshnessChipComponent, DataTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Data explorer" subtitle="Xem mẫu dữ liệu từng tầng của lakehouse. Cột nhạy cảm được che theo chính sách của bạn; mọi lượt xem đều ghi nhật ký." />
      <div class="layout">
        <aside class="card side">
          <div class="tabs" role="tablist" aria-label="Tầng dữ liệu">
            @for (l of layers; track l) {
              <button type="button" role="tab" class="tab" [class.active]="currentLayer() === l" [attr.aria-selected]="currentLayer() === l" (click)="setLayer(l)">{{ l }}</button>
            }
          </div>
          <input class="input" placeholder="Lọc dataset" aria-label="Lọc dataset" [ngModel]="filter()" (ngModelChange)="filter.set($event)" />
          @switch (datasets.state().status) {
            @case ('loading') { <aiia-state kind="loading" /> }
            @case ('error') { <aiia-state kind="error" [message]="datasets.message()" /> }
            @default {
              <ul class="list">
                @for (d of visible(); track d.id) {
                  <li>
                    <button type="button" [class.active]="d.id === selectedId()" (click)="select(d)">
                      <span class="mono">{{ d.tableName }}</span>
                      <span class="small muted">{{ d.displayName }}</span>
                    </button>
                  </li>
                } @empty {
                  <li class="small muted">Không có dataset.</li>
                }
              </ul>
            }
          }
        </aside>

        <section class="card main">
          @if (selected(); as d) {
            <div class="row between">
              <div>
                <div class="row"><aiia-layer [layer]="d.layer!" /> <h2 style="margin: 0" class="mono">{{ d.schemaName }}.{{ d.tableName }}</h2></div>
                <p class="small muted" style="margin: 4px 0 0">{{ d.description }}</p>
              </div>
              <div class="row">
                <aiia-freshness [freshness]="d.freshness" />
                <a class="btn sm" [routerLink]="['/catalog/datasets', d.id]">Mở trong catalog</a>
              </div>
            </div>
            <div class="row" style="margin: 12px 0">
              <label class="row small">Số dòng
                <select class="input" [ngModel]="limit()" (ngModelChange)="limit.set($event); loadPreview()">
                  <option [ngValue]="20">20</option>
                  <option [ngValue]="50">50</option>
                  <option [ngValue]="100">100</option>
                </select>
              </label>
              <button type="button" class="btn sm" (click)="loadPreview()">Làm mới</button>
              @if (maskedCount()) {
                <span class="chip warn">{{ maskedCount() }} cột bị che theo chính sách</span>
              }
            </div>
            @switch (preview.state().status) {
              @case ('loading') { <aiia-state kind="loading" /> }
              @case ('error') {
                <aiia-state [kind]="preview.state().error?.status === 403 ? 'forbidden' : 'error'" [message]="preview.message()" />
              }
              @default {
                <aiia-table [data]="preview.data" [caption]="'Mẫu ' + limit() + ' dòng'" maxHeight="60vh" />
              }
            }
          } @else {
            <aiia-state message="Chọn một dataset để xem mẫu dữ liệu" />
          }
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      .layout {
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        gap: 16px;
      }
      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
      .side {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: calc(100vh - 200px);
        overflow-y: auto;
      }
      .side .tabs {
        flex-wrap: wrap;
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .list button {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 100%;
        padding: 6px 8px;
        border: 0;
        border-radius: 6px;
        background: none;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .list button:hover {
        background: var(--color-bg);
      }
      .list button.active {
        background: var(--color-accent-soft);
      }
      .main {
        min-width: 0;
      }
    `,
  ],
})
export class ExplorerPage {
  readonly layer = input<string | undefined>();
  readonly dataset = input<string | undefined>();

  private readonly api = inject(CatalogApi);
  private readonly router = inject(Router);
  protected readonly layers = LAYERS;
  protected readonly datasets = loader<Page<Dataset>>();
  protected readonly preview = loader<TabularResult>();
  protected readonly filter = signal('');
  protected readonly limit = signal(20);
  protected readonly currentLayer = computed<DataLayer>(() => (LAYERS.includes(this.layer() as DataLayer) ? (this.layer() as DataLayer) : 'SILVER'));
  protected readonly selectedId = computed(() => (this.dataset() ? Number(this.dataset()) : null));
  protected readonly visible = computed(() => {
    const q = this.filter();
    return (this.datasets.state().data?.items ?? []).filter((d) => !q || matchesQuery(`${d.tableName} ${d.displayName}`, q));
  });
  protected readonly selected = computed(() => this.visible().find((d) => d.id === this.selectedId()) ?? null);
  protected readonly maskedCount = computed(() => (this.preview.state().data?.columns ?? []).filter((c) => c.masked).length);

  constructor() {
    effect(() => {
      const layer = this.currentLayer();
      untracked(() => this.datasets.load(this.api.datasets({ layer, pageSize: 100 })));
    });
    effect(() => {
      const id = this.selectedId();
      untracked(() => (id ? this.loadPreview() : undefined));
    });
  }

  setLayer(layer: DataLayer): void {
    void this.router.navigate([], { queryParams: { layer, dataset: null }, queryParamsHandling: 'merge' });
  }

  select(d: Dataset): void {
    void this.router.navigate([], { queryParams: { dataset: d.id }, queryParamsHandling: 'merge' });
  }

  loadPreview(): void {
    const id = this.selectedId();
    if (id) this.preview.load(this.api.preview(id, { limit: this.limit() }));
  }
}
