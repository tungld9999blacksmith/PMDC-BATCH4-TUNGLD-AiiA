import type { RoleCode } from '../api/models';

/**
 * Tài khoản mẫu cho chế độ demo (mock API). Khi có SSO thật, P01 chuyển sang luồng OIDC
 * và danh sách này không còn được dùng.
 */
export interface DemoAccount {
  id: string;
  fullName: string;
  email: string;
  orgUnitCode: string;
  roles: { role: RoleCode; scopeOrgUnit: string | null }[];
  description: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    fullName: 'TS. Hoàng Minh',
    email: 'minh.h@uni.edu.vn',
    orgUnitCode: 'CNTT',
    roles: [{ role: 'REPORT_VIEWER', scopeOrgUnit: 'CNTT' }],
    description: 'Phó trưởng khoa CNTT — chỉ xem dữ liệu khoa CNTT (persona chính)',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    fullName: 'Nguyễn Thu Hà',
    email: 'ha.nt@uni.edu.vn',
    orgUnitCode: 'PDT',
    roles: [
      { role: 'BI_ANALYST', scopeOrgUnit: null },
      { role: 'REPORT_VIEWER', scopeOrgUnit: null },
    ],
    description: 'Chuyên viên phân tích, Phòng Đào tạo — toàn trường, thiết kế dashboard',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    fullName: 'Trần Quốc Bảo',
    email: 'bao.tq@uni.edu.vn',
    orgUnitCode: 'TTDL',
    roles: [{ role: 'DATA_STEWARD', scopeOrgUnit: null }],
    description: 'Quản trị dữ liệu — chất lượng, đối soát, phân loại, duyệt quyền',
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    fullName: 'Phạm Đức Anh',
    email: 'anh.pd@uni.edu.vn',
    orgUnitCode: 'TTDL',
    roles: [{ role: 'DATA_ENGINEER', scopeOrgUnit: null }],
    description: 'Kỹ sư dữ liệu — nguồn, upload, pipeline',
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    fullName: 'Lê Thanh Tùng',
    email: 'tung.lt@uni.edu.vn',
    orgUnitCode: 'TTDL',
    roles: [{ role: 'PLATFORM_ADMIN', scopeOrgUnit: null }],
    description: 'Quản trị hệ thống — người dùng, chính sách, audit',
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    fullName: 'Võ Ngọc Yến',
    email: 'yen.vn@uni.edu.vn',
    orgUnitCode: 'KT',
    roles: [{ role: 'REPORT_VIEWER', scopeOrgUnit: 'KT' }],
    description: 'Trưởng khoa Kinh tế — chỉ xem dữ liệu khoa KT',
  },
];
