import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DataLayer, Freshness, Sensitivity } from '../core/api/models';
import { STATUS_LABELS, label } from '../core/util/labels';
import { relativeTime } from './pipes';

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'ok', SUCCEEDED: 'ok', PASS: 'ok', RESOLVED: 'ok', APPROVED: 'ok', MERGED: 'ok', AUTO_MERGED: 'ok', PUBLISHED: 'ok', CERTIFIED: 'ok', ANSWERED: 'ok', SENT: 'ok',
  RUNNING: 'info', QUEUED: 'info', IN_PROGRESS: 'info', ACKNOWLEDGED: 'info', CLARIFYING: 'info',
  PARTIAL: 'warn', PENDING: 'warn', OPEN: 'warn', WARNING: 'warn', DRAFT: 'neutral', PAUSED: 'neutral',
  FAILED: 'danger', FAIL: 'danger', ERROR: 'danger', REJECTED: 'danger', BLOCKING: 'danger', REFUSED: 'danger', INACTIVE: 'danger', REVOKED: 'danger', DENY: 'danger',
  EXPIRED: 'neutral', CANCELLED: 'neutral', ARCHIVED: 'neutral', DISABLED: 'neutral', WONT_FIX: 'neutral', DISMISSED: 'neutral', DEPRECATED: 'neutral', UNMERGED: 'neutral', SKIPPED_NO_ACCESS: 'neutral', ALLOW: 'ok',
};

/** Nhãn trạng thái: màu + chữ (màu không là kênh duy nhất — WCAG). */
@Component({
  selector: 'aiia-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="chip" [class]="'chip ' + tone()">{{ text() }}</span>`,
})
export class StatusBadgeComponent {
  readonly status = input<string | null | undefined>();
  readonly tone = computed(() => STATUS_TONE[this.status() ?? ''] ?? 'neutral');
  readonly text = computed(() => label(STATUS_LABELS, this.status()));
}

const SENS_COLOR: Record<Sensitivity, string> = {
  PUBLIC: 'var(--sens-public)',
  INTERNAL: 'var(--sens-internal)',
  CONFIDENTIAL: 'var(--sens-confidential)',
  RESTRICTED: 'var(--sens-restricted)',
};

@Component({
  selector: 'aiia-sens',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="chip outline" [style.color]="color()" [style.borderColor]="color()" [attr.title]="'Mức nhạy cảm ' + level()"
    >@if (level() === 'RESTRICTED') {<span aria-hidden="true">🔒</span>}{{ level() }}</span
  >`,
})
export class SensitivityBadgeComponent {
  readonly level = input.required<Sensitivity>();
  readonly color = computed(() => SENS_COLOR[this.level()] ?? 'var(--sens-public)');
}

const LAYER_COLOR: Record<DataLayer, string> = {
  BRONZE: 'var(--layer-bronze)',
  SILVER: 'var(--layer-silver)',
  GOLD: 'var(--layer-gold)',
  QUARANTINE: 'var(--layer-quarantine)',
};

@Component({
  selector: 'aiia-layer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="chip outline" [style.color]="color()" [style.borderColor]="color()">{{ layer() }}</span>`,
})
export class LayerBadgeComponent {
  readonly layer = input.required<DataLayer>();
  readonly color = computed(() => LAYER_COLOR[this.layer()]);
}

/** Chip độ mới + điểm DQ + nhãn “Dữ liệu cũ” (BR15). */
@Component({
  selector: 'aiia-freshness',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (freshness(); as f) {
      <span class="row small muted" style="gap: 6px">
        @if (f.sources?.length) {
          <span>Nguồn: {{ f.sources?.join(', ') }}</span><span aria-hidden="true">·</span>
        }
        <span [attr.title]="f.updatedAt">Cập nhật {{ updated() }}</span>
        @if (f.dqScore !== null && f.dqScore !== undefined) {
          <span class="chip" [class.ok]="f.dqScore >= 98" [class.warn]="f.dqScore < 98">DQ {{ f.dqScore }}%</span>
        }
        @if (f.stale) {
          <span class="chip warn" title="Dữ liệu vượt SLA độ mới">Dữ liệu cũ</span>
        }
      </span>
    }
  `,
})
export class FreshnessChipComponent {
  readonly freshness = input<Freshness | null | undefined>();
  readonly updated = computed(() => relativeTime(this.freshness()?.updatedAt));
}

export const BADGES = [StatusBadgeComponent, SensitivityBadgeComponent, LayerBadgeComponent, FreshnessChipComponent] as const;
