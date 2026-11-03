import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Page, ProfileSummary } from '../../core/api/models';
import { ProfilesApi } from '../../core/api/services';
import { loader } from '../../shared/async';
import { LabelPipe } from '../../shared/pipes';
import { PageHeaderComponent, PagerComponent } from '../../shared/overlays';
import { StateViewComponent } from '../../shared/state-view';

/** P05 — Tìm kiếm hồ sơ 360° (US11): chỉ trả hồ sơ trong phạm vi quyền. */
@Component({
  selector: 'aiia-profile-search-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, PagerComponent, StateViewComponent, LabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Tìm kiếm hồ sơ 360°" subtitle="Tìm theo mã, họ tên (không cần dấu), email. Kết quả giới hạn trong phạm vi đơn vị bạn được cấp." />
      <section class="card stack">
        <div class="filters">
          <input class="input" style="flex: 2; min-width: 240px" placeholder="VD: nguyen van an, SV2023…" aria-label="Từ khóa" [ngModel]="q()" (ngModelChange)="q.set($event); changed()" />
          <select class="input" aria-label="Loại hồ sơ" [ngModel]="type()" (ngModelChange)="type.set($event); changed()">
            <option value="">Mọi loại</option>
            <option value="STUDENT">Sinh viên</option>
            <option value="LECTURER">Giảng viên</option>
            <option value="STAFF">Cán bộ</option>
          </select>
          <select class="input" aria-label="Đơn vị" [ngModel]="orgUnit()" (ngModelChange)="orgUnit.set($event); changed()">
            <option value="">Mọi đơn vị</option>
            @for (o of units; track o[0]) {
              <option [value]="o[0]">{{ o[1] }}</option>
            }
          </select>
          <select class="input" aria-label="Khóa" [ngModel]="cohort()" (ngModelChange)="cohort.set($event); changed()">
            <option value="">Mọi khóa</option>
            @for (c of cohorts; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
          <select class="input" aria-label="Trạng thái" [ngModel]="status()" (ngModelChange)="status.set($event); changed()">
            <option value="">Mọi trạng thái</option>
            <option value="STUDYING">Đang học</option>
            <option value="RESERVED">Bảo lưu</option>
            <option value="GRADUATED">Tốt nghiệp</option>
            <option value="DROPPED">Thôi học</option>
          </select>
          @if (hasFilter()) {
            <button type="button" class="btn ghost sm" (click)="clear()">Xóa lọc</button>
          }
        </div>
      </section>

      <section class="card flush" style="margin-top: 16px">
        @switch (results.state().status) {
          @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
          @case ('error') { <aiia-state kind="error" [message]="results.message()" actionLabel="Thử lại" (action)="search()" /> }
          @default {
            @if (results.data?.items?.length) {
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Họ tên</th><th>Mã</th><th>Vai trò</th><th>Đơn vị</th><th>Trạng thái</th><th class="num">Độ đầy đủ</th></tr></thead>
                  <tbody>
                    @for (p of results.data?.items; track p.personId) {
                      <tr class="clickable" [routerLink]="['/profiles', p.personId]">
                        <td><a [routerLink]="['/profiles', p.personId]">{{ p.fullName }}</a></td>
                        <td class="mono">{{ p.code }}</td>
                        <td>
                          @for (r of p.roles ?? []; track r) {
                            <span class="chip neutral">{{ r | label: 'subject' }}</span>
                          }
                        </td>
                        <td>{{ p.orgUnit?.name }}</td>
                        <td>{{ p.status }}</td>
                        <td class="num">{{ ((p.completeness ?? 0) * 100).toFixed(0) }}%</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <aiia-pager [page]="page()" [pageSize]="20" [total]="results.data?.total ?? 0" (pageChange)="page.set($event); search()" />
            } @else {
              <aiia-state kind="empty" message="Không tìm thấy hồ sơ" detail="Không có hồ sơ khớp trong phạm vi quyền của bạn." [actionLabel]="hasFilter() ? 'Xóa bộ lọc' : null" (action)="clear()" />
            }
          }
        }
      </section>
    </div>
  `,
  styles: [
    `
      .filters {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .filters select {
        min-width: 140px;
      }
    `,
  ],
})
export class ProfileSearchPage {
  /** Đồng bộ từ query param (?q=…) — trạng thái lọc nằm trên URL để chia sẻ. */
  readonly qParam = input<string | undefined>(undefined, { alias: 'q' });
  private readonly api = inject(ProfilesApi);
  private readonly router = inject(Router);
  protected readonly results = loader<Page<ProfileSummary>>();

  protected readonly q = signal('');
  protected readonly type = signal('');
  protected readonly orgUnit = signal('');
  protected readonly cohort = signal('');
  protected readonly status = signal('');
  protected readonly page = signal(1);
  protected readonly units = [['CNTT', 'Khoa CNTT'], ['KT', 'Khoa Kinh tế'], ['NN', 'Khoa Ngoại ngữ'], ['PDT', 'Phòng Đào tạo'], ['TCCB', 'Phòng TCCB'], ['KHCN', 'Phòng KHCN'], ['TTDL', 'Trung tâm Dữ liệu']];
  protected readonly cohorts = ['K64', 'K65', 'K66', 'K67', 'K68'];
  private readonly changes = new Subject<void>();

  constructor() {
    effect(() => {
      const fromUrl = this.qParam();
      if (fromUrl !== undefined) this.q.set(fromUrl);
    });
    this.changes.pipe(debounceTime(300), takeUntilDestroyed(inject(DestroyRef))).subscribe(() => {
      this.page.set(1);
      this.search();
    });
    queueMicrotask(() => this.search());
  }

  changed(): void {
    this.changes.next();
  }

  hasFilter(): boolean {
    return !!(this.q() || this.type() || this.orgUnit() || this.cohort() || this.status());
  }

  clear(): void {
    this.q.set('');
    this.type.set('');
    this.orgUnit.set('');
    this.cohort.set('');
    this.status.set('');
    this.page.set(1);
    this.search();
  }

  search(): void {
    void this.router.navigate([], { queryParams: { q: this.q() || null }, replaceUrl: true });
    this.results.load(this.api.search({ q: this.q(), type: this.type(), orgUnit: this.orgUnit(), cohort: this.cohort(), status: this.status(), page: this.page(), pageSize: 20 }));
  }
}
