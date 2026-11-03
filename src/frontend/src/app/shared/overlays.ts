import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Drawer bên phải; Esc hoặc bấm nền để đóng; nội dung trang phía sau giữ nguyên vị trí cuộn. */
@Component({
  selector: 'aiia-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="closed.emit()" aria-hidden="true"></div>
    <section class="drawer" [class.wide]="wide()" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <header class="drawer-head">
        <h2>{{ title() }}</h2>
        <button type="button" class="btn ghost sm" (click)="closed.emit()" aria-label="Đóng">✕</button>
      </header>
      <div class="drawer-body"><ng-content /></div>
      <ng-content select="[drawer-foot]" />
    </section>
  `,
})
export class DrawerComponent {
  readonly title = input('');
  readonly wide = input(false);
  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}

@Component({
  selector: 'aiia-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-overlay" (click)="closed.emit()" aria-hidden="true"></div>
    <section class="modal" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <header class="modal-head">
        <h2>{{ title() }}</h2>
        <button type="button" class="btn ghost sm" (click)="closed.emit()" aria-label="Đóng">✕</button>
      </header>
      <div class="modal-body"><ng-content /></div>
      <ng-content select="[modal-foot]" />
    </section>
  `,
})
export class ModalComponent {
  readonly title = input('');
  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}

/** Tiêu đề trang + breadcrumb + vùng hành động (ng-content). */
@Component({
  selector: 'aiia-page-header',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (crumbs().length) {
      <nav class="small muted crumbs" aria-label="Breadcrumb">
        @for (c of crumbs(); track $index; let last = $last) {
          @if (c.link && !last) {
            <a [routerLink]="c.link">{{ c.label }}</a>
          } @else {
            <span>{{ c.label }}</span>
          }
          @if (!last) {
            <span aria-hidden="true"> › </span>
          }
        }
      </nav>
    }
    <div class="row between head">
      <div>
        <h1>
          {{ title() }}
          @if (adv()) {
            <span class="adv" title="Phạm vi nâng cao">ADV</span>
          }
        </h1>
        @if (subtitle()) {
          <p class="muted" style="margin: 4px 0 0">{{ subtitle() }}</p>
        }
      </div>
      <div class="row"><ng-content /></div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        margin-bottom: 16px;
      }
      .crumbs {
        margin-bottom: 6px;
      }
      .head {
        align-items: flex-start;
      }
    `,
  ],
})
export class PageHeaderComponent {
  readonly title = input('');
  readonly subtitle = input<string | null | undefined>(null);
  readonly adv = input(false);
  readonly crumbs = input<{ label: string; link?: string }[]>([]);
}

/** Phân trang đơn giản cho Page<T>. */
@Component({
  selector: 'aiia-pager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (total() > pageSize()) {
      <nav class="row small" aria-label="Phân trang" style="justify-content: flex-end; padding: 8px 12px">
        <span class="muted">{{ from() }}–{{ to() }} / {{ total() }}</span>
        <button type="button" class="btn sm" [disabled]="page() <= 1" (click)="pageChange.emit(page() - 1)">‹ Trước</button>
        <button type="button" class="btn sm" [disabled]="to() >= total()" (click)="pageChange.emit(page() + 1)">Sau ›</button>
      </nav>
    }
  `,
})
export class PagerComponent {
  readonly page = input(1);
  readonly pageSize = input(20);
  readonly total = input(0);
  readonly pageChange = output<number>();
  from = () => (this.page() - 1) * this.pageSize() + 1;
  to = () => Math.min(this.total(), this.page() * this.pageSize());
}
