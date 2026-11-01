import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, interval, startWith, switchMap, catchError, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../environments/environment';
import type { Notification } from '../core/api/models';
import { MeApi } from '../core/api/services';
import { SessionService } from '../core/auth/session.service';
import { ROLE_LABELS } from '../core/util/labels';
import { RelTimePipe } from '../shared/pipes';
import { GlobalSearchComponent } from './global-search';
import { ConfirmHostComponent, RequestAccessDialogComponent, ToastHostComponent } from './hosts';
import { visibleNav } from './nav';

/** Khung ứng dụng (README §4.2): thanh trên, sidebar theo vai trò, vùng nội dung, lớp phủ. */
@Component({
  selector: 'aiia-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, RelTimePipe, GlobalSearchComponent, ToastHostComponent, ConfirmHostComponent, RequestAccessDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
})
export class AppShellComponent {
  protected readonly session = inject(SessionService);
  private readonly meApi = inject(MeApi);
  private readonly router = inject(Router);

  protected readonly demo = environment.useMockApi;
  protected readonly nav = computed(() => visibleNav(this.session.roles()));
  protected readonly roleText = computed(() => (this.session.me()?.roles ?? []).map((r) => ROLE_LABELS[r.role] + (r.scopeOrgUnit ? ` (${r.scopeOrgUnit})` : '')).join(', '));
  protected readonly canAsk = computed(() => this.session.hasAnyRole('REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD'));
  protected readonly searchOpen = signal(false);
  protected readonly bellOpen = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly navOpen = signal(false);
  protected readonly notifications = signal<Notification[]>([]);
  protected readonly unread = computed(() => this.notifications().filter((n) => !n.readAt).length);

  constructor() {
    interval(30_000)
      .pipe(
        startWith(0),
        switchMap(() => this.meApi.notifications({ pageSize: 20 }).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((page) => page && this.notifications.set(page.items));
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => {
        this.navOpen.set(false);
        this.menuOpen.set(false);
        this.bellOpen.set(false);
      });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.searchOpen.set(true);
    }
  }

  openNotification(n: Notification): void {
    if (!n.readAt && n.id) {
      this.meApi.markRead(n.id).subscribe();
      this.notifications.update((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    }
    this.bellOpen.set(false);
    if (n.link) void this.router.navigateByUrl(n.link);
  }

  logout(): void {
    this.session.logout();
  }
}
