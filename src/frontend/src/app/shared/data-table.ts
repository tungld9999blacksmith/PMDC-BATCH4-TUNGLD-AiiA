import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { TabularResult } from '../core/api/models';
import { isSuppressed } from '../core/api/models';
import { formatCell } from './pipes';

/** Bảng cho TabularResult: cột bị che có 🔒, ô nhóm nhỏ hiển thị “< 5” (BR12). */
@Component({
  selector: 'aiia-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <div class="table-wrap" [style.maxHeight]="maxHeight()">
        <table class="table">
          <caption class="sr-only">{{ caption() }}</caption>
          <thead>
            <tr>
              @for (c of columns(); track $index) {
                <th scope="col">
                  {{ c.name }}
                  @if (c.masked) {
                    <span title="Cột bị che theo quyền" aria-label="bị che">🔒</span>
                  }
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track $index; let i = $index) {
              <tr [class.clickable]="clickable()" (click)="clickable() && rowClick.emit(i)">
                @for (v of r; track $index) {
                  <td [class.num]="isNumber(v)" [class.muted]="isHidden(v)" [attr.title]="isSuppressed(v) ? 'Nhóm dưới 5 người được ẩn' : null">
                    {{ format(v) }}
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <p class="muted small" style="margin: 8px 0">{{ emptyText() }}</p>
    }
  `,
})
export class DataTableComponent {
  readonly data = input<TabularResult | null | undefined>();
  readonly caption = input('Bảng dữ liệu');
  readonly emptyText = input('Không có dữ liệu.');
  readonly clickable = input(false);
  readonly maxHeight = input<string | null>(null);
  readonly rowClick = output<number>();

  readonly columns = computed(() => this.data()?.columns ?? []);
  readonly rows = computed(() => this.data()?.rows ?? []);
  readonly isSuppressed = isSuppressed;

  format(v: unknown): string {
    return formatCell(v);
  }

  isNumber(v: unknown): boolean {
    return typeof v === 'number';
  }

  isHidden(v: unknown): boolean {
    return isSuppressed(v) || (typeof v === 'string' && v.includes('•'));
  }
}
