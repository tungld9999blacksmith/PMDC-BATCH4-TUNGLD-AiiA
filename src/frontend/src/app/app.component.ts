import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'aiia-root',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="app-header">
      <strong>AiiA</strong> · Nền tảng Data Lakehouse hồ sơ 360°
    </header>
    <router-outlet />
  `,
  styles: [
    `
      .app-header {
        padding: 12px 16px;
        border-bottom: 1px solid #e2e8f0;
        background: #f8fafc;
      }
    `,
  ],
})
export class AppComponent {}
