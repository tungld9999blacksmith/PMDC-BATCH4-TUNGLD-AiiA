import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { HealthService } from '../../core/api/health.service';
import type { HomeSummary } from '../../core/api/models';
import { MeApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { loader } from '../../shared/async';
import { FreshnessChipComponent, StatusBadgeComponent } from '../../shared/badges';
import { RelTimePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

/** P02 — Trang chủ theo vai trò. */
@Component({
  selector: 'aiia-home-page',
  standalone: true,
  imports: [RouterLink, FormsModule, StatusBadgeComponent, FreshnessChipComponent, StateViewComponent, RelTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack">
      <section class="hero card">
        <h1>Xin chào, {{ session.me()?.fullName }}</h1>
        <div class="row" style="margin-top: 12px">
          <form class="row grow" (ngSubmit)="search()">
            <input class="input grow" name="q" [(ngModel)]="q" placeholder="Tìm hồ sơ theo tên, mã, email (không cần dấu)…" aria-label="Tìm hồ sơ" />
            <button class="btn" type="submit">Tìm</button>
          </form>
          @if (canAsk()) {
            <form class="row grow" (ngSubmit)="ask()">
              <input class="input grow" name="question" [(ngModel)]="question" placeholder="Hỏi AiiA: Tỉ lệ cảnh báo học vụ theo khoa?" aria-label="Câu hỏi cho trợ lý" />
              <button class="btn primary" type="submit">✦ Hỏi</button>
            </form>
          }
        </div>
      </section>

      @switch (home.state().status) {
        @case ('loading') {
          <div class="card"><aiia-state kind="loading" /></div>
        }
        @case ('error') {
          <div class="card"><aiia-state kind="error" [message]="home.message()" actionLabel="Thử lại" (action)="reload()" /></div>
        }
        @case ('ready') {
          @if (home.data; as h) {
            <div class="grid cols-3">
              <div class="card kpi">
                <span class="label">Điểm chất lượng dữ liệu</span>
                <span class="value">{{ h.dataHealth?.dqScore }}%</span>
                @if (isData()) {
                  <a class="small" routerLink="/quality">Xem chất lượng &amp; issue</a>
                }
              </div>
              <div class="card kpi">
                <span class="label">Dataset vượt SLA độ mới</span>
                <span class="value" [class.warn]="(h.dataHealth?.staleDatasets ?? 0) > 0">{{ h.dataHealth?.staleDatasets }}</span>
                <a class="small" routerLink="/catalog">Mở catalog</a>
              </div>
              <div class="card kpi">
                <span class="label">Cảnh báo đang mở</span>
                <span class="value">{{ h.dataHealth?.openAlerts }}</span>
                <a class="small" routerLink="/alerts">Xem cảnh báo</a>
              </div>
            </div>

            @if (isSteward()) {
              <div class="grid cols-3">
                <a class="card kpi link-card" routerLink="/quality"><span class="label">Issue chất lượng đang mở</span><span class="value">{{ h.openIssues }}</span></a>
                <a class="card kpi link-card" routerLink="/identity"><span class="label">Cặp chờ đối soát</span><span class="value">{{ h.pendingMatches }}</span></a>
                <a class="card kpi link-card" routerLink="/access" [queryParams]="{ box: 'review' }"><span class="label">Yêu cầu truy cập chờ duyệt</span><span class="value">{{ h.pendingAccessReviews }}</span></a>
              </div>
            }

            <div class="grid cols-2">
              <section class="card">
                <div class="card-title"><h2>Dashboard yêu thích</h2><a class="small" routerLink="/dashboards">Tất cả</a></div>
                @for (d of h.favoriteDashboards ?? []; track d.id) {
                  <a class="item" [routerLink]="['/dashboards', d.id]">
                    <strong>{{ d.title }}</strong>
                    <aiia-freshness [freshness]="d.freshness" />
                  </a>
                } @empty {
                  <p class="muted small">Chưa có. Đánh dấu ★ trong thư viện dashboard để ghim tại đây.</p>
                }
              </section>
              <section class="card">
                <div class="card-title"><h2>Truy cập gần đây</h2></div>
                @for (r of h.recent ?? []; track $index) {
                  <a class="item" [routerLink]="recentLink(r)">
                    <span><span class="chip neutral">{{ kindText[r.kind ?? 'PROFILE'] }}</span> {{ r.title }}</span>
                    <span class="small muted">{{ r.viewedAt | relTime }}</span>
                  </a>
                } @empty {
                  <p class="muted small">Chưa có mục nào.</p>
                }
              </section>
            </div>

            @if ((h.failedRuns ?? []).length) {
              <section class="card">
                <div class="card-title"><h2>Lần chạy cần chú ý</h2><a class="small" routerLink="/runs">Giám sát pipeline</a></div>
                <table class="table">
                  <thead><tr><th>Nguồn</th><th>Trạng thái</th><th>Cách ly</th><th>Thời điểm</th></tr></thead>
                  <tbody>
                    @for (r of h.failedRuns ?? []; track r.id) {
                      <tr class="clickable" [routerLink]="['/runs', r.id]">
                        <td>{{ r.sourceCode }}</td>
                        <td><aiia-status [status]="r.status" /></td>
                        <td class="num">{{ r.rowsQuarantined }}</td>
                        <td>{{ r.queuedAt | relTime }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </section>
            }
          }
        }
      }

      <p class="small muted">
        Platform API:
        @switch (apiStatus()) {
          @case ('checking') { đang kiểm tra… }
          @case ('ok') { <span class="chip ok">hoạt động</span> }
          @default { <span class="chip neutral">không kết nối được — giao diện đang dùng mock API</span> }
        }
      </p>
    </div>
  `,
  styles: [
    `
      .hero h1 {
        font-size: 20px;
      }
      .grow {
        flex: 1;
        min-width: 260px;
      }
      .item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        border-bottom: 1px solid var(--color-border);
        color: inherit;
      }
      .item:last-child {
        border-bottom: 0;
      }
      .link-card {
        color: inherit;
      }
      .link-card:hover {
        border-color: var(--color-accent);
        text-decoration: none;
      }
      .warn {
        color: var(--color-warn);
      }
    `,
  ],
})
export class HomePage {
  protected readonly session = inject(SessionService);
  private readonly meApi = inject(MeApi);
  private readonly router = inject(Router);
  protected readonly home = loader<HomeSummary>();

  q = '';
  question = '';
  protected readonly kindText: Record<string, string> = { PROFILE: 'Hồ sơ', DASHBOARD: 'Dashboard', DATASET: 'Dataset' };
  protected readonly canAsk = computed(() => this.session.hasAnyRole('REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD'));
  protected readonly isSteward = computed(() => this.session.hasAnyRole('DATA_STEWARD'));
  protected readonly isData = computed(() => this.session.hasAnyRole('DATA_STEWARD', 'DATA_ENGINEER'));
  protected readonly apiStatus = toSignal(
    inject(HealthService).check().pipe(
      map((r) => (r.status === 'ok' ? 'ok' : 'down')),
      catchError(() => of('down')),
    ),
    { initialValue: 'checking' },
  );

  constructor() {
    this.reload();
  }

  reload(): void {
    this.home.load(this.meApi.home());
  }

  search(): void {
    void this.router.navigate(['/profiles'], { queryParams: { q: this.q || null } });
  }

  ask(): void {
    if (this.question.trim()) void this.router.navigate(['/assistant'], { queryParams: { q: this.question.trim() } });
  }

  recentLink(r: { kind?: string; id?: string }): (string | undefined)[] {
    if (r.kind === 'DASHBOARD') return ['/dashboards', r.id];
    if (r.kind === 'DATASET') return ['/catalog/datasets', r.id];
    return ['/profiles', r.id];
  }
}
