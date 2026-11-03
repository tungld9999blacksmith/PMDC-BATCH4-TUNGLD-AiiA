import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { AssistantMessage } from '../../core/api/models';
import { REFUSAL_LABELS } from '../../core/util/labels';
import { ChartComponent, toChartData } from '../../shared/chart';
import { ViDatePipe } from '../../shared/pipes';
import { SemanticCatalog } from '../dashboards/semantic-catalog.service';

const STAGES: Record<string, string> = { CHECKING: 'Đang kiểm tra câu hỏi…', PLANNING: 'Đang chọn chỉ số phù hợp…', QUERYING: 'Đang truy vấn dữ liệu trong phạm vi quyền…', WRITING: 'Đang diễn giải kết quả…' };

/** Thẻ trả lời của trợ lý (aiia-answer-card, docs/04 §6.3). */
@Component({
  selector: 'aiia-answer-card',
  standalone: true,
  imports: [ChartComponent, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="answer" [class.refused]="message().status === 'REFUSED'" aria-live="polite">
      <div class="who" aria-hidden="true">✦</div>
      <div class="body">
        @if (stage()) {
          <div class="small muted stage">{{ stages[stage() ?? ''] }}</div>
        }
        @if (message().content) {
          <p class="text">{{ message().content }}</p>
        }

        @if (message().status === 'REFUSED') {
          <div class="banner warn small">
            <div>
              <strong>Không thể trả lời:</strong> {{ refusal() }}
              @if (message().refusalReason === 'OUT_OF_SCOPE') {
                <div><button type="button" class="link-btn" (click)="requestAccess.emit()">Yêu cầu quyền truy cập dữ liệu</button></div>
              }
            </div>
          </div>
        }

        @if (message().clarify; as c) {
          @if (message().status === 'CLARIFYING') {
            <div class="row" role="group" aria-label="Chọn để làm rõ câu hỏi">
              @for (o of c.options ?? []; track o.label) {
                <button type="button" class="chip selectable" (click)="clarify.emit(o.patch ?? {})">{{ o.label }}</button>
              }
            </div>
          }
        }

        @if (chartData(); as d) {
          <div class="chart"><aiia-chart [data]="d" [height]="220" ariaLabel="Biểu đồ câu trả lời" [suppressed]="message().result?.suppressedCells ?? 0" /></div>
        }

        @if (message().status === 'ANSWERED') {
          <div class="row meta">
            <span class="chip info" title="Nội dung do AI tạo — kiểm chứng bằng truy vấn và dashboard gốc (BR20)">Do AI tạo</span>
            @for (m of message().metricCodes ?? []; track m) {
              <span class="chip ok" title="Metric đã chứng nhận">✓ {{ catalog.metricName(m) }}</span>
            }
            @for (f of message().appliedFilters ?? []; track $index) {
              <span class="chip neutral">{{ catalog.dimensionName(f.dimension) }} = {{ filterValue(f) }}</span>
            }
            @if (message().dataAsOf) {
              <span class="small muted">Dữ liệu đến {{ message().dataAsOf | viDate: true }}</span>
            }
          </div>
          <div class="row actions">
            <button type="button" class="btn sm" (click)="showSql.set(!showSql())" [attr.aria-expanded]="showSql()">{{ showSql() ? 'Ẩn truy vấn' : 'Xem truy vấn' }}</button>
            <button type="button" class="btn sm" (click)="openInDashboard()">Mở trong dashboard</button>
            <span class="spacer"></span>
            <button type="button" class="btn ghost sm" [class.on]="message().feedback === 1" aria-label="Hữu ích" (click)="rate.emit(1)">👍</button>
            <button type="button" class="btn ghost sm" [class.on]="message().feedback === -1" aria-label="Không hữu ích" (click)="rate.emit(-1)">👎</button>
          </div>
          @if (showSql()) {
            <pre class="sql mono">{{ message().sql }}</pre>
          }
        }
      </div>
    </article>
  `,
  styles: [
    `
      .answer {
        display: flex;
        gap: 10px;
        padding: 12px 14px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 10px;
      }
      .answer.refused {
        border-color: #ffd8a8;
      }
      .who {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: var(--color-accent);
        color: #fff;
      }
      .body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .text {
        margin: 0;
        white-space: pre-line;
      }
      .stage {
        font-style: italic;
      }
      .sql {
        margin: 0;
        padding: 10px;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 6px;
        overflow-x: auto;
        white-space: pre;
      }
      .btn.on {
        background: var(--color-accent-soft);
      }
    `,
  ],
})
export class AnswerCardComponent {
  readonly message = input.required<AssistantMessage>();
  readonly stage = input<string | null>(null);
  readonly clarify = output<Record<string, unknown>>();
  readonly rate = output<-1 | 1>();
  readonly requestAccess = output<void>();
  protected readonly catalog = inject(SemanticCatalog);
  private readonly router = inject(Router);
  protected readonly showSql = signal(false);
  protected readonly stages = STAGES;

  protected readonly refusal = computed(() => REFUSAL_LABELS[this.message().refusalReason ?? ''] ?? '');
  protected readonly chartData = computed(() => {
    const m = this.message();
    if (!m.chart || !m.result) return null;
    return toChartData(m.result, m.chart.type === 'TABLE' ? 'BAR' : (m.chart.type ?? 'BAR'), (dim, v) => this.catalog.valueLabel(dim, v), (c) => this.catalog.metricName(c));
  });

  filterValue(f: { op: string; value?: unknown; values?: unknown[] }): string {
    return f.op === 'in' ? (f.values ?? []).join(', ') : String(f.value ?? '');
  }

  openInDashboard(): void {
    const q = this.message().semanticQuery;
    if (q) void this.router.navigate(['/dashboards', 'explore'], { queryParams: { spec: encodeURIComponent(JSON.stringify(q)) } });
  }
}
