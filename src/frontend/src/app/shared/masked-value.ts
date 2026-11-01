import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { MaskableValue } from '../core/api/models';
import { type AccessTarget, DialogsService } from '../core/ui/dialogs.service';
import { formatCell } from './pipes';

/**
 * Giá trị có thể bị che (aiia-masked-value trong docs/04 §6.3): hiển thị dạng che + 🔒,
 * tooltip mức nhạy cảm, và nút “Yêu cầu quyền” khi có tài nguyên để xin.
 */
@Component({
  selector: 'aiia-masked',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (value(); as v) {
      @if (v.masked) {
        <span class="masked" [attr.title]="'Dữ liệu mức ' + v.sensitivity + ' — bạn chưa được xem giá trị này'">
          <span class="mono">{{ v.value ?? '••••' }}</span>
          <span aria-label="Bị khóa">🔒</span>
          @if (request(); as r) {
            <button type="button" class="link-btn small" (click)="dialogs.requestAccess(r)">Yêu cầu quyền</button>
          }
        </span>
      } @else {
        <span>{{ text(v) }}</span>
      }
    } @else {
      <span class="muted">—</span>
    }
  `,
  styles: [
    `
      .masked {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--color-muted);
      }
    `,
  ],
})
export class MaskedValueComponent {
  readonly value = input<MaskableValue | null | undefined>();
  readonly request = input<AccessTarget | null>(null);
  readonly unit = input<string | null>(null);
  protected readonly dialogs = inject(DialogsService);

  text(v: MaskableValue): string {
    return formatCell(v.value, this.unit());
  }
}
