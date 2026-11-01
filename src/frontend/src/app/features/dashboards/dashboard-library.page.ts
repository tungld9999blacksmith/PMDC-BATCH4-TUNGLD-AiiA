import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { DashboardSummary, DashboardTopic } from '../../core/api/models';
import { DashboardsApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { TOPIC_LABELS } from '../../core/util/labels';
import { matchesQuery } from '../../core/util/text';
import { loader } from '../../shared/async';
import { FreshnessChipComponent, StatusBadgeComponent } from '../../shared/badges';
import { PageHeaderComponent } from '../../shared/overlays';
import { StateViewComponent } from '../../shared/state-view';

/** P07 — Thư viện dashboard (US26): chỉ dashboard được chia sẻ cho tôi và bản nháp của tôi. */
@Component({
  selector: 'aiia-dashboard-library-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, StateViewComponent, FreshnessChipComponent, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Thư viện dashboard" subtitle="Số liệu trong mỗi dashboard được lọc theo phạm vi quyền của chính bạn.">
        @if (isAnalyst()) {
          <a class="btn primary" routerLink="/dashboards/new">+ Tạo dashboard</a>
        }
      </aiia-page-header>

      <div class="row toolbar">
        <input class="input" style="min-width: 260px" placeholder="Tìm dashboard…" aria-label="Tìm dashboard" [ngModel]="q()" (ngModelChange)="q.set($event)" />
        <button type="button" class="chip selectable" [class.on]="!topic()" (click)="topic.set(null)">Tất cả</button>
        @for (t of topics; track t[0]) {
          <button type="button" class="chip selectable" [class.on]="topic() === t[0]" (click)="topic.set(t[0])">{{ t[1] }}</button>
        }
        <span class="spacer"></span>
        <label class="row small"><input type="checkbox" [ngModel]="favOnly()" (ngModelChange)="favOnly.set($event)" /> Chỉ yêu thích</label>
        @if (isAnalyst()) {
          <label class="row small"><input type="checkbox" [ngModel]="mine()" (ngModelChange)="mine.set($event)" /> Của tôi</label>
        }
      </div>

      @switch (list.state().status) {
        @case ('loading') { <div class="card"><aiia-state kind="loading" /></div> }
        @case ('error') { <div class="card"><aiia-state kind="error" [message]="list.message()" actionLabel="Thử lại" (action)="load()" /></div> }
        @default {
          @if (filtered().length) {
            <div class="grid cols-3">
              @for (d of filtered(); track d.id) {
                <article class="card board">
                  <div class="row between">
                    <span class="chip info">{{ topicLabels[d.topic ?? ''] }}</span>
                    <button type="button" class="btn ghost sm star" [attr.aria-pressed]="d.favorite" [attr.aria-label]="d.favorite ? 'Bỏ yêu thích' : 'Yêu thích'" (click)="toggleFavorite(d)">{{ d.favorite ? '★' : '☆' }}</button>
                  </div>
                  <a class="title" [routerLink]="['/dashboards', d.id]"><h2>{{ d.title }}</h2></a>
                  <p class="muted small desc">{{ d.description }}</p>
                  <div class="row between">
                    <span class="small muted">{{ d.owner?.fullName }}</span>
                    @if (d.status !== 'PUBLISHED') {
                      <aiia-status [status]="d.status" />
                    }
                  </div>
                  <aiia-freshness [freshness]="d.freshness" />
                </article>
              }
            </div>
          } @else {
            <div class="card">
              <aiia-state kind="empty" message="Chưa có dashboard phù hợp" detail="Nếu cần một dashboard chưa được chia sẻ, liên hệ chuyên viên phân tích hoặc gửi yêu cầu truy cập." />
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .toolbar {
        margin-bottom: 16px;
      }
      .board {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .title {
        color: inherit;
      }
      .desc {
        margin: 0;
        min-height: 40px;
      }
      .star {
        font-size: 18px;
        color: #f59f00;
      }
    `,
  ],
})
export class DashboardLibraryPage {
  private readonly api = inject(DashboardsApi);
  private readonly session = inject(SessionService);
  protected readonly list = loader<DashboardSummary[]>();
  protected readonly q = signal('');
  protected readonly topic = signal<DashboardTopic | null>(null);
  protected readonly favOnly = signal(false);
  protected readonly mine = signal(false);
  protected readonly topicLabels = TOPIC_LABELS;
  protected readonly topics = Object.entries(TOPIC_LABELS) as [DashboardTopic, string][];
  protected readonly isAnalyst = computed(() => this.session.hasAnyRole('BI_ANALYST'));
  protected readonly filtered = computed(() =>
    (this.list.state().data ?? [])
      .filter((d) => !this.q() || matchesQuery(`${d.title} ${d.description}`, this.q()))
      .filter((d) => !this.topic() || d.topic === this.topic())
      .filter((d) => !this.favOnly() || d.favorite)
      .filter((d) => !this.mine() || d.owner?.id === this.session.me()?.id),
  );

  constructor() {
    this.load();
  }

  load(): void {
    this.list.load(this.api.list(), true);
  }

  toggleFavorite(d: DashboardSummary): void {
    if (!d.id) return;
    const on = !d.favorite;
    this.api.favorite(d.id, on).subscribe(() => this.list.set((this.list.state().data ?? []).map((x) => (x.id === d.id ? { ...x, favorite: on } : x))));
  }
}
