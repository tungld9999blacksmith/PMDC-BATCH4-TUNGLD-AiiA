import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type StateKind = 'loading' | 'empty' | 'error' | 'forbidden' | 'locked';

const ICON: Record<StateKind, string> = { loading: '', empty: '📭', error: '⚠️', forbidden: '⛔', locked: '🔒' };

/** Trạng thái màn hình chuẩn (docs/04 §5): đang tải, rỗng, lỗi, không có quyền, bị khóa. */
@Component({
  selector: 'aiia-state',
  standalone: true,
  host: { '[attr.data-kind]': 'kind()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (kind() === 'loading') {
      <div class="stack" style="gap: 10px" aria-busy="true" aria-label="Đang tải">
        @for (i of rows; track i) {
          <div class="skeleton" [style.width.%]="90 - i * 12" style="height: 16px"></div>
        }
      </div>
    } @else {
      <div class="state" role="status">
        <div class="icon" aria-hidden="true">{{ icon[kind()] }}</div>
        <div class="message">{{ message() }}</div>
        @if (detail()) {
          <div class="small muted">{{ detail() }}</div>
        }
        @if (actionLabel()) {
          <button type="button" class="btn sm" [class.primary]="kind() === 'locked'" (click)="action.emit()">{{ actionLabel() }}</button>
        }
      </div>
    }
  `,
  styles: [
    `
      .state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 28px 16px;
        text-align: center;
      }
      .icon {
        font-size: 28px;
      }
      .message {
        font-weight: 600;
      }
    `,
  ],
})
export class StateViewComponent {
  readonly kind = input<StateKind>('empty');
  readonly message = input('');
  readonly detail = input<string | null | undefined>(null);
  readonly actionLabel = input<string | null>(null);
  readonly action = output<void>();
  readonly icon = ICON;
  readonly rows = [0, 1, 2, 3];
}
