import type { RoleCode } from '../core/api/models';

export interface NavItem {
  label: string;
  link: string;
  /** Rỗng = mọi vai trò. */
  roles: RoleCode[];
  adv?: boolean;
  exact?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const RV: RoleCode = 'REPORT_VIEWER';
const BA: RoleCode = 'BI_ANALYST';
const DS: RoleCode = 'DATA_STEWARD';
const DE: RoleCode = 'DATA_ENGINEER';
const PA: RoleCode = 'PLATFORM_ADMIN';

/** Sidebar 6 nhóm (docs/04 §2, README §4.2): nhóm chỉ hiện khi vai trò dùng được ít nhất một mục. */
export const NAV: NavGroup[] = [
  { label: '', items: [{ label: 'Trang chủ', link: '/', roles: [], exact: true }] },
  { label: 'Hồ sơ 360°', items: [{ label: 'Tìm kiếm hồ sơ', link: '/profiles', roles: [RV, BA, DS] }] },
  {
    label: 'Phân tích & BI',
    items: [
      { label: 'Dashboard', link: '/dashboards', roles: [] },
      { label: 'Trợ lý hỏi-đáp', link: '/assistant', roles: [RV, BA, DS], adv: true },
      { label: 'Semantic model', link: '/semantic', roles: [BA, DS], adv: true },
      { label: 'Báo cáo tự động', link: '/reports', roles: [RV, BA, DS], adv: true },
    ],
  },
  {
    label: 'Tích hợp dữ liệu',
    items: [
      { label: 'Nguồn dữ liệu', link: '/sources', roles: [DE, DS, PA] },
      { label: 'Giám sát pipeline', link: '/runs', roles: [DE, DS, PA] },
      { label: 'Data explorer', link: '/explorer', roles: [DE, DS] },
    ],
  },
  {
    label: 'Quản trị dữ liệu',
    items: [
      { label: 'Data catalog', link: '/catalog', roles: [] },
      { label: 'Chất lượng & issue', link: '/quality', roles: [DS, DE], exact: true },
      { label: 'Quy tắc chất lượng', link: '/quality/rules', roles: [DS, DE] },
      { label: 'Đối soát danh tính', link: '/identity', roles: [DS] },
      { label: 'Lineage', link: '/lineage', roles: [PA, DE, DS, BA], adv: true },
      { label: 'Cảnh báo bất thường', link: '/alerts', roles: [], adv: true },
      { label: 'Yêu cầu truy cập', link: '/access', roles: [] },
    ],
  },
  {
    label: 'Quản trị hệ thống',
    items: [
      { label: 'Người dùng & vai trò', link: '/admin/users', roles: [PA] },
      { label: 'Chính sách phân quyền', link: '/admin/policies', roles: [PA], adv: true },
      { label: 'Nhật ký kiểm toán', link: '/admin/audit', roles: [PA, DS] },
    ],
  },
];

export function visibleNav(roles: Set<RoleCode>): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.length === 0 || i.roles.some((r) => roles.has(r))) })).filter((g) => g.items.length);
}
