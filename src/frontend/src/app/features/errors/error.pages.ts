import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** P04 — Không có quyền (403). Không tiết lộ nội dung được bảo vệ. */
@Component({
  selector: 'aiia-forbidden-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <section class="card center">
        <div class="code">403</div>
        <h1>Bạn không có quyền truy cập chức năng này</h1>
        <p class="muted">Vai trò hiện tại không bao gồm chức năng bạn vừa mở. Nếu cần cho công việc, liên hệ quản trị hệ thống để được cấp vai trò phù hợp.</p>
        <div class="row" style="justify-content: center">
          <a class="btn primary" routerLink="/">Về trang chủ</a>
          <a class="btn" routerLink="/me">Xem quyền của tôi</a>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .center {
        max-width: 560px;
        margin: 48px auto;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .code {
        font-size: 48px;
        font-weight: 800;
        color: var(--color-subtle);
      }
    `,
  ],
})
export class ForbiddenPage {}

@Component({
  selector: 'aiia-not-found-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <section class="card" style="max-width: 560px; margin: 48px auto; text-align: center">
        <div style="font-size: 48px; font-weight: 800; color: var(--color-subtle)">404</div>
        <h1>Không tìm thấy trang</h1>
        <p class="muted">Đường dẫn không tồn tại.</p>
        <a class="btn primary" routerLink="/">Về trang chủ</a>
      </section>
    </div>
  `,
})
export class NotFoundPage {}
