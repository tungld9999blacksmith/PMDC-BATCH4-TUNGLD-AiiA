import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { MatchCandidate, MergeEvent, Page } from '../../core/api/models';
import { IdentityApi } from '../../core/api/services';
import { problemMessage, toProblem } from '../../core/http/problem';
import { ToastService } from '../../core/ui/toast.service';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { MaskedValueComponent } from '../../shared/masked-value';
import { DrawerComponent, ModalComponent, PageHeaderComponent } from '../../shared/overlays';
import { ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Họ tên',
  date_of_birth: 'Ngày sinh',
  email: 'Email',
  phone: 'Điện thoại',
  national_id_hash: 'CCCD (băm)',
  org_unit: 'Đơn vị',
  code: 'Mã nguồn',
};
const CMP_LABELS: Record<string, [string, string]> = {
  MATCH: ['Khớp', 'ok'],
  PARTIAL: ['Gần khớp', 'warn'],
  DIFFERENT: ['Khác', 'danger'],
  MISSING: ['Thiếu', 'neutral'],
};

/** P21 — Đối soát danh tính: hàng đợi cặp nghi trùng, so sánh song song, phím tắt (US15, BR04). */
@Component({
  selector: 'aiia-identity-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, DrawerComponent, ModalComponent, StateViewComponent, StatusBadgeComponent, MaskedValueComponent, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Đối soát danh tính" subtitle="Cặp có điểm ≥ 0,95 được gộp tự động; cặp 0,75–0,95 chờ bạn quyết định. Mọi lần gộp đều tách lại được." />

      <div class="card row filters">
        <select class="input" aria-label="Trạng thái" [(ngModel)]="status" (ngModelChange)="load()">
          <option value="PENDING">Chờ quyết định</option>
          <option value="AUTO_MERGED">Gộp tự động</option>
          <option value="MERGED">Đã gộp</option>
          <option value="REJECTED">Không trùng</option>
          <option value="UNMERGED">Đã tách</option>
        </select>
        <select class="input" aria-label="Nguồn" [(ngModel)]="source" (ngModelChange)="load()">
          <option value="">Mọi nguồn</option>
          <option value="SRC-SIS">SIS</option>
          <option value="SRC-HRM">HRM</option>
          <option value="SRC-LMS">LMS</option>
        </select>
        <span class="spacer"></span>
        <span class="small muted kbd-help">
          Phím tắt: <kbd>M</kbd> gộp · <kbd>N</kbd> không trùng · <kbd>S</kbd> bỏ qua · <kbd>J</kbd>/<kbd>K</kbd> cặp sau/trước
        </span>
      </div>

      @switch (queue.state().status) {
        @case ('loading') { <aiia-state kind="loading" /> }
        @case ('error') { <aiia-state kind="error" [message]="queue.message()" actionLabel="Thử lại" (action)="load()" /> }
        @default {
          <div class="layout">
            <aside class="card flush list" aria-label="Hàng đợi">
              <div class="small muted pad">{{ queue.data?.total ?? 0 }} cặp</div>
              @for (c of items(); track c.id; let i = $index) {
                <button type="button" class="item" [class.active]="i === index()" (click)="index.set(i)">
                  <span class="score" [class.hi]="(c.score ?? 0) >= 0.9">{{ (c.score ?? 0).toFixed(2) }}</span>
                  <span class="names">
                    <span>{{ name(c, 'left') }}</span>
                    <span class="small muted">{{ c.left?.sourceCode }} ↔ {{ c.right?.sourceCode }}</span>
                  </span>
                </button>
              } @empty {
                <aiia-state message="Hàng đợi trống" detail="Không còn cặp nào cần xử lý." />
              }
            </aside>

            <section class="card compare">
              @if (current(); as c) {
                <div class="row between">
                  <div class="row">
                    <strong>Cặp #{{ c.id }}</strong>
                    <span class="chip info">Điểm {{ (c.score ?? 0).toFixed(2) }}</span>
                    <aiia-status [status]="c.status" />
                  </div>
                  <span class="small muted">{{ index() + 1 }} / {{ items().length }}</span>
                </div>
                <table class="table cmp">
                  <thead>
                    <tr>
                      <th>Trường</th>
                      <th>{{ c.left?.sourceCode }} <span class="mono small muted">{{ c.left?.sourceKey }}</span></th>
                      <th></th>
                      <th>{{ c.right?.sourceCode }} <span class="mono small muted">{{ c.right?.sourceKey }}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (f of fieldKeys(c); track f) {
                      <tr>
                        <th scope="row">{{ fieldLabel(f) }}</th>
                        <td><aiia-masked [value]="c.left?.fields?.[f]" /></td>
                        <td class="center">
                          @if (c.comparison?.[f]; as r) {
                            <span class="chip" [class]="'chip ' + cmp(r)[1]">{{ cmp(r)[0] }}</span>
                          }
                        </td>
                        <td><aiia-masked [value]="c.right?.fields?.[f]" /></td>
                      </tr>
                    }
                  </tbody>
                </table>
                @if (c.status === 'PENDING') {
                  <div class="row actions">
                    <button type="button" class="btn" [disabled]="busy()" (click)="decide('SKIP')">Bỏ qua <kbd>S</kbd></button>
                    <span class="spacer"></span>
                    <button type="button" class="btn" [disabled]="busy()" (click)="decide('NOT_MATCH')">Không trùng <kbd>N</kbd></button>
                    <button type="button" class="btn primary" [disabled]="busy()" (click)="decide('MERGE')">Gộp thành một người <kbd>M</kbd></button>
                  </div>
                } @else {
                  <div class="row actions">
                    @if (c.left?.personId) {
                      <button type="button" class="btn" (click)="openHistory(c.left!.personId!)">Lịch sử gộp / tách</button>
                      <a class="btn" [routerLink]="['/profiles', c.left!.personId]">Mở hồ sơ 360°</a>
                    }
                  </div>
                }
              } @else {
                <aiia-state message="Chọn một cặp để so sánh" />
              }
            </section>
          </div>
        }
      }

      @if (historyFor()) {
        <aiia-drawer title="Lịch sử gộp / tách" (closed)="historyFor.set(null)">
          @for (e of history(); track e.id) {
            <article class="event">
              <div class="row between">
                <span class="chip" [class.info]="e.action === 'MERGE'" [class.warn]="e.action === 'UNMERGE'">{{ e.action === 'MERGE' ? 'Gộp' : 'Tách' }}</span>
                <span class="small muted">{{ e.createdAt | viDate: true }}</span>
              </div>
              <div class="small">{{ e.automatic ? 'Tự động' : e.actor?.fullName }}</div>
              <div class="small mono muted">{{ e.survivorPersonId?.slice(0, 8) }} ← {{ e.mergedPersonId?.slice(0, 8) }}</div>
              @if (e.action === 'MERGE' && !undone(e)) {
                <button type="button" class="link-btn small" (click)="unmergeOf.set(e)">Tách lại</button>
              }
            </article>
          } @empty {
            <aiia-state message="Chưa có sự kiện" />
          }
        </aiia-drawer>
      }

      @if (unmergeOf(); as e) {
        <aiia-modal title="Tách bản ghi đã gộp" (closed)="unmergeOf.set(null)">
          <div class="stack">
            <p style="margin: 0">Hai bản ghi sẽ trở lại là hai người riêng; dữ liệu Gold được tính lại ở lần chạy kế tiếp.</p>
            <label class="field"><span class="small muted">Lý do (≥ 5 ký tự) *</span><textarea class="input" [(ngModel)]="reason"></textarea></label>
          </div>
          <div modal-foot class="modal-foot">
            <button type="button" class="btn" (click)="unmergeOf.set(null)">Hủy</button>
            <button type="button" class="btn danger" [disabled]="reason.trim().length < 5" (click)="unmerge(e)">Tách</button>
          </div>
        </aiia-modal>
      }
    </div>
  `,
  styles: [
    `
      .filters {
        margin-bottom: 16px;
      }
      .layout {
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        gap: 16px;
      }
      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }
        .kbd-help {
          display: none;
        }
      }
      .list {
        max-height: calc(100vh - 240px);
        overflow-y: auto;
      }
      .pad {
        padding: 8px 12px;
      }
      .item {
        display: flex;
        gap: 10px;
        align-items: center;
        width: 100%;
        padding: 8px 12px;
        border: 0;
        border-top: 1px solid var(--color-border);
        background: none;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .item.active {
        background: var(--color-accent-soft);
      }
      .names {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .score {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        color: var(--color-muted);
      }
      .score.hi {
        color: var(--color-accent);
      }
      .compare {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
      }
      .cmp th[scope='row'] {
        width: 140px;
        font-weight: 500;
      }
      .center {
        text-align: center;
      }
      kbd {
        padding: 0 4px;
        border: 1px solid var(--color-border);
        border-radius: 3px;
        font-size: 11px;
        background: var(--color-bg);
      }
      .event {
        padding: 10px 0;
        border-bottom: 1px solid var(--color-border);
      }
    `,
  ],
})
export class IdentityPage {
  private readonly api = inject(IdentityApi);
  private readonly toast = inject(ToastService);
  protected readonly queue = loader<Page<MatchCandidate>>();
  protected readonly index = signal(0);
  protected readonly busy = signal(false);
  protected readonly historyFor = signal<string | null>(null);
  protected readonly history = signal<MergeEvent[]>([]);
  protected readonly unmergeOf = signal<MergeEvent | null>(null);
  protected readonly items = computed(() => this.queue.state().data?.items ?? []);
  protected readonly current = computed(() => this.items()[this.index()] ?? null);
  status = 'PENDING';
  source = '';
  reason = '';

  constructor() {
    this.load();
  }

  load(): void {
    this.index.set(0);
    this.queue.load(this.api.candidates({ status: this.status, source: this.source || undefined, pageSize: 100 }));
  }

  name(c: MatchCandidate, side: 'left' | 'right'): string {
    return String(c[side]?.fields?.['full_name']?.value ?? c[side]?.sourceKey ?? '');
  }

  fieldKeys(c: MatchCandidate): string[] {
    return [...new Set([...Object.keys(c.left?.fields ?? {}), ...Object.keys(c.right?.fields ?? {})])];
  }

  fieldLabel(f: string): string {
    return FIELD_LABELS[f] ?? f;
  }

  cmp(r: string): [string, string] {
    return CMP_LABELS[r] ?? [r, 'neutral'];
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || this.unmergeOf() || this.historyFor()) return;
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
    const key = e.key.toLowerCase();
    if (key === 'j') this.move(1);
    else if (key === 'k') this.move(-1);
    else if (this.current()?.status === 'PENDING' && !this.busy()) {
      if (key === 'm') this.decide('MERGE');
      else if (key === 'n') this.decide('NOT_MATCH');
      else if (key === 's') this.decide('SKIP');
      else return;
    } else return;
    e.preventDefault();
  }

  private move(delta: number): void {
    const n = this.items().length;
    if (n) this.index.set(Math.min(n - 1, Math.max(0, this.index() + delta)));
  }

  decide(decision: 'MERGE' | 'NOT_MATCH' | 'SKIP'): void {
    const c = this.current();
    if (!c?.id) return;
    if (decision === 'SKIP') {
      this.move(1);
      return;
    }
    this.busy.set(true);
    this.api.decide(c.id, decision).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(decision === 'MERGE' ? `Đã gộp cặp #${c.id}` : `Đã đánh dấu không trùng cặp #${c.id}`);
        const page = this.queue.data;
        if (page && this.status === 'PENDING') {
          this.queue.set({ ...page, total: page.total - 1, items: page.items.filter((x) => x.id !== c.id) });
          this.index.set(Math.min(this.index(), Math.max(0, this.items().length - 1)));
        } else this.load();
      },
      error: (e: unknown) => {
        this.busy.set(false);
        const p = toProblem(e);
        this.toast.error(problemMessage(p));
        if (p.status === 409) this.load();
      },
    });
  }

  openHistory(personId: string): void {
    this.historyFor.set(personId);
    this.history.set([]);
    this.api.history(personId).subscribe({ next: (h) => this.history.set(h), error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))) });
  }

  undone(e: MergeEvent): boolean {
    return this.history().some((x) => x.action === 'UNMERGE' && x.survivorPersonId === e.survivorPersonId && x.mergedPersonId === e.mergedPersonId && (x.createdAt ?? '') > (e.createdAt ?? ''));
  }

  unmerge(e: MergeEvent): void {
    if (!e.id) return;
    this.api.unmerge(e.id, this.reason.trim()).subscribe({
      next: () => {
        this.toast.success('Đã tách bản ghi');
        this.unmergeOf.set(null);
        this.reason = '';
        const p = this.historyFor();
        if (p) this.openHistory(p);
        this.load();
      },
      error: (err: unknown) => this.toast.error(problemMessage(toProblem(err))),
    });
  }
}
