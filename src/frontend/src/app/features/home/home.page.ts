import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map } from 'rxjs/operators';
import { of } from 'rxjs';
import { HealthService } from '../../core/api/health.service';

@Component({
  selector: 'aiia-home-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>Trang chủ</h1>
      <p>
        Trạng thái Platform API:
        @if (apiStatus() === 'checking') {
          <span>đang kiểm tra…</span>
        } @else if (apiStatus() === 'ok') {
          <strong class="ok">hoạt động</strong>
        } @else {
          <strong class="warn">không kết nối được</strong>
        }
      </p>
    </main>
  `,
  styles: [`.ok { color: var(--color-ok); } .warn { color: var(--color-warn); }`],
})
export class HomePage {
  private readonly health = inject(HealthService);

  protected readonly apiStatus = toSignal(
    this.health.check().pipe(
      map((r) => (r.status === 'ok' ? 'ok' : 'unavailable')),
      catchError(() => of('unavailable'))
    ),
    { initialValue: 'checking' as 'checking' | 'ok' | 'unavailable' }
  );
}
