import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, forkJoin, map, of, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CatalogApi, DashboardsApi, ProfilesApi } from '../core/api/services';
import { SessionService } from '../core/auth/session.service';
import { matchesQuery } from '../core/util/text';
import { ModalComponent } from '../shared/overlays';

interface Hit {
  group: 'Hồ sơ' | 'Dataset' | 'Dashboard';
  title: string;
  hint: string;
  link: (string | number)[];
}

/** Tìm kiếm toàn cục (Ctrl+K): gợi ý tức thì theo nhóm, chỉ trong phạm vi quyền. */
@Component({
  selector: 'aiia-global-search',
  standalone: true,
  imports: [ModalComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aiia-modal title="Tìm kiếm" (closed)="closed.emit()">
      <input
        #box
        class="input"
        style="width: 100%"
        placeholder="Tên, mã sinh viên/cán bộ, dataset, dashboard… (không cần dấu)"
        aria-label="Từ khóa tìm kiếm"
        [ngModel]="query()"
        (ngModelChange)="onQuery($event)"
        (keydown.enter)="openFirst()"
      />
      <div class="results" role="listbox" aria-label="Kết quả">
        @if (loading()) {
          <p class="muted small">Đang tìm…</p>
        }
        @for (group of groups; track group) {
          @if (byGroup(group).length) {
            <h3 class="small muted group">{{ group }}</h3>
            @for (h of byGroup(group); track $index) {
              <button type="button" class="hit" role="option" (click)="open(h)">
                <span>{{ h.title }}</span>
                <span class="small muted">{{ h.hint }}</span>
              </button>
            }
          }
        }
        @if (!loading() && query().length >= 2 && !hits().length) {
          <p class="muted small">Không có kết quả trong phạm vi quyền của bạn.</p>
        }
      </div>
    </aiia-modal>
  `,
  styles: [
    `
      .results {
        margin-top: 12px;
        max-height: 50vh;
        overflow-y: auto;
      }
      .group {
        margin: 10px 0 4px;
      }
      .hit {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        padding: 8px 10px;
        border: 0;
        border-radius: 6px;
        background: none;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .hit:hover,
      .hit:focus {
        background: var(--color-accent-soft);
      }
    `,
  ],
})
export class GlobalSearchComponent {
  readonly closed = output<void>();
  private readonly profiles = inject(ProfilesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly dashboards = inject(DashboardsApi);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  readonly groups = ['Hồ sơ', 'Dataset', 'Dashboard'] as const;
  protected readonly query = signal('');
  protected readonly hits = signal<Hit[]>([]);
  protected readonly loading = signal(false);
  private readonly input$ = new Subject<string>();

  constructor() {
    afterNextRender(() => this.box()?.nativeElement.focus());
    const canProfiles = this.session.hasAnyRole('REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD');
    this.input$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.trim().length < 2) return of([] as Hit[]);
          this.loading.set(true);
          return forkJoin({
            people: canProfiles ? this.profiles.search({ q, pageSize: 5 }).pipe(map((p) => p.items), catchError(() => of([]))) : of([]),
            datasets: this.catalog.datasets({ q, pageSize: 5 }).pipe(map((p) => p.items), catchError(() => of([]))),
            boards: this.dashboards.list().pipe(catchError(() => of([]))),
          }).pipe(
            map(({ people, datasets, boards }) => [
              ...people.map((p): Hit => ({ group: 'Hồ sơ', title: p.fullName ?? '', hint: `${p.code} · ${p.orgUnit?.name ?? ''}`, link: ['/profiles', p.personId ?? ''] })),
              ...datasets.map((d): Hit => ({ group: 'Dataset', title: d.displayName ?? '', hint: `${d.schemaName}.${d.tableName}`, link: ['/catalog/datasets', d.id ?? 0] })),
              ...boards.filter((b) => matchesQuery(b.title ?? '', q)).slice(0, 5).map((b): Hit => ({ group: 'Dashboard', title: b.title ?? '', hint: b.description ?? '', link: ['/dashboards', b.id ?? 0] })),
            ]),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((hits) => {
        this.loading.set(false);
        this.hits.set(hits);
      });
  }

  onQuery(q: string): void {
    this.query.set(q);
    this.input$.next(q);
  }

  byGroup(group: Hit['group']): Hit[] {
    return this.hits().filter((h) => h.group === group);
  }

  open(h: Hit): void {
    this.closed.emit();
    void this.router.navigate(h.link);
  }

  openFirst(): void {
    const first = this.hits()[0];
    if (first) this.open(first);
  }
}
