import type { HomeSummary, Me } from '../../api/models';
import { dashboardSummaryOf, datasetScore, grantOf, runOf } from '../mappers';
import { MockRouter, noContent, ok, paginate } from '../router';

export function registerMe(router: MockRouter): void {
  router
    .add('GET', '/me', ({ user, db }) => {
      const me: Me = { id: user.id, email: user.email, fullName: user.fullName, orgUnit: db.orgUnitRef(user.orgUnitCode), roles: user.roles };
      return ok(me);
    })
    .add('GET', '/me/grants', ({ user, db }) => ok(db.activeGrants(user.id).map((g) => grantOf(db, g))))
    .add('POST', '/me/logout', ({ user, db }) => {
      db.audit(user.id, 'LOGOUT', 'SESSION', null);
      return noContent();
    })
    .add('GET', '/me/home', ({ user, db }) => {
      const has = (...roles: string[]) => db.hasRole(user, ...roles);
      const scores = db.datasets.map((d) => datasetScore(db, d.id)).filter((s): s is number => s !== null);
      const summary: HomeSummary = {
        favoriteDashboards: db.dashboards
          .filter((d) => db.favorites.has(`${user.id}:${d.id}`))
          .map((d) => dashboardSummaryOf(db, user, d)),
        dataHealth: {
          dqScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 100,
          staleDatasets: db.datasets.filter((d) => db.clock() - d.lastUpdatedAt > d.freshnessSlaMinutes * 60_000).length,
          openAlerts: db.alerts.filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED').length,
        },
        failedRuns: has('DATA_ENGINEER', 'DATA_STEWARD', 'PLATFORM_ADMIN')
          ? db.runs
              .filter((r) => db.runStatus(r) === 'FAILED' || db.runStatus(r) === 'PARTIAL')
              .sort((a, b) => b.queuedAt - a.queuedAt)
              .slice(0, 5)
              .map((r) => runOf(db, r))
          : [],
        openIssues: has('DATA_STEWARD', 'DATA_ENGINEER') ? db.issues.filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS').length : 0,
        pendingMatches: has('DATA_STEWARD') ? db.candidates.filter((c) => c.status === 'PENDING').length : 0,
        pendingAccessReviews: has('DATA_STEWARD') ? db.requests.filter((r) => r.status === 'PENDING').length : 0,
        recent: db.recents
          .filter((r) => r.userId === user.id)
          .slice(0, 8)
          .map((r) => ({ kind: r.kind, id: r.id, title: r.title, viewedAt: r.viewedAt })),
      };
      return ok(summary);
    })
    .add('GET', '/notifications', ({ user, db, query }) => {
      const unread = query.get('unread') === 'true';
      const items = db.notifications.filter((n) => n.userId === user.id && (!unread || !n.readAt));
      return ok(paginate(items, query));
    })
    .add('POST', '/notifications/:id/read', ({ user, db, params }) => {
      const n = db.notifications.find((x) => x.id === Number(params['id']) && x.userId === user.id);
      if (n) n.readAt = new Date(db.clock()).toISOString();
      return noContent();
    });
}
