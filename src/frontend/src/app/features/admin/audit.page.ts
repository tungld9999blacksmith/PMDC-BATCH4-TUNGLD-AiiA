import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { AssistantMessage, AuditLog, BlockedTopic, Page } from '../../core/api/models';
import { AdminApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { REFUSAL_LABELS } from '../../core/util/labels';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { PageHeaderComponent, PagerComponent } from '../../shared/overlays';
import { ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

type Tab = 'logs' | 'assistant' | 'topics';
type AssistantLog = AssistantMessage & { question?: string; user?: { id?: string; fullName?: string }; compiledSql?: string };

/** P27 — Nhật ký kiểm toán bất biến, nhật ký hỏi-đáp và chủ đề chặn của trợ lý (US26, US40, BR14, BR19). */
@Component({
  selector: 'aiia-audit-page',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent, PagerComponent, StateViewComponent, StatusBadgeComponent, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Nhật ký kiểm toán" subtitle="Nhật ký chỉ ghi thêm, không sửa hoặc xóa được. Mọi lượt xem dữ liệu nhạy cảm, thay đổi quyền và lần bị từ chối đều có ở đây." />
      @if (isAdmin) {
        <div class="tabs" role="tablist">
          <button type="button" role="tab" class="tab" [class.active]="activeTab() === 'logs'" [attr.aria-selected]="activeTab() === 'logs'" (click)="setTab('logs')">Nhật ký truy cập</button>
          <button type="button" role="tab" class="tab" [class.active]="activeTab() === 'assistant'" [attr.aria-selected]="activeTab() === 'assistant'" (click)="setTab('assistant')">Nhật ký trợ lý</button>
          <button type="button" role="tab" class="tab" [class.active]="activeTab() === 'topics'" [attr.aria-selected]="activeTab() === 'topics'" (click)="setTab('topics')">Chủ đề chặn</button>
        </div>
      }

      @switch (activeTab()) {
        @case ('logs') {
          <form class="card row filters" (ngSubmit)="searchLogs()">
            <input class="input" name="action" placeholder="Hành động (VD: DATASET_PREVIEW)" aria-label="Hành động" [(ngModel)]="f.action" />
            <input class="input" name="objectType" placeholder="Loại đối tượng" aria-label="Loại đối tượng" [(ngModel)]="f.objectType" />
            <input class="input" name="objectId" placeholder="Mã đối tượng" aria-label="Mã đối tượng" [(ngModel)]="f.objectId" />
            <select class="input" name="outcome" aria-label="Kết quả" [(ngModel)]="f.outcome" (ngModelChange)="searchLogs()">
              <option value="">Mọi kết quả</option>
              <option value="ALLOW">Cho phép</option>
              <option value="DENY">Từ chối</option>
            </select>
            <label class="row small">Từ <input class="input" type="date" name="from" [(ngModel)]="f.from" /></label>
            <label class="row small">Đến <input class="input" type="date" name="to" [(ngModel)]="f.to" /></label>
            @if (actorId()) {
              <span class="chip info">Người thực hiện: {{ actorId()!.slice(0, 8) }} <button type="button" class="link-btn" aria-label="Bỏ lọc người thực hiện" (click)="clearActor()">✕</button></span>
            }
            <button type="submit" class="btn">Lọc</button>
          </form>
          @if (!isAdmin) {
            <div class="banner info small" style="margin-bottom: 12px">Data Steward xem được nhật ký về dataset, phân loại cột và quyền truy cập.</div>
          }
          <section class="card flush">
            @switch (logs.state().status) {
              @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
              @case ('error') { <aiia-state kind="error" [message]="logs.message()" actionLabel="Thử lại" (action)="loadLogs()" /> }
              @default {
                <div class="table-wrap">
                  <table class="table">
                    <thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Kết quả</th><th>IP</th><th></th></tr></thead>
                    <tbody>
                      @for (a of logs.data?.items ?? []; track a.id) {
                        <tr [class.deny]="a.outcome === 'DENY'">
                          <td class="nowrap">{{ a.occurredAt | viDate: true }}</td>
                          <td>{{ a.actor?.fullName ?? 'Hệ thống' }}</td>
                          <td class="mono small">{{ a.action }}</td>
                          <td class="small"><span class="muted">{{ a.objectType }}</span> <span class="mono">{{ a.objectId }}</span></td>
                          <td><aiia-status [status]="a.outcome" /></td>
                          <td class="mono small muted">{{ a.ip }}</td>
                          <td>
                            @if (hasDetails(a)) {
                              <button type="button" class="link-btn small" [attr.aria-expanded]="expanded() === a.id" (click)="toggle(a.id)">Chi tiết</button>
                            }
                          </td>
                        </tr>
                        @if (expanded() === a.id) {
                          <tr class="details"><td colspan="7"><pre class="mono small">{{ json(a.details) }}</pre></td></tr>
                        }
                      } @empty {
                        <tr><td colspan="7"><aiia-state message="Không có bản ghi phù hợp" /></td></tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (logs.data; as p) {
                  <aiia-pager [page]="page()" [pageSize]="50" [total]="p.total" (pageChange)="page.set($event); loadLogs()" />
                }
              }
            }
          </section>
        }

        @case ('assistant') {
          <div class="card row filters">
            <select class="input" aria-label="Kết quả trả lời" [(ngModel)]="assistantStatus" (ngModelChange)="loadAssistant()">
              <option value="">Mọi kết quả</option>
              <option value="ANSWERED">Đã trả lời</option>
              <option value="REFUSED">Từ chối</option>
              <option value="CLARIFYING">Hỏi lại</option>
            </select>
          </div>
          <section class="card flush">
            @switch (assistant.state().status) {
              @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
              @case ('error') { <aiia-state kind="error" [message]="assistant.message()" /> }
              @default {
                @for (m of assistant.data?.items ?? []; track m.id) {
                  <article class="qa">
                    <div class="row between">
                      <div class="row"><strong>{{ m.user?.fullName }}</strong> <span class="small muted">{{ m.createdAt | viDate: true }}</span></div>
                      <div class="row">
                        <aiia-status [status]="m.status" />
                        @if (m.feedback === 1) { <span title="Người dùng đánh giá hữu ích">👍</span> }
                        @if (m.feedback === -1) { <span title="Người dùng đánh giá không hữu ích">👎</span> }
                      </div>
                    </div>
                    <div class="q">“{{ m.question }}”</div>
                    @if (m.status === 'REFUSED') {
                      <div class="small warn-text">{{ refusal(m.refusalReason) }}</div>
                    } @else if (m.content) {
                      <div class="small muted answer">{{ m.content }}</div>
                    }
                    @if (m.metricCodes?.length) {
                      <div class="row small">
                        @for (c of m.metricCodes; track c) {
                          <span class="chip neutral mono">{{ c }}</span>
                        }
                      </div>
                    }
                    @if (m.compiledSql) {
                      <details>
                        <summary class="small">Truy vấn đã chạy</summary>
                        <pre class="mono small sql">{{ m.compiledSql }}</pre>
                      </details>
                    }
                  </article>
                } @empty {
                  <aiia-state message="Chưa có câu hỏi nào" />
                }
                @if (assistant.data; as p) {
                  <aiia-pager [page]="assistantPage()" [pageSize]="20" [total]="p.total" (pageChange)="assistantPage.set($event); loadAssistant()" />
                }
              }
            }
          </section>
        }

        @case ('topics') {
          <section class="card stack">
            <p class="small muted" style="margin: 0">Câu hỏi khớp một mẫu dưới đây bị trợ lý từ chối với lý do “chủ đề hạn chế”. Mẫu là từ khóa phân tách bằng |, không phân biệt hoa thường.</p>
            <form class="row" (ngSubmit)="addTopic()">
              <input class="input mono grow" name="pattern" placeholder="tôn giáo|dân tộc" aria-label="Mẫu chủ đề" [(ngModel)]="topicPattern" />
              <input class="input grow" name="desc" placeholder="Mô tả" aria-label="Mô tả" [(ngModel)]="topicDesc" />
              <button type="submit" class="btn primary" [disabled]="!topicPattern.trim()">Thêm</button>
            </form>
            @if (topicError()) {
              <div class="banner danger small" role="alert">{{ topicError() }}</div>
            }
            <table class="table">
              <thead><tr><th>Mẫu</th><th>Mô tả</th><th>Người tạo</th><th>Thời điểm</th><th></th></tr></thead>
              <tbody>
                @for (t of topics.data ?? []; track t.id) {
                  <tr>
                    <td class="mono">{{ t.pattern }}</td>
                    <td>{{ t.description }}</td>
                    <td>{{ t.createdBy?.fullName }}</td>
                    <td>{{ t.createdAt | viDate }}</td>
                    <td><button type="button" class="link-btn small" (click)="removeTopic(t)">Gỡ</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="muted">Chưa có chủ đề chặn.</td></tr>
                }
              </tbody>
            </table>
          </section>
        }
      }
    </div>
  `,
  styles: [
    `
      .tabs {
        margin-bottom: 12px;
      }
      .filters {
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .grow {
        flex: 1;
        min-width: 180px;
      }
      .nowrap {
        white-space: nowrap;
      }
      tr.deny td {
        background: #fff5f5;
      }
      .details pre {
        margin: 0;
        white-space: pre-wrap;
      }
      .qa {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--color-border);
      }
      .q {
        font-style: italic;
      }
      .answer {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .warn-text {
        color: var(--color-warn, #e8590c);
      }
      .sql {
        margin: 6px 0 0;
        padding: 8px;
        background: var(--color-bg);
        border-radius: 6px;
        white-space: pre-wrap;
      }
    `,
  ],
})
export class AuditPage {
  readonly tab = input<string | undefined>();
  readonly actorId = input<string | undefined>();

  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  protected readonly isAdmin = inject(SessionService).hasAnyRole('PLATFORM_ADMIN');
  protected readonly logs = loader<Page<AuditLog>>();
  protected readonly assistant = loader<Page<AssistantLog>>();
  protected readonly topics = loader<BlockedTopic[]>();
  protected readonly page = signal(1);
  protected readonly assistantPage = signal(1);
  protected readonly expanded = signal<number | null>(null);
  protected readonly topicError = signal<string | null>(null);
  protected readonly activeTab = computed<Tab>(() => (this.isAdmin && (this.tab() === 'assistant' || this.tab() === 'topics') ? this.tab() as Tab : 'logs'));
  f = { action: '', objectType: '', objectId: '', outcome: '', from: '', to: '' };
  assistantStatus = '';
  topicPattern = '';
  topicDesc = '';

  constructor() {
    effect(() => {
      const tab = this.activeTab();
      this.actorId();
      untracked(() => {
        if (tab === 'logs') this.searchLogs();
        else if (tab === 'assistant') this.loadAssistant();
        else this.topics.load(this.api.blockedTopics());
      });
    });
  }

  setTab(tab: Tab): void {
    void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge' });
  }

  clearActor(): void {
    void this.router.navigate([], { queryParams: { actorId: null }, queryParamsHandling: 'merge' });
  }

  searchLogs(): void {
    this.page.set(1);
    this.loadLogs();
  }

  loadLogs(): void {
    const f = this.f;
    this.logs.load(
      this.api.auditLogs({
        action: f.action.trim() || undefined,
        objectType: f.objectType.trim() || undefined,
        objectId: f.objectId.trim() || undefined,
        outcome: f.outcome || undefined,
        from: f.from ? `${f.from}T00:00:00` : undefined,
        to: f.to ? `${f.to}T23:59:59` : undefined,
        actorId: this.actorId() || undefined,
        page: this.page(),
        pageSize: 50,
      }),
      true,
    );
  }

  loadAssistant(): void {
    this.assistant.load(this.api.assistantLogs({ status: this.assistantStatus || undefined, page: this.assistantPage(), pageSize: 20 }), true);
  }

  hasDetails(a: AuditLog): boolean {
    return !!a.details && Object.keys(a.details).length > 0;
  }

  toggle(id: number | undefined): void {
    this.expanded.set(this.expanded() === id ? null : (id ?? null));
  }

  json(v: unknown): string {
    return JSON.stringify(v, null, 2);
  }

  refusal(r: string | null | undefined): string {
    return REFUSAL_LABELS[r ?? ''] ?? r ?? '';
  }

  addTopic(): void {
    this.topicError.set(null);
    this.api.addBlockedTopic(this.topicPattern.trim(), this.topicDesc.trim() || undefined).subscribe({
      next: () => {
        this.topicPattern = '';
        this.topicDesc = '';
        this.toast.success('Đã thêm chủ đề chặn — áp dụng ngay cho câu hỏi kế tiếp');
        this.topics.load(this.api.blockedTopics(), true);
      },
      error: (e: unknown) => this.topicError.set(problemMessage(toProblem(e))),
    });
  }

  async removeTopic(t: BlockedTopic): Promise<void> {
    if (!t.id) return;
    const ok = await this.dialogs.confirm({ title: 'Gỡ chủ đề chặn', message: `Trợ lý sẽ không còn từ chối câu hỏi khớp “${t.pattern}”.`, confirmLabel: 'Gỡ', danger: true });
    if (!ok) return;
    this.api.removeBlockedTopic(t.id).subscribe({
      next: () => this.topics.load(this.api.blockedTopics(), true),
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }
}
