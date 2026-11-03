import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { AdminUser, OrgUnit, Page, RoleAssignment, RoleCode } from '../../core/api/models';
import { AdminApi } from '../../core/api/services';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { ROLE_LABELS } from '../../core/util/labels';
import { loader } from '../../shared/async';
import { StatusBadgeComponent } from '../../shared/badges';
import { DrawerComponent, ModalComponent, PageHeaderComponent, PagerComponent } from '../../shared/overlays';
import { LabelPipe, RelTimePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';

const ROLES = Object.keys(ROLE_LABELS) as RoleCode[];

/** P25 — Người dùng và vai trò theo phạm vi đơn vị (US24). */
@Component({
  selector: 'aiia-users-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, PagerComponent, DrawerComponent, ModalComponent, StateViewComponent, StatusBadgeComponent, LabelPipe, RelTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <aiia-page-header title="Người dùng & vai trò" subtitle="Mỗi vai trò gắn với một phạm vi đơn vị; phạm vi để trống nghĩa là toàn trường. Hệ thống luôn còn ít nhất một Quản trị hệ thống.">
        <a class="btn" routerLink="/admin/policies">Chính sách phân quyền</a>
        <button type="button" class="btn primary" (click)="openCreate()">+ Người dùng</button>
      </aiia-page-header>

      <form class="card row filters" (ngSubmit)="search()">
        <input class="input grow" name="q" placeholder="Tìm theo tên hoặc email" aria-label="Tìm người dùng" [(ngModel)]="q" />
        <select class="input" name="role" aria-label="Vai trò" [(ngModel)]="role" (ngModelChange)="search()">
          <option value="">Mọi vai trò</option>
          @for (r of roles; track r) {
            <option [value]="r">{{ r | label: 'role' }}</option>
          }
        </select>
        <select class="input" name="status" aria-label="Trạng thái" [(ngModel)]="status" (ngModelChange)="search()">
          <option value="">Mọi trạng thái</option>
          <option value="ACTIVE">Hoạt động</option>
          <option value="INACTIVE">Đã khóa</option>
        </select>
        <button type="submit" class="btn">Tìm</button>
      </form>

      <section class="card flush">
        @switch (users.state().status) {
          @case ('loading') { <div style="padding: 16px"><aiia-state kind="loading" /></div> }
          @case ('error') { <aiia-state kind="error" [message]="users.message()" actionLabel="Thử lại" (action)="load()" /> }
          @default {
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Họ tên</th><th>Email</th><th>Đơn vị</th><th>Vai trò (phạm vi)</th><th>Đăng nhập gần nhất</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  @for (u of users.data?.items ?? []; track u.id) {
                    <tr class="clickable" tabindex="0" (click)="edit(u)" (keydown.enter)="edit(u)">
                      <td>{{ u.fullName }}</td>
                      <td class="small">{{ u.email }}</td>
                      <td>{{ u.orgUnit?.name }}</td>
                      <td>
                        <div class="row">
                          @for (r of u.roles ?? []; track $index) {
                            <span class="chip neutral">{{ r.role | label: 'role' }}{{ r.scopeOrgUnit ? ' · ' + r.scopeOrgUnit : '' }}</span>
                          }
                        </div>
                      </td>
                      <td>{{ u.lastLoginAt ? (u.lastLoginAt | relTime) : 'Chưa đăng nhập' }}</td>
                      <td><aiia-status [status]="u.status" /></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6"><aiia-state message="Không có người dùng phù hợp" /></td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (users.data; as p) {
              <aiia-pager [page]="page()" [pageSize]="20" [total]="p.total" (pageChange)="page.set($event); load()" />
            }
          }
        }
      </section>

      @if (editing(); as u) {
        <aiia-drawer [title]="u.fullName ?? ''" (closed)="editing.set(null)">
          <div class="stack">
            <div class="small muted">{{ u.email }} · {{ u.orgUnit?.name }}</div>
            <div class="row"><aiia-status [status]="u.status" /></div>
            <h3 style="margin: 8px 0 0">Vai trò</h3>
            @for (r of roleDraft; track $index; let i = $index) {
              <div class="row role-row">
                <select class="input" [(ngModel)]="r.role" [attr.aria-label]="'Vai trò ' + (i + 1)">
                  @for (x of roles; track x) {
                    <option [value]="x">{{ x | label: 'role' }}</option>
                  }
                </select>
                <select class="input" [(ngModel)]="r.scopeOrgUnit" [attr.aria-label]="'Phạm vi ' + (i + 1)">
                  <option [ngValue]="null">Toàn trường</option>
                  @for (o of orgUnits(); track o.code) {
                    <option [ngValue]="o.code">{{ o.name }}</option>
                  }
                </select>
                <button type="button" class="btn ghost sm" aria-label="Bỏ vai trò" (click)="roleDraft.splice(i, 1)">✕</button>
              </div>
            }
            <div><button type="button" class="link-btn" (click)="roleDraft.push({ role: 'REPORT_VIEWER', scopeOrgUnit: u.orgUnit?.code ?? null })">+ Thêm vai trò</button></div>
            @if (drawerError()) {
              <div class="banner danger small" role="alert">{{ drawerError() }}</div>
            }
            <div class="row">
              @if (u.status === 'ACTIVE') {
                <button type="button" class="btn danger" (click)="setStatus(u, 'INACTIVE')">Khóa tài khoản</button>
              } @else {
                <button type="button" class="btn" (click)="setStatus(u, 'ACTIVE')">Mở khóa</button>
              }
              <span class="spacer"></span>
              <button type="button" class="btn primary" (click)="saveRoles(u)">Lưu vai trò</button>
            </div>
            <a class="small" routerLink="/admin/audit" [queryParams]="{ actorId: u.id }">Xem nhật ký của người này</a>
          </div>
        </aiia-drawer>
      }

      @if (creating()) {
        <aiia-modal title="Thêm người dùng" (closed)="creating.set(false)">
          <div class="stack">
            <label class="field"><span class="small muted">Email trường *</span><input class="input" type="email" [(ngModel)]="newUser.email" placeholder="ten@uni.edu.vn" /></label>
            <label class="field"><span class="small muted">Họ tên *</span><input class="input" [(ngModel)]="newUser.fullName" /></label>
            <label class="field"><span class="small muted">Đơn vị *</span>
              <select class="input" [(ngModel)]="newUser.orgUnitCode">
                @for (o of orgUnits(); track o.code) {
                  <option [value]="o.code">{{ o.name }}</option>
                }
              </select>
            </label>
            <label class="field"><span class="small muted">Vai trò ban đầu</span>
              <select class="input" [(ngModel)]="newUser.role">
                @for (x of roles; track x) {
                  <option [value]="x">{{ x | label: 'role' }}</option>
                }
              </select>
            </label>
            @if (createError()) {
              <div class="banner danger small" role="alert">{{ createError() }}</div>
            }
          </div>
          <div modal-foot class="modal-foot">
            <button type="button" class="btn" (click)="creating.set(false)">Hủy</button>
            <button type="button" class="btn primary" (click)="create()">Tạo</button>
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
      .grow {
        flex: 1;
        min-width: 200px;
      }
      .role-row {
        flex-wrap: nowrap;
      }
      .role-row .input {
        flex: 1;
      }
    `,
  ],
})
export class UsersPage {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  protected readonly roles = ROLES;
  protected readonly users = loader<Page<AdminUser>>();
  protected readonly orgUnits = signal<OrgUnit[]>([]);
  protected readonly page = signal(1);
  protected readonly editing = signal<AdminUser | null>(null);
  protected readonly drawerError = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  roleDraft: RoleAssignment[] = [];
  newUser = { email: '', fullName: '', orgUnitCode: 'CNTT', role: 'REPORT_VIEWER' as RoleCode };
  q = '';
  role = '';
  status = '';

  constructor() {
    this.load();
    this.api.orgUnits().subscribe((o) => this.orgUnits.set(o));
  }

  search(): void {
    this.page.set(1);
    this.load();
  }

  load(): void {
    this.users.load(this.api.users({ q: this.q || undefined, role: this.role || undefined, status: this.status || undefined, page: this.page(), pageSize: 20 }), true);
  }

  edit(u: AdminUser): void {
    this.editing.set(u);
    this.drawerError.set(null);
    this.roleDraft = (u.roles ?? []).map((r) => ({ role: r.role, scopeOrgUnit: r.scopeOrgUnit ?? null }));
  }

  saveRoles(u: AdminUser): void {
    if (!u.id) return;
    this.drawerError.set(null);
    this.api.setRoles(u.id, this.roleDraft).subscribe({
      next: (updated) => {
        this.editing.set(updated);
        this.toast.success('Đã lưu vai trò — có hiệu lực từ lần tải trang kế tiếp của người dùng');
        this.load();
      },
      error: (e: unknown) => this.drawerError.set(problemMessage(toProblem(e))),
    });
  }

  async setStatus(u: AdminUser, status: 'ACTIVE' | 'INACTIVE'): Promise<void> {
    if (!u.id) return;
    if (status === 'INACTIVE') {
      const ok = await this.dialogs.confirm({ title: 'Khóa tài khoản', message: `${u.fullName} sẽ không đăng nhập được; các quyền đang có được giữ nguyên để mở khóa lại.`, confirmLabel: 'Khóa', danger: true });
      if (!ok) return;
    }
    this.api.updateUser(u.id, { status }).subscribe({
      next: (updated) => {
        this.editing.set(updated);
        this.toast.success(status === 'ACTIVE' ? 'Đã mở khóa' : 'Đã khóa tài khoản');
        this.load();
      },
      error: (e: unknown) => this.drawerError.set(problemMessage(toProblem(e))),
    });
  }

  openCreate(): void {
    this.createError.set(null);
    this.newUser = { email: '', fullName: '', orgUnitCode: this.orgUnits().find((o) => o.type === 'FACULTY')?.code ?? 'CNTT', role: 'REPORT_VIEWER' };
    this.creating.set(true);
  }

  create(): void {
    const n = this.newUser;
    this.api.createUser({ email: n.email.trim(), fullName: n.fullName.trim(), orgUnitCode: n.orgUnitCode, roles: [{ role: n.role, scopeOrgUnit: n.role === 'PLATFORM_ADMIN' ? null : n.orgUnitCode }] }).subscribe({
      next: () => {
        this.creating.set(false);
        this.toast.success('Đã tạo người dùng');
        this.load();
      },
      error: (e: unknown) => this.createError.set(problemMessage(toProblem(e))),
    });
  }
}
