import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { DataSource, Page } from '../../core/api/models';
import { IntegrationApi } from '../../core/api/services';
import { SessionService } from '../../core/auth/session.service';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { loader } from '../../shared/async';
import { SensitivityBadgeComponent, StatusBadgeComponent } from '../../shared/badges';
import { PageHeaderComponent } from '../../shared/overlays';
import { RelTimePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

const TYPE_LABELS: Record<string, string> = { FILE: 'File CSV/XLSX', JDBC: 'Cơ sở dữ liệu', API: 'API' };

/** P13 — Danh sách nguồn dữ liệu (US04, BR01). */
@Component({
  selector: 'aiia-source-list-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, StateViewComponent, StatusBadgeComponent, SensitivityBadgeComponent, RelTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Nguồn dữ liệu" subtitle="Mỗi nguồn phải có chủ sở hữu nghiệp vụ, mục đích và căn cứ cho phép trước khi được ingest (BR01).">
        @if (isEngineer) {
          <a class="btn primary" routerLink="/sources/new">+ Đăng ký nguồn</a>
        }
      </aiia-page-header>

      <form class="card row filters" (ngSubmit)="load()">
        <input class="input" name="q" placeholder="Tìm theo mã, tên, đơn vị sở hữu" aria-label="Tìm nguồn" [(ngModel)]="q" />
        <select class="input" name="type" aria-label="Loại nguồn" [(ngModel)]="type" (ngModelChange)="load()">
          <option value="">Mọi loại</option>
          @for (t of types; track t[0]) {
            <option [value]="t[0]">{{ t[1] }}</option>
          }
        </select>
        <select class="input" name="status" aria-label="Trạng thái" [(ngModel)]="status" (ngModelChange)="load()">
          <option value="">Mọi trạng thái</option>
          <option value="DRAFT">Nháp</option>
          <option value="ACTIVE">Hoạt động</option>
          <option value="PAUSED">Tạm dừng</option>
          <option value="ARCHIVED">Lưu trữ</option>
        </select>
        <button type="submit" class="btn">Tìm</button>
      </form>

      <section class="card flush">
        @switch (sources.state().status) {
          @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
          @case ('error') { <aiia-state kind="error" [message]="sources.message()" actionLabel="Thử lại" (action)="load()" /> }
          @default {
            @if (sources.data?.items?.length) {
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr><th>Mã</th><th>Tên nguồn</th><th>Loại</th><th>Chủ sở hữu nghiệp vụ</th><th>Độ nhạy</th><th>Lịch</th><th>Lần chạy gần nhất</th><th>Trạng thái</th><th></th></tr>
                  </thead>
                  <tbody>
                    @for (s of sources.data!.items; track s.id) {
                      <tr>
                        <td class="mono"><a [routerLink]="['/sources', s.id]">{{ s.code }}</a></td>
                        <td>{{ s.name }}</td>
                        <td>{{ typeLabel(s.type) }}</td>
                        <td>{{ s.businessOwner }}</td>
                        <td><aiia-sens [level]="s.sensitivity" /></td>
                        <td class="mono small">{{ s.schedule ? s.schedule.cron + (s.schedule.paused ? ' (dừng)' : '') : 'Thủ công' }}</td>
                        <td>
                          @if (s.lastRun; as r) {
                            <a [routerLink]="['/runs', r.id]"><aiia-status [status]="r.status" /></a>
                            <span class="small muted">{{ r.queuedAt | relTime }}</span>
                          } @else {
                            <span class="muted">—</span>
                          }
                        </td>
                        <td><aiia-status [status]="s.status" /></td>
                        <td class="row nowrap">
                          @if (isEngineer) {
                            @if (s.status === 'ACTIVE') {
                              <button type="button" class="link-btn small" [disabled]="busy() === s.id" (click)="ingest(s)">Ingest ngay</button>
                              <button type="button" class="link-btn small" (click)="setStatus(s, 'PAUSED')">Tạm dừng</button>
                            } @else if (s.status === 'PAUSED' || s.status === 'DRAFT') {
                              <button type="button" class="link-btn small" (click)="setStatus(s, 'ACTIVE')">Kích hoạt</button>
                            }
                          }
                          <a class="link-btn small" [routerLink]="['/sources', s.id]">{{ isEngineer ? 'Cấu hình' : 'Xem' }}</a>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <aiia-state message="Chưa có nguồn phù hợp" [detail]="q || type || status ? 'Thử bỏ bớt bộ lọc.' : 'Đăng ký nguồn đầu tiên để bắt đầu ingest.'" />
            }
          }
        }
      </section>
    </div>
  `,
  styles: [
    `
      .filters {
        margin-bottom: 16px;
      }
      .filters .input:first-child {
        flex: 1;
        min-width: 220px;
      }
      .table-wrap {
        overflow-x: auto;
      }
      .nowrap {
        flex-wrap: nowrap;
        white-space: nowrap;
      }
    `,
  ],
})
export class SourceListPage {
  private readonly api = inject(IntegrationApi);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  private readonly router = inject(Router);
  protected readonly isEngineer = inject(SessionService).hasAnyRole('DATA_ENGINEER');
  protected readonly sources = loader<Page<DataSource>>();
  protected readonly busy = signal<number | null>(null);
  protected readonly types = Object.entries(TYPE_LABELS);
  q = '';
  type = '';
  status = '';

  constructor() {
    this.load();
  }

  load(): void {
    this.sources.load(this.api.sources({ q: this.q || undefined, type: this.type || undefined, status: this.status || undefined }), true);
  }

  typeLabel(t: string | undefined): string {
    return TYPE_LABELS[t ?? ''] ?? t ?? '';
  }

  async setStatus(s: DataSource, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    if (!s.id) return;
    if (status === 'PAUSED') {
      const ok = await this.dialogs.confirm({ title: 'Tạm dừng nguồn', message: `Lịch ingest của “${s.name}” sẽ dừng cho tới khi kích hoạt lại.`, confirmLabel: 'Tạm dừng' });
      if (!ok) return;
    }
    this.api.updateSource(s.id, { status }).subscribe({
      next: () => {
        this.toast.success(status === 'ACTIVE' ? 'Đã kích hoạt nguồn' : 'Đã tạm dừng nguồn');
        this.load();
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  ingest(s: DataSource): void {
    if (!s.id) return;
    if (s.type === 'FILE') {
      void this.router.navigate(['/sources', s.id], { queryParams: { step: 2 } });
      return;
    }
    this.busy.set(s.id);
    this.api.triggerRun(s.id).subscribe({
      next: (run) => {
        this.busy.set(null);
        this.toast.success('Đã đưa vào hàng đợi');
        void this.router.navigate(['/runs', run.id]);
      },
      error: (e: unknown) => {
        this.busy.set(null);
        this.toast.error(problemMessage(toProblem(e)));
      },
    });
  }
}
