import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AccessGrant, Subscription } from '../../core/api/models';
import { MeApi, ReportsApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ROLE_LABELS } from '../../core/util/labels';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { PageHeaderComponent } from '../../shared/overlays';
import { RelTimePipe, ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

/** P03 — Hồ sơ & quyền của tôi (US03, AC03). */
@Component({
  selector: 'aiia-me-page',
  standalone: true,
  imports: [RouterLink, PageHeaderComponent, StateViewComponent, StatusBadgeComponent, ViDatePipe, RelTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Hồ sơ & quyền của tôi" subtitle="Vai trò và phạm vi do quản trị hệ thống cấp; bạn không tự sửa được.">
        <button type="button" class="btn" (click)="session.logout()">Đăng xuất</button>
      </aiia-page-header>
      <div class="grid cols-2">
        <section class="card">
          <h2>Thông tin tài khoản</h2>
          <dl class="dl">
            <dt>Họ tên</dt><dd>{{ session.me()?.fullName }}</dd>
            <dt>Email</dt><dd>{{ session.me()?.email }}</dd>
            <dt>Đơn vị</dt><dd>{{ session.me()?.orgUnit?.name }}</dd>
          </dl>
        </section>
        <section class="card">
          <h2>Vai trò và phạm vi</h2>
          <ul class="plain">
            @for (r of session.me()?.roles ?? []; track $index) {
              <li><strong>{{ roleLabels[r.role] }}</strong> — {{ r.scopeOrgUnit ? 'phạm vi ' + r.scopeOrgUnit : 'toàn trường' }}</li>
            }
          </ul>
        </section>
      </div>

      <section class="card" style="margin-top: 16px">
        <div class="card-title">
          <h2>Quyền dữ liệu đang hiệu lực</h2>
          <a class="small" routerLink="/access">Yêu cầu của tôi</a>
        </div>
        @switch (grants.state().status) {
          @case ('loading') { <aiia-state kind="loading" /> }
          @case ('error') { <aiia-state kind="error" [message]="grants.message()" actionLabel="Thử lại" (action)="load()" /> }
          @default {
            @if (grants.data?.length) {
              <table class="table">
                <thead><tr><th>Tài nguyên</th><th>Loại</th><th>Mức</th><th>Hết hạn</th><th>Người duyệt</th><th></th></tr></thead>
                <tbody>
                  @for (g of grants.data; track g.id) {
                    <tr>
                      <td>{{ g.resourceName }}</td>
                      <td><span class="chip neutral">{{ g.resourceType }}</span></td>
                      <td>{{ g.accessLevel === 'EXPORT' ? 'Xem và xuất' : 'Xem' }}</td>
                      <td>{{ g.validTo | viDate }} <span class="small muted">({{ g.validTo | relTime }})</span></td>
                      <td>{{ g.grantedBy?.fullName }}</td>
                      <td><button type="button" class="link-btn small" (click)="renew(g)">Gia hạn</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <aiia-state kind="empty" message="Bạn chưa có quyền dữ liệu bổ sung" detail="Quyền theo vai trò vẫn áp dụng. Gặp dữ liệu bị khóa, bấm “Yêu cầu quyền” tại chỗ đó." />
            }
          }
        }
      </section>

      @if (canSubscribe()) {
        <section class="card" style="margin-top: 16px">
          <div class="card-title"><h2>Báo cáo đang nhận <span class="adv">ADV</span></h2><a class="small" routerLink="/reports">Quản lý</a></div>
          @for (s of subs.data ?? []; track s.id) {
            <div class="row between item"><span>Dashboard #{{ s.dashboardId }} · <span class="mono">{{ s.cron }}</span></span><aiia-status [status]="s.status" /></div>
          } @empty {
            <p class="muted small">Chưa đăng ký báo cáo định kỳ.</p>
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .dl {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 6px 12px;
        margin: 12px 0 0;
      }
      .dl dt {
        color: var(--color-muted);
      }
      .dl dd {
        margin: 0;
      }
      .plain {
        margin: 12px 0 0;
        padding-left: 18px;
      }
      .item {
        padding: 6px 0;
        border-bottom: 1px solid var(--color-border);
      }
    `,
  ],
})
export class MePage {
  protected readonly session = inject(SessionService);
  private readonly meApi = inject(MeApi);
  private readonly reports = inject(ReportsApi);
  private readonly dialogs = inject(DialogsService);
  protected readonly grants = loader<AccessGrant[]>();
  protected readonly subs = loader<Subscription[]>();
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly canSubscribe = computed(() => this.session.hasAnyRole('REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD'));

  constructor() {
    this.load();
    if (this.canSubscribe()) this.subs.load(this.reports.list());
  }

  load(): void {
    this.grants.load(this.meApi.grants());
  }

  renew(g: AccessGrant): void {
    if (g.resourceType && g.resourceId) this.dialogs.requestAccess({ resourceType: g.resourceType, resourceId: g.resourceId, resourceName: g.resourceName ?? g.resourceId });
  }
}
