import { Pipe, PipeTransform } from '@angular/core';
import { isSuppressed } from '../core/api/models';
import {
  DIMENSION_LABELS,
  FACET_LABELS,
  KIND_LABELS,
  LAYER_LABELS,
  NODE_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  SUBJECT_LABELS,
  TOPIC_LABELS,
  label,
} from '../core/util/labels';

const MAPS = {
  status: STATUS_LABELS,
  role: ROLE_LABELS,
  facet: FACET_LABELS,
  dimension: DIMENSION_LABELS,
  topic: TOPIC_LABELS,
  layer: LAYER_LABELS,
  kind: KIND_LABELS,
  node: NODE_LABELS,
  subject: SUBJECT_LABELS,
};

/** Nhãn tiếng Việt cho mã: {{ 'ACTIVE' | label: 'status' }} */
@Pipe({ name: 'label', standalone: true })
export class LabelPipe implements PipeTransform {
  transform(code: string | null | undefined, map: keyof typeof MAPS): string {
    return label(MAPS[map], code);
  }
}

export function formatNumber(value: number, unit?: string | null): string {
  const text = value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  if (!unit) return text;
  return unit === '%' ? `${text}%` : `${text} ${unit}`;
}

/** Hiển thị một ô dữ liệu: nhóm nhỏ → “< 5”, số theo định dạng Việt Nam, rỗng → “—”. */
export function formatCell(value: unknown, unit?: string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  if (isSuppressed(value)) return '< 5';
  if (typeof value === 'number') return formatNumber(value, unit);
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) return formatCell((value as { value: unknown }).value, unit);
  return String(value);
}

@Pipe({ name: 'cell', standalone: true })
export class CellPipe implements PipeTransform {
  transform(value: unknown, unit?: string | null): string {
    return formatCell(value, unit);
  }
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = now - Date.parse(iso);
  const future = diff < 0;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  let text: string;
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) text = `${minutes} phút`;
  else if (minutes < 60 * 24) text = `${Math.round(minutes / 60)} giờ`;
  else if (minutes < 60 * 24 * 45) text = `${Math.round(minutes / 1440)} ngày`;
  else text = `${Math.round(minutes / 43200)} tháng`;
  return future ? `sau ${text}` : `${text} trước`;
}

@Pipe({ name: 'relTime', standalone: true })
export class RelTimePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return relativeTime(iso);
  }
}

@Pipe({ name: 'viDate', standalone: true })
export class ViDatePipe implements PipeTransform {
  transform(iso: string | null | undefined, withTime = false): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return withTime ? d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : d.toLocaleDateString('vi-VN');
  }
}

export const SHARED_PIPES = [LabelPipe, CellPipe, RelTimePipe, ViDatePipe] as const;
