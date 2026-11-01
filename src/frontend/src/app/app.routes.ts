import { Routes } from '@angular/router';
import type { RoleCode } from './core/api/models';
import { authGuard, roleGuard, unsavedChangesGuard } from './core/auth/guards';
import { AppShellComponent } from './shell/app-shell';

const RV: RoleCode = 'REPORT_VIEWER';
const BA: RoleCode = 'BI_ANALYST';
const DS: RoleCode = 'DATA_STEWARD';
const DE: RoleCode = 'DATA_ENGINEER';
const PA: RoleCode = 'PLATFORM_ADMIN';

/** Route theo sitemap docs/04 §2 (P01–P27). Guard vai trò chỉ phục vụ UX; backend luôn kiểm tra quyền. */
const role = (...roles: RoleCode[]) => ({ canMatch: [roleGuard], data: { roles } });

export const routes: Routes = [
  { path: 'login', title: 'Đăng nhập · AiiA', loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage) },
  {
    path: '',
    component: AppShellComponent,
    canMatch: [authGuard],
    children: [
      { path: '', title: 'Trang chủ · AiiA', loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage) },
      { path: 'me', title: 'Hồ sơ & quyền của tôi · AiiA', loadComponent: () => import('./features/me/me.page').then((m) => m.MePage) },
      { path: '403', title: 'Không có quyền · AiiA', loadComponent: () => import('./features/errors/error.pages').then((m) => m.ForbiddenPage) },

      { path: 'profiles', title: 'Hồ sơ 360° · AiiA', ...role(RV, BA, DS), loadComponent: () => import('./features/profiles/profile-search.page').then((m) => m.ProfileSearchPage) },
      { path: 'profiles/:personId', title: 'Hồ sơ 360° · AiiA', ...role(RV, BA, DS), loadComponent: () => import('./features/profiles/profile-detail.page').then((m) => m.ProfileDetailPage) },

      { path: 'dashboards', title: 'Dashboard · AiiA', loadComponent: () => import('./features/dashboards/dashboard-library.page').then((m) => m.DashboardLibraryPage) },
      { path: 'dashboards/new', title: 'Thiết kế dashboard · AiiA', ...role(BA), canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/dashboards/dashboard-builder.page').then((m) => m.DashboardBuilderPage) },
      { path: 'dashboards/:id/edit', title: 'Thiết kế dashboard · AiiA', ...role(BA), canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/dashboards/dashboard-builder.page').then((m) => m.DashboardBuilderPage) },
      { path: 'dashboards/:id', title: 'Dashboard · AiiA', loadComponent: () => import('./features/dashboards/dashboard-view.page').then((m) => m.DashboardViewPage) },
      { path: 'semantic', title: 'Semantic model · AiiA', ...role(BA, DS), loadComponent: () => import('./features/semantic/semantic.page').then((m) => m.SemanticPage) },
      { path: 'reports', title: 'Báo cáo tự động · AiiA', ...role(RV, BA, DS), loadComponent: () => import('./features/reports/reports.page').then((m) => m.ReportsPage) },
      { path: 'assistant', title: 'Trợ lý hỏi-đáp · AiiA', ...role(RV, BA, DS), loadComponent: () => import('./features/assistant/assistant.page').then((m) => m.AssistantPage) },
      { path: 'assistant/:conversationId', title: 'Trợ lý hỏi-đáp · AiiA', ...role(RV, BA, DS), loadComponent: () => import('./features/assistant/assistant.page').then((m) => m.AssistantPage) },

      { path: 'sources', title: 'Nguồn dữ liệu · AiiA', ...role(DE, DS, PA), loadComponent: () => import('./features/sources/source-list.page').then((m) => m.SourceListPage) },
      { path: 'sources/new', title: 'Đăng ký nguồn · AiiA', ...role(DE), loadComponent: () => import('./features/sources/source-wizard.page').then((m) => m.SourceWizardPage) },
      { path: 'sources/:id', title: 'Cấu hình nguồn · AiiA', ...role(DE, DS, PA), loadComponent: () => import('./features/sources/source-wizard.page').then((m) => m.SourceWizardPage) },
      { path: 'runs', title: 'Giám sát pipeline · AiiA', ...role(DE, DS, PA), loadComponent: () => import('./features/runs/runs.page').then((m) => m.RunsPage) },
      { path: 'runs/:runId', title: 'Giám sát pipeline · AiiA', ...role(DE, DS, PA), loadComponent: () => import('./features/runs/runs.page').then((m) => m.RunsPage) },
      { path: 'explorer', title: 'Data explorer · AiiA', ...role(DE, DS), loadComponent: () => import('./features/explorer/explorer.page').then((m) => m.ExplorerPage) },

      { path: 'catalog', title: 'Data catalog · AiiA', loadComponent: () => import('./features/catalog/catalog.page').then((m) => m.CatalogPage) },
      { path: 'catalog/datasets/:id', title: 'Dataset · AiiA', loadComponent: () => import('./features/catalog/dataset-detail.page').then((m) => m.DatasetDetailPage) },
      { path: 'quality/rules', title: 'Quy tắc chất lượng · AiiA', ...role(DS, DE), loadComponent: () => import('./features/quality/rules.page').then((m) => m.RulesPage) },
      { path: 'quality', title: 'Chất lượng & issue · AiiA', ...role(DS, DE), loadComponent: () => import('./features/quality/quality.page').then((m) => m.QualityPage) },
      { path: 'identity', title: 'Đối soát danh tính · AiiA', ...role(DS), loadComponent: () => import('./features/identity/identity.page').then((m) => m.IdentityPage) },
      { path: 'lineage', title: 'Lineage · AiiA', ...role(PA, DE, DS, BA), loadComponent: () => import('./features/lineage/lineage.page').then((m) => m.LineagePage) },
      { path: 'alerts', title: 'Cảnh báo bất thường · AiiA', loadComponent: () => import('./features/alerts/alerts.page').then((m) => m.AlertsPage) },
      { path: 'access', title: 'Yêu cầu truy cập · AiiA', loadComponent: () => import('./features/access/access.page').then((m) => m.AccessPage) },

      { path: 'admin/users', title: 'Người dùng & vai trò · AiiA', ...role(PA), loadComponent: () => import('./features/admin/users.page').then((m) => m.UsersPage) },
      { path: 'admin/policies', title: 'Chính sách phân quyền · AiiA', ...role(PA), loadComponent: () => import('./features/admin/policies.page').then((m) => m.PoliciesPage) },
      { path: 'admin/audit', title: 'Nhật ký kiểm toán · AiiA', ...role(PA, DS), loadComponent: () => import('./features/admin/audit.page').then((m) => m.AuditPage) },

      { path: '**', title: 'Không tìm thấy · AiiA', loadComponent: () => import('./features/errors/error.pages').then((m) => m.NotFoundPage) },
    ],
  },
];
