import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment, UrlTree, provideRouter } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import type { RoleCode } from '../api/models';
import { roleGuard } from './guards';
import { SessionService } from './session.service';

class SessionStub {
  constructor(
    private readonly loaded: boolean,
    private readonly mine: RoleCode[],
  ) {}
  ensureLoaded = () => of(this.loaded);
  hasAnyRole = (...roles: RoleCode[]) => roles.some((r) => this.mine.includes(r));
}

function run(session: SessionStub, roles: RoleCode[]): Promise<boolean | UrlTree> {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: SessionService, useValue: session }] });
  const route: Route = { path: 'x', data: { roles } };
  const result = TestBed.runInInjectionContext(() => roleGuard(route, [] as UrlSegment[])) as Observable<boolean | UrlTree>;
  return firstValueFrom(result);
}

describe('roleGuard', () => {
  const url = (r: boolean | UrlTree) => (r instanceof UrlTree ? TestBed.inject(Router).serializeUrl(r) : r);

  it('cho qua khi có một trong các vai trò yêu cầu', async () => {
    expect(await run(new SessionStub(true, ['BI_ANALYST']), ['REPORT_VIEWER', 'BI_ANALYST'])).toBeTrue();
  });

  it('chuyển tới /403 khi thiếu vai trò', async () => {
    expect(url(await run(new SessionStub(true, ['REPORT_VIEWER']), ['PLATFORM_ADMIN']))).toBe('/403');
  });

  it('chuyển tới /login khi chưa đăng nhập', async () => {
    expect(url(await run(new SessionStub(false, []), ['PLATFORM_ADMIN']))).toBe('/login');
  });

  it('route không khai báo vai trò thì ai đăng nhập cũng vào được', async () => {
    expect(await run(new SessionStub(true, ['REPORT_VIEWER']), [])).toBeTrue();
  });
});
