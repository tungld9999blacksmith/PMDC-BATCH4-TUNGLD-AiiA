import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { DEMO_ACCOUNTS } from '../../core/auth/demo-accounts';
import { SessionService } from '../../core/auth/session.service';
import { ROLE_LABELS } from '../../core/util/labels';

/** P01 — Đăng nhập. Chưa có SSO thật nên chế độ demo cho chọn tài khoản mẫu theo vai trò. */
@Component({
  selector: 'aiia-login-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <section class="panel card">
        <div class="brand"><span class="logo">◆</span> AiiA</div>
        <h1>Nền tảng Data Lakehouse hồ sơ 360°</h1>
        <p class="muted">
          Dữ liệu cá nhân của sinh viên, giảng viên, cán bộ chỉ được dùng đúng mục đích công việc. Mọi truy cập đều được ghi nhật ký.
        </p>
        <button type="button" class="btn primary sso" [disabled]="demo" (click)="sso()">Đăng nhập bằng tài khoản trường (SSO)</button>
        @if (demo) {
          <p class="small muted">SSO chưa được cấu hình trong môi trường này. Chọn một tài khoản mẫu bên dưới.</p>
        }
        @if (error()) {
          <div class="banner danger small" role="alert">{{ error() }}</div>
        }
      </section>

      @if (demo) {
        <section class="accounts" aria-label="Tài khoản mẫu">
          <h2>Chế độ demo — chọn vai trò</h2>
          <div class="grid cols-3">
            @for (a of accounts; track a.id) {
              <button type="button" class="account card" [disabled]="busy()" (click)="pick(a.id)">
                <strong>{{ a.fullName }}</strong>
                <span class="chip info">{{ roleText(a.roles) }}</span>
                <span class="small muted">{{ a.description }}</span>
              </button>
            }
          </div>
          <p class="small muted">Dữ liệu là tổng hợp (synthetic), chạy bằng mock API trong trình duyệt và được tạo lại khi tải lại trang.</p>
        </section>
      }
    </main>
  `,
  styles: [
    `
      .wrap {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 24px;
        padding: 48px 16px;
        background: linear-gradient(180deg, #e7f0fa 0%, var(--color-bg) 50%);
      }
      .panel {
        width: min(520px, 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .brand {
        font-size: 20px;
        font-weight: 800;
      }
      .logo {
        color: var(--color-accent);
      }
      .sso {
        height: 40px;
        justify-content: center;
      }
      .accounts {
        width: min(1040px, 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .account {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }
      .account:hover {
        border-color: var(--color-accent);
      }
    `,
  ],
})
export class LoginPage {
  readonly returnUrl = input<string>();
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly demo = environment.useMockApi;
  protected readonly accounts = DEMO_ACCOUNTS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  roleText(roles: { role: string; scopeOrgUnit: string | null }[]): string {
    return roles.map((r) => ROLE_LABELS[r.role] + (r.scopeOrgUnit ? ` · ${r.scopeOrgUnit}` : '')).join(', ');
  }

  pick(id: string): void {
    this.busy.set(true);
    this.error.set(null);
    this.session.loginDemo(id).subscribe((ok) => {
      this.busy.set(false);
      if (!ok) {
        this.error.set('Tài khoản đã bị khóa hoặc chưa được cấp vai trò (AC01.2).');
        return;
      }
      void this.router.navigateByUrl(this.returnUrl() || '/');
    });
  }

  sso(): void {
    // Luồng OIDC (Keycloak) sẽ chuyển hướng tới IdP; cấu hình ở bản triển khai thật.
    this.error.set('SSO chưa được cấu hình.');
  }
}
