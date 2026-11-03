import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { ID } from './core/mock/db';
import { MockBackend } from './core/mock/mock-backend';
import { ToastService } from './core/ui/toast.service';

/**
 * Smoke test: mở từng trang bằng tài khoản demo có quyền, chạy qua mock API thật,
 * và bắt mọi lỗi runtime (template, null, handler mock). Không kiểm tra nghiệp vụ chi tiết.
 */
type Account = keyof typeof ID;
const ROUTES: [string, Account][] = [
  ['/', 'dean'],
  ['/me', 'analyst'],
  ['/profiles?q=nguyen', 'dean'],
  ['/profiles/:person', 'dean'],
  ['/dashboards', 'dean'],
  ['/dashboards/1', 'dean'],
  ['/dashboards/new', 'analyst'],
  ['/dashboards/1/edit', 'analyst'],
  ['/semantic', 'analyst'],
  ['/reports', 'analyst'],
  ['/assistant', 'dean'],
  ['/sources', 'engineer'],
  ['/sources/new', 'engineer'],
  ['/sources/4?step=2', 'engineer'],
  ['/sources/1?step=3', 'engineer'],
  ['/sources/1?step=4', 'engineer'],
  ['/runs', 'engineer'],
  ['/runs/:run', 'engineer'],
  ['/explorer?layer=GOLD&dataset=14', 'engineer'],
  ['/catalog', 'analyst'],
  ['/catalog?tab=glossary', 'steward'],
  ['/catalog/datasets/14', 'steward'],
  ['/catalog/datasets/14?tab=quality', 'steward'],
  ['/catalog/datasets/14?tab=lineage', 'steward'],
  ['/catalog/datasets/14?tab=preview', 'steward'],
  ['/quality', 'steward'],
  ['/quality/rules', 'steward'],
  ['/identity', 'steward'],
  ['/lineage', 'analyst'],
  ['/alerts', 'steward'],
  ['/access', 'dean'],
  ['/access?box=review', 'steward'],
  ['/admin/users', 'admin'],
  ['/admin/policies', 'admin'],
  ['/admin/audit', 'admin'],
  ['/admin/audit?tab=assistant', 'admin'],
  ['/admin/audit?tab=topics', 'admin'],
];

const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Smoke: mọi trang render không lỗi (mock API)', () => {
  let errors: unknown[];

  beforeEach(() => {
    errors = [];
    spyOn(console, 'error').and.callFake((...args: unknown[]) => errors.push(args));
  });

  afterEach(() => {
    try {
      sessionStorage.removeItem('aiia.token');
    } catch {
      // bỏ qua
    }
  });

  for (const [path, account] of ROUTES) {
    it(`${path} (${account})`, async () => {
      sessionStorage.setItem('aiia.token', `demo:${ID[account]}`);
      TestBed.configureTestingModule({ providers: appConfig.providers });
      const db = TestBed.inject(MockBackend).db;
      const person = db.persons.find((p) => p.student?.faculty === 'CNTT' && !p.staff)!;
      const url = path.replace(':person', person.id).replace(':run', db.runs[0].id);

      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url);
      await settle();
      harness.fixture.detectChanges();
      await settle(300);
      harness.fixture.detectChanges();

      const router = TestBed.inject(Router);
      expect(router.url).not.toBe('/403');
      expect(router.url).not.toContain('/login');
      expect(harness.routeNativeElement?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      const broken = [...harness.fixture.nativeElement.querySelectorAll('aiia-state[data-kind="error"], aiia-state[data-kind="forbidden"]')].map((el) => (el as HTMLElement).textContent?.trim());
      expect(broken).withContext('trạng thái lỗi trên trang').toEqual([]);
      const root = harness.fixture.nativeElement as HTMLElement;
      expect(root.querySelector('main h1, .page h1')?.textContent?.trim()).withContext('tiêu đề trang').toBeTruthy();
      expect(root.querySelectorAll('aiia-state[data-kind="loading"]').length).withContext('kẹt ở trạng thái loading').toBe(0);
      expect(TestBed.inject(ToastService).toasts().filter((t) => t.kind === 'error').map((t) => t.text)).withContext('toast lỗi').toEqual([]);
      expect(errors).withContext(JSON.stringify(errors, (_, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v)).slice(0, 2000)).toEqual([]);
    });
  }
});
