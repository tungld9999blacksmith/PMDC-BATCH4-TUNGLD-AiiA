import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, of, shareReplay } from 'rxjs';
import type { Dimension, Metric } from '../../core/api/models';
import { SemanticApi } from '../../core/api/services';

const VALUE_LABELS: Record<string, Record<string, string>> = {
  faculty: { CNTT: 'Khoa CNTT', KT: 'Khoa Kinh tế', NN: 'Khoa Ngoại ngữ' },
  program: { KHMT: 'Khoa học máy tính', HTTT: 'Hệ thống thông tin', KTPM: 'Kỹ thuật phần mềm', QTKD: 'Quản trị kinh doanh', TCNH: 'Tài chính – Ngân hàng', NNA: 'Ngôn ngữ Anh', NNT: 'Ngôn ngữ Trung' },
  status: { STUDYING: 'Đang học', RESERVED: 'Bảo lưu', GRADUATED: 'Tốt nghiệp', DROPPED: 'Thôi học' },
  dq_dimension: { COMPLETENESS: 'Đầy đủ', UNIQUENESS: 'Duy nhất', VALIDITY: 'Hợp lệ', CONSISTENCY: 'Nhất quán', TIMELINESS: 'Kịp thời' },
};

/** Danh mục metric và dimension của semantic model, nạp một lần và dùng chung. */
@Injectable({ providedIn: 'root' })
export class SemanticCatalog {
  private readonly api = inject(SemanticApi);
  private metrics$: Observable<Metric[]> | null = null;
  private dimensions$: Observable<Dimension[]> | null = null;

  readonly metrics = toSignal(this.loadMetrics(), { initialValue: [] as Metric[] });
  readonly dimensions = toSignal(this.loadDimensions(), { initialValue: [] as Dimension[] });

  loadMetrics(refresh = false): Observable<Metric[]> {
    if (!this.metrics$ || refresh) this.metrics$ = this.api.metrics().pipe(catchError(() => of([])), shareReplay(1));
    return this.metrics$;
  }

  private loadDimensions(): Observable<Dimension[]> {
    if (!this.dimensions$) this.dimensions$ = this.api.dimensions().pipe(catchError(() => of([])), shareReplay(1));
    return this.dimensions$;
  }

  metricName(code: string): string {
    return this.metrics().find((m) => m.code === code)?.name ?? code;
  }

  metricUnit(code: string): string | null | undefined {
    return this.metrics().find((m) => m.code === code)?.unit;
  }

  dimensionName(code: string): string {
    return this.dimensions().find((d) => d.code === code)?.name ?? code;
  }

  valueLabel(dimension: string, value: string): string {
    return VALUE_LABELS[dimension]?.[value] ?? value;
  }
}
