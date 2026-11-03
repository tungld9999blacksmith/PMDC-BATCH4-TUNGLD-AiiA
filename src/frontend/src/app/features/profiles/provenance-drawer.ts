import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import type { AttributeProvenance } from '../../core/api/models';
import { ProfilesApi } from '../../core/api/services';
import { loader } from '../../shared/async';
import { SensitivityBadgeComponent } from '../../shared/badges';
import { MaskedValueComponent } from '../../shared/masked-value';
import { DrawerComponent } from '../../shared/overlays';
import { CellPipe, ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

/** Drawer nguồn gốc thuộc tính (US16): nguồn thắng, thời điểm, quy tắc ưu tiên, giá trị từng nguồn. */
@Component({
  selector: 'aiia-provenance-drawer',
  standalone: true,
  imports: [DrawerComponent, StateViewComponent, MaskedValueComponent, SensitivityBadgeComponent, ViDatePipe, CellPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aiia-drawer [title]="'Nguồn gốc: ' + label()" (closed)="closed.emit()">
      @switch (prov.state().status) {
        @case ('loading') { <aiia-state kind="loading" /> }
        @case ('error') { <aiia-state kind="error" [message]="prov.message()" /> }
        @default {
          @if (prov.data; as p) {
            <dl class="dl">
              <dt>Giá trị</dt>
              <dd><aiia-masked [value]="p.value" /></dd>
              <dt>Mức nhạy cảm</dt>
              <dd>@if (p.value?.sensitivity; as s) {<aiia-sens [level]="s" />}</dd>
              <dt>Nguồn được chọn</dt>
              <dd><span class="chip info">{{ p.winningSource }}</span></dd>
              <dt>Cập nhật ở nguồn</dt>
              <dd>{{ p.sourceUpdatedAt | viDate: true }}</dd>
              <dt>Quy tắc ưu tiên</dt>
              <dd>{{ p.survivorshipRule }}</dd>
            </dl>
            <h3 style="margin-top: 16px">Giá trị ở từng nguồn</h3>
            @if (p.candidates?.length) {
              <table class="table">
                <thead><tr><th>Nguồn</th><th>Giá trị</th><th>Cập nhật</th></tr></thead>
                <tbody>
                  @for (c of p.candidates; track c.source) {
                    <tr [class.selected]="c.source === p.winningSource"><td>{{ c.source }}</td><td>{{ c.value | cell }}</td><td>{{ c.updatedAt | viDate }}</td></tr>
                  }
                </tbody>
              </table>
            } @else {
              <p class="muted small">Không hiển thị giá trị từng nguồn với mức nhạy cảm này hoặc với quyền hiện tại của bạn (AC16.2).</p>
            }
          }
        }
      }
    </aiia-drawer>
  `,
  styles: [
    `
      .dl {
        display: grid;
        grid-template-columns: 140px 1fr;
        gap: 8px 12px;
        margin: 0;
      }
      .dl dt {
        color: var(--color-muted);
      }
      .dl dd {
        margin: 0;
      }
    `,
  ],
})
export class ProvenanceDrawerComponent {
  readonly personId = input.required<string>();
  readonly attribute = input.required<string>();
  readonly label = input('');
  readonly closed = output<void>();
  private readonly api = inject(ProfilesApi);
  protected readonly prov = loader<AttributeProvenance>();

  constructor() {
    effect(() => this.prov.load(this.api.provenance(this.personId(), this.attribute())));
  }
}
