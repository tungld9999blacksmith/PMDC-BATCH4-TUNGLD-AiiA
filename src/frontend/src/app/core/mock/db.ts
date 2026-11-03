/** Kho dữ liệu trong bộ nhớ của mock API, seed tổng hợp và tái lập được. */
import { DEMO_ACCOUNTS } from '../auth/demo-accounts';
import type { MatchRecord, Sensitivity, Widget } from '../api/models';
import { Rng, mockUuid } from './rng';
import { generatePeople, unitsOf } from './seed-people';
import type {
  MAccessRequest,
  MAlert,
  MAudit,
  MBatch,
  MBlockedTopic,
  MCandidate,
  MColumn,
  MConversation,
  MDashboard,
  MDataset,
  MDelivery,
  MExport,
  MGlossaryTerm,
  MGrant,
  MIssue,
  MLineageNode,
  MMapping,
  MMergeEvent,
  MMetric,
  MNotification,
  MOrgUnit,
  MPerson,
  MPolicy,
  MRecent,
  MRule,
  MRun,
  MSource,
  MSubscription,
  MUpload,
  MUser,
} from './types';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const ORG_UNITS: MOrgUnit[] = [
  { code: 'UNI', name: 'Trường Đại học (mẫu)', type: 'UNIVERSITY', parentCode: null },
  { code: 'CNTT', name: 'Khoa Công nghệ thông tin', type: 'FACULTY', parentCode: 'UNI' },
  { code: 'KT', name: 'Khoa Kinh tế', type: 'FACULTY', parentCode: 'UNI' },
  { code: 'NN', name: 'Khoa Ngoại ngữ', type: 'FACULTY', parentCode: 'UNI' },
  { code: 'PDT', name: 'Phòng Đào tạo', type: 'OFFICE', parentCode: 'UNI' },
  { code: 'TCCB', name: 'Phòng Tổ chức cán bộ', type: 'OFFICE', parentCode: 'UNI' },
  { code: 'KHCN', name: 'Phòng Khoa học công nghệ', type: 'OFFICE', parentCode: 'UNI' },
  { code: 'TTDL', name: 'Trung tâm Dữ liệu', type: 'CENTER', parentCode: 'UNI' },
];

export const ID = {
  dean: DEMO_ACCOUNTS[0].id,
  analyst: DEMO_ACCOUNTS[1].id,
  steward: DEMO_ACCOUNTS[2].id,
  engineer: DEMO_ACCOUNTS[3].id,
  admin: DEMO_ACCOUNTS[4].id,
  deanKt: DEMO_ACCOUNTS[5].id,
};

export class MockDb {
  readonly seededAt: number;
  orgUnits = ORG_UNITS;
  users: MUser[] = [];
  persons: MPerson[] = [];
  sources: MSource[] = [];
  runs: MRun[] = [];
  uploads: MUpload[] = [];
  batches: MBatch[] = [];
  mappings: MMapping[] = [];
  datasets: MDataset[] = [];
  glossary: MGlossaryTerm[] = [];
  rules: MRule[] = [];
  issues: MIssue[] = [];
  candidates: MCandidate[] = [];
  merges: MMergeEvent[] = [];
  requests: MAccessRequest[] = [];
  grants: MGrant[] = [];
  dashboards: MDashboard[] = [];
  favorites = new Set<string>();
  exports: MExport[] = [];
  metrics: MMetric[] = [];
  subscriptions: MSubscription[] = [];
  deliveries: MDelivery[] = [];
  alerts: MAlert[] = [];
  lineageNodes: MLineageNode[] = [];
  lineageEdges: { id: number; from: number; to: number; transformRef: string | null }[] = [];
  conversations: MConversation[] = [];
  policies: MPolicy[] = [];
  audits: MAudit[] = [];
  notifications: MNotification[] = [];
  blockedTopics: MBlockedTopic[] = [];
  recents: MRecent[] = [];
  private seq: Record<string, number> = {};

  constructor(now: number) {
    this.seededAt = now;
  }

  /** Thời điểm hiện tại cho các thao tác mới (run, quyền hết hạn…). */
  clock(): number {
    return Date.now();
  }

  nextId(kind: string, start = 1000): number {
    this.seq[kind] = (this.seq[kind] ?? start) + 1;
    return this.seq[kind];
  }

  user(id: string | null | undefined): MUser | undefined {
    return id ? this.users.find((u) => u.id === id) : undefined;
  }

  userRef(id: string | null | undefined): { id: string; fullName: string } | undefined {
    const u = this.user(id);
    return u ? { id: u.id, fullName: u.fullName } : undefined;
  }

  orgUnitRef(code: string): { code: string; name: string } {
    return { code, name: this.orgUnits.find((o) => o.code === code)?.name ?? code };
  }

  /** Phạm vi đơn vị của người dùng: null = toàn trường. */
  scopeOf(user: MUser): string[] | null {
    if (user.roles.some((r) => !r.scopeOrgUnit)) return null;
    return user.roles.map((r) => r.scopeOrgUnit as string);
  }

  hasRole(user: MUser, ...roles: string[]): boolean {
    return user.roles.some((r) => roles.includes(r.role));
  }

  inScope(user: MUser, person: MPerson): boolean {
    const scope = this.scopeOf(user);
    return scope === null || unitsOf(person).some((u) => scope.includes(u));
  }

  activeGrants(userId: string): MGrant[] {
    const now = this.clock();
    return this.grants.filter(
      (g) => g.userId === userId && !g.revokedAt && Date.parse(g.validFrom) <= now && Date.parse(g.validTo) > now,
    );
  }

  hasGrant(userId: string, resourceType: string, resourceId: string): boolean {
    return this.activeGrants(userId).some((g) => g.resourceType === resourceType && g.resourceId === resourceId);
  }

  audit(actorId: string | null, action: string, objectType: string, objectId: string | null, outcome: 'ALLOW' | 'DENY' = 'ALLOW', details: Record<string, unknown> = {}): void {
    this.audits.unshift({
      id: this.nextId('audit', 5000),
      occurredAt: new Date(this.clock()).toISOString(),
      actorId,
      action,
      objectType,
      objectId,
      outcome,
      ip: '10.0.0.24',
      details,
    });
  }

  notify(userId: string, type: string, title: string, link: string | null): void {
    this.notifications.unshift({
      id: this.nextId('notification', 300),
      userId,
      type,
      title,
      link,
      readAt: null,
      createdAt: new Date(this.clock()).toISOString(),
    });
  }

  remember(userId: string, kind: MRecent['kind'], id: string, title: string): void {
    this.recents = [
      { userId, kind, id, title, viewedAt: new Date(this.clock()).toISOString() },
      ...this.recents.filter((r) => !(r.userId === userId && r.kind === kind && r.id === id)),
    ].slice(0, 60);
  }

  dataset(id: number): MDataset | undefined {
    return this.datasets.find((d) => d.id === id);
  }

  datasetByName(fqName: string): MDataset | undefined {
    return this.datasets.find((d) => `${d.schemaName}.${d.tableName}` === fqName);
  }

  /** Trạng thái run tính theo thời gian thực để mô phỏng tiến trình. */
  runStatus(run: MRun): 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' {
    const elapsed = this.clock() - run.queuedAt;
    if (elapsed < 1500) return 'QUEUED';
    if (elapsed < run.durationMs) return 'RUNNING';
    return run.outcome;
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function col(id: number, name: string, dataType: string, sensitivity: Sensitivity, description: string, required = false): MColumn {
  return { id, name, dataType, sensitivity, description, glossaryTermId: null, required };
}

export function createDb(seed = 2026, now = Date.now()): MockDb {
  const rng = new Rng(seed);
  const db = new MockDb(now);

  // ── Người dùng ──
  db.users = [
    ...DEMO_ACCOUNTS.map((a, i) => ({
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      orgUnitCode: a.orgUnitCode,
      status: 'ACTIVE' as const,
      roles: a.roles,
      lastLoginAt: iso(now - (i + 1) * 5 * HOUR),
    })),
    ...[
      ['Đặng Hữu Phước', 'phuoc.dh', 'NN', 'REPORT_VIEWER', 'NN'],
      ['Bùi Thị Lan', 'lan.bt', 'PDT', 'REPORT_VIEWER', null],
      ['Ngô Quốc Huy', 'huy.nq', 'TTDL', 'DATA_ENGINEER', null],
      ['Dương Mai Anh', 'anh.dm', 'TTDL', 'DATA_STEWARD', null],
      ['Huỳnh Gia Bảo', 'bao.hg', 'KHCN', 'BI_ANALYST', null],
      ['Phan Thanh Trúc', 'truc.pt', 'TCCB', 'REPORT_VIEWER', 'TCCB'],
      ['Vũ Đức Long', 'long.vd', 'CNTT', 'REPORT_VIEWER', 'CNTT'],
    ].map(([name, mail, unit, role, scope], i) => ({
      id: mockUuid(9, i + 1),
      email: `${mail}@uni.edu.vn`,
      fullName: name as string,
      orgUnitCode: unit as string,
      status: (i === 6 ? 'INACTIVE' : 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
      roles: [{ role: role as MUser['roles'][number]['role'], scopeOrgUnit: scope as string | null }],
      lastLoginAt: i === 3 ? null : iso(now - (i + 2) * DAY),
    })),
  ];

  // ── Người (hồ sơ 360°) ──
  db.persons = generatePeople(rng, now);

  // ── Dataset và cột ──
  let colId = 100;
  const c = (name: string, type: string, sens: Sensitivity, desc: string, required = false) => col(++colId, name, type, sens, desc, required);
  const studentCols = () => [
    c('student_id', 'varchar', 'INTERNAL', 'Mã sinh viên', true),
    c('full_name', 'varchar', 'INTERNAL', 'Họ tên', true),
    c('date_of_birth', 'date', 'RESTRICTED', 'Ngày sinh', true),
    c('email', 'varchar', 'INTERNAL', 'Email trường'),
    c('phone', 'varchar', 'CONFIDENTIAL', 'Số điện thoại'),
    c('faculty_code', 'varchar', 'PUBLIC', 'Mã khoa', true),
    c('program_code', 'varchar', 'PUBLIC', 'Mã ngành', true),
    c('cohort', 'varchar', 'PUBLIC', 'Khóa', true),
    c('status', 'varchar', 'INTERNAL', 'Trạng thái học tập', true),
  ];
  const specs: Omit<MDataset, 'id'>[] = [
    { layer: 'BRONZE', schemaName: 'bronze', tableName: 'sis_students', displayName: 'Sinh viên (SIS, thô)', description: 'Bản ghi sinh viên nguyên trạng từ SIS, append-only.', sourceCode: 'SRC-SIS', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 4 * HOUR, rowCount: 18420, dqScore: null, tags: ['sinh-vien', 'sis'], columns: [...studentCols(), c('national_id', 'varchar', 'RESTRICTED', 'Số CCCD gốc'), c('updated_at', 'varchar', 'INTERNAL', 'Thời điểm cập nhật ở nguồn'), c('_batch_id', 'varchar', 'INTERNAL', 'Lô ingest'), c('_ingested_at', 'timestamp', 'INTERNAL', 'Thời điểm nạp')] },
    { layer: 'BRONZE', schemaName: 'bronze', tableName: 'sis_enrollments', displayName: 'Đăng ký học phần (SIS, thô)', description: 'Đăng ký học phần và điểm thô.', sourceCode: 'SRC-SIS', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 4 * HOUR, rowCount: 96210, dqScore: null, tags: ['hoc-tap', 'sis'], columns: [c('enrollment_id', 'integer', 'INTERNAL', 'Mã đăng ký'), c('student_id', 'varchar', 'INTERNAL', 'Mã sinh viên'), c('term_code', 'varchar', 'PUBLIC', 'Học kỳ'), c('course_code', 'varchar', 'PUBLIC', 'Học phần'), c('score_10', 'decimal', 'CONFIDENTIAL', 'Điểm hệ 10')] },
    { layer: 'BRONZE', schemaName: 'bronze', tableName: 'hrm_staff', displayName: 'Cán bộ, giảng viên (HRM, thô)', description: 'Hồ sơ nhân sự thô từ HRM.', sourceCode: 'SRC-HRM', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 10080, lastUpdatedAt: now - 2 * DAY, rowCount: 1260, dqScore: null, tags: ['nhan-su', 'hrm'], columns: [c('staff_id', 'varchar', 'INTERNAL', 'Mã cán bộ'), c('full_name', 'varchar', 'INTERNAL', 'Họ tên'), c('national_id', 'varchar', 'RESTRICTED', 'Số CCCD gốc'), c('org_unit_code', 'varchar', 'PUBLIC', 'Đơn vị'), c('grade', 'varchar', 'CONFIDENTIAL', 'Ngạch bậc'), c('salary', 'decimal', 'RESTRICTED', 'Lương')] },
    { layer: 'BRONZE', schemaName: 'bronze', tableName: 'fin_tuition', displayName: 'Học phí (FIN, thô)', description: 'File học phí hằng tuần từ Phòng Kế hoạch – Tài chính.', sourceCode: 'SRC-FIN', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 10080, lastUpdatedAt: now - 3 * DAY, rowCount: 7480, dqScore: null, tags: ['tai-chinh'], columns: [c('ma_sv', 'varchar', 'INTERNAL', 'Mã sinh viên'), c('hoc_ky', 'varchar', 'PUBLIC', 'Học kỳ'), c('so_tien_phai_nop', 'decimal', 'CONFIDENTIAL', 'Số phải nộp'), c('so_tien_da_nop', 'decimal', 'CONFIDENTIAL', 'Số đã nộp'), c('hoc_bong', 'decimal', 'CONFIDENTIAL', 'Học bổng')] },
    { layer: 'BRONZE', schemaName: 'bronze', tableName: 'lms_activity', displayName: 'Hoạt động LMS (thô)', description: 'Hoạt động học tập trực tuyến hằng ngày.', sourceCode: 'SRC-LMS', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 30 * HOUR, rowCount: 412300, dqScore: null, tags: ['hoat-dong', 'lms'], columns: [c('activity_id', 'integer', 'INTERNAL', 'Mã'), c('student_id', 'varchar', 'INTERNAL', 'Mã sinh viên'), c('activity_date', 'date', 'INTERNAL', 'Ngày'), c('logins', 'integer', 'INTERNAL', 'Số lần đăng nhập'), c('active_minutes', 'integer', 'INTERNAL', 'Số phút hoạt động')] },
    { layer: 'SILVER', schemaName: 'silver', tableName: 'silver_sis_students', displayName: 'Sinh viên (chuẩn hóa)', description: 'Một dòng mới nhất cho mỗi sinh viên; CCCD chỉ còn dạng băm.', sourceCode: 'SRC-SIS', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 4 * HOUR, rowCount: 6120, dqScore: null, tags: ['sinh-vien'], columns: [...studentCols(), c('national_id_hash', 'varchar', 'RESTRICTED', 'Băm CCCD có salt', true), c('updated_at', 'timestamp', 'INTERNAL', 'Thời điểm cập nhật', true)] },
    { layer: 'SILVER', schemaName: 'silver', tableName: 'silver_fin_tuition', displayName: 'Học phí (chuẩn hóa)', description: 'Học phí theo sinh viên, học kỳ.', sourceCode: 'SRC-FIN', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 10080, lastUpdatedAt: now - 3 * DAY, rowCount: 7475, dqScore: null, tags: ['tai-chinh'], columns: [c('student_id', 'varchar', 'INTERNAL', 'Mã sinh viên', true), c('term_code', 'varchar', 'PUBLIC', 'Học kỳ', true), c('amount_due', 'decimal', 'CONFIDENTIAL', 'Số phải nộp', true), c('amount_paid', 'decimal', 'CONFIDENTIAL', 'Số đã nộp', true), c('scholarship_amount', 'decimal', 'CONFIDENTIAL', 'Học bổng')] },
    { layer: 'SILVER', schemaName: 'silver', tableName: 'silver_hrm_staff', displayName: 'Cán bộ (chuẩn hóa)', description: 'Hồ sơ nhân sự chuẩn hóa.', sourceCode: 'SRC-HRM', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 10080, lastUpdatedAt: now - 2 * DAY, rowCount: 1258, dqScore: null, tags: ['nhan-su'], columns: [c('staff_id', 'varchar', 'INTERNAL', 'Mã cán bộ', true), c('full_name', 'varchar', 'INTERNAL', 'Họ tên', true), c('national_id_hash', 'varchar', 'RESTRICTED', 'Băm CCCD', true), c('org_unit_code', 'varchar', 'PUBLIC', 'Đơn vị', true)] },
    { layer: 'SILVER', schemaName: 'silver', tableName: 'silver_lms_activity', displayName: 'Hoạt động LMS (chuẩn hóa)', description: 'Hoạt động theo ngày.', sourceCode: 'SRC-LMS', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 30 * HOUR, rowCount: 410900, dqScore: null, tags: ['hoat-dong'], columns: [c('student_id', 'varchar', 'INTERNAL', 'Mã sinh viên', true), c('activity_date', 'date', 'INTERNAL', 'Ngày', true), c('logins', 'integer', 'INTERNAL', 'Đăng nhập')] },
    { layer: 'GOLD', schemaName: 'gold', tableName: 'dim_person', displayName: 'Người (golden record)', description: 'Một dòng cho mỗi người thật; nguồn gốc từng thuộc tính ở person_attribute_provenance.', sourceCode: null, ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 3 * HOUR, rowCount: 7380, dqScore: null, tags: ['ho-so-360'], columns: [c('person_id', 'uuid', 'INTERNAL', 'Mã người'), c('full_name', 'varchar', 'INTERNAL', 'Họ tên'), c('date_of_birth', 'date', 'RESTRICTED', 'Ngày sinh'), c('gender', 'varchar', 'CONFIDENTIAL', 'Giới tính'), c('email', 'varchar', 'INTERNAL', 'Email'), c('phone', 'varchar', 'CONFIDENTIAL', 'Điện thoại'), c('national_id_hash', 'varchar', 'RESTRICTED', 'Băm CCCD'), c('primary_org_unit_code', 'varchar', 'PUBLIC', 'Đơn vị chính')] },
    { layer: 'GOLD', schemaName: 'gold', tableName: 'dim_student', displayName: 'Chiều sinh viên', description: 'Hồ sơ vai trò sinh viên.', sourceCode: null, ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 3 * HOUR, rowCount: 6120, dqScore: null, tags: ['ho-so-360', 'sinh-vien'], columns: [c('student_id', 'varchar', 'INTERNAL', 'Mã sinh viên'), c('person_id', 'uuid', 'INTERNAL', 'Mã người'), c('faculty_code', 'varchar', 'PUBLIC', 'Khoa'), c('program_code', 'varchar', 'PUBLIC', 'Ngành'), c('cohort', 'varchar', 'PUBLIC', 'Khóa'), c('status', 'varchar', 'INTERNAL', 'Trạng thái')] },
    { layer: 'GOLD', schemaName: 'gold', tableName: 'fact_term_result', displayName: 'Kết quả học kỳ', description: 'GPA, tín chỉ, cảnh báo học vụ, điểm rèn luyện theo học kỳ.', sourceCode: null, ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 3 * HOUR, rowCount: 21800, dqScore: null, tags: ['hoc-tap'], columns: [c('student_id', 'varchar', 'INTERNAL', 'Mã sinh viên'), c('term_code', 'varchar', 'PUBLIC', 'Học kỳ'), c('gpa_term', 'decimal', 'CONFIDENTIAL', 'GPA học kỳ'), c('gpa_cumulative', 'decimal', 'CONFIDENTIAL', 'GPA tích lũy'), c('academic_warning_level', 'smallint', 'CONFIDENTIAL', 'Mức cảnh báo học vụ'), c('conduct_score', 'smallint', 'CONFIDENTIAL', 'Điểm rèn luyện')] },
    { layer: 'GOLD', schemaName: 'gold', tableName: 'fact_tuition', displayName: 'Học phí theo học kỳ', description: 'Phải nộp, đã nộp, học bổng, trạng thái.', sourceCode: null, ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 10080, lastUpdatedAt: now - 3 * DAY, rowCount: 21700, dqScore: null, tags: ['tai-chinh'], columns: [c('student_id', 'varchar', 'INTERNAL', 'Mã sinh viên'), c('term_code', 'varchar', 'PUBLIC', 'Học kỳ'), c('amount_due', 'decimal', 'CONFIDENTIAL', 'Phải nộp'), c('amount_paid', 'decimal', 'CONFIDENTIAL', 'Đã nộp'), c('payment_status', 'varchar', 'CONFIDENTIAL', 'Trạng thái')] },
    { layer: 'GOLD', schemaName: 'gold', tableName: 'mart_student_term_kpi', displayName: 'KPI sinh viên theo học kỳ', description: 'Mart tổng hợp cho dashboard Đào tạo và semantic model.', sourceCode: null, ownerId: ID.analyst, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 2 * HOUR, rowCount: 640, dqScore: null, tags: ['dao-tao', 'mart'], columns: [c('term_code', 'varchar', 'PUBLIC', 'Học kỳ'), c('faculty_code', 'varchar', 'PUBLIC', 'Khoa'), c('program_code', 'varchar', 'PUBLIC', 'Ngành'), c('cohort', 'varchar', 'PUBLIC', 'Khóa'), c('n_students', 'integer', 'INTERNAL', 'Số sinh viên'), c('n_academic_warning', 'integer', 'INTERNAL', 'Số bị cảnh báo'), c('avg_gpa_term', 'decimal', 'INTERNAL', 'GPA trung bình')] },
    { layer: 'GOLD', schemaName: 'gold', tableName: 'dim_lecturer', displayName: 'Chiều giảng viên', description: 'Học hàm, học vị, đơn vị.', sourceCode: null, ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 10080, lastUpdatedAt: now - 2 * DAY, rowCount: 640, dqScore: null, tags: ['giang-vien'], columns: [c('lecturer_id', 'varchar', 'INTERNAL', 'Mã giảng viên'), c('person_id', 'uuid', 'INTERNAL', 'Mã người'), c('faculty_code', 'varchar', 'PUBLIC', 'Khoa'), c('academic_title', 'varchar', 'PUBLIC', 'Học hàm'), c('degree', 'varchar', 'PUBLIC', 'Học vị')] },
    { layer: 'GOLD', schemaName: 'gold', tableName: 'fact_teaching_load', displayName: 'Khối lượng giảng dạy', description: 'Số lớp, giờ giảng theo học kỳ.', sourceCode: null, ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 10080, lastUpdatedAt: now - 2 * DAY, rowCount: 5100, dqScore: null, tags: ['giang-vien'], columns: [c('lecturer_id', 'varchar', 'INTERNAL', 'Mã giảng viên'), c('term_code', 'varchar', 'PUBLIC', 'Học kỳ'), c('teaching_hours', 'decimal', 'INTERNAL', 'Giờ giảng'), c('avg_score', 'decimal', 'CONFIDENTIAL', 'Điểm đánh giá')] },
    { layer: 'GOLD', schemaName: 'gold', tableName: 'fact_research_output', displayName: 'Kết quả nghiên cứu', description: 'Công bố, đề tài, hướng dẫn.', sourceCode: 'SRC-RES', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 44640, lastUpdatedAt: now - 38 * DAY, rowCount: 2140, dqScore: null, tags: ['nghien-cuu'], columns: [c('person_id', 'uuid', 'INTERNAL', 'Mã người'), c('output_type', 'varchar', 'PUBLIC', 'Loại'), c('title', 'varchar', 'PUBLIC', 'Tên'), c('year', 'smallint', 'PUBLIC', 'Năm'), c('level', 'varchar', 'PUBLIC', 'Cấp')] },
    { layer: 'GOLD', schemaName: 'gold', tableName: 'mart_dq_daily', displayName: 'Điểm chất lượng theo ngày', description: 'Điểm DQ theo dataset × chiều × ngày.', sourceCode: null, ownerId: ID.steward, stewardId: ID.steward, freshnessSlaMinutes: 1560, lastUpdatedAt: now - 5 * HOUR, rowCount: 1800, dqScore: null, tags: ['chat-luong'], columns: [c('dataset', 'varchar', 'PUBLIC', 'Dataset'), c('dq_dimension', 'varchar', 'PUBLIC', 'Chiều'), c('date', 'date', 'PUBLIC', 'Ngày'), c('score', 'decimal', 'PUBLIC', 'Điểm')] },
    { layer: 'QUARANTINE', schemaName: 'quarantine', tableName: 'fin_tuition', displayName: 'Học phí bị cách ly', description: 'Bản ghi vi phạm quy tắc BLOCKING, chờ sửa và xử lý lại.', sourceCode: 'SRC-FIN', ownerId: ID.engineer, stewardId: ID.steward, freshnessSlaMinutes: 10080, lastUpdatedAt: now - 3 * DAY, rowCount: 5, dqScore: null, tags: ['tai-chinh', 'quarantine'], columns: [c('ma_sv', 'varchar', 'INTERNAL', 'Mã sinh viên'), c('so_tien_da_nop', 'decimal', 'CONFIDENTIAL', 'Số đã nộp'), c('_rule_id', 'integer', 'INTERNAL', 'Quy tắc vi phạm')] },
  ];
  db.datasets = specs.map((s, i) => ({ ...s, id: i + 1 }));
  const dsId = (fq: string) => db.datasetByName(fq)?.id ?? 0;

  // ── Glossary ──
  db.glossary = [
    ['Cảnh báo học vụ', 'Sinh viên có GPA học kỳ dưới 2,0 (mức 1) hoặc dưới 1,0 (mức 2) theo quy chế đào tạo.'],
    ['GPA tích lũy', 'Điểm trung bình chung tích lũy hệ 4 tính trên các học phần đã học.'],
    ['Sinh viên đang học', 'Sinh viên có trạng thái STUDYING tại thời điểm thống kê; không gồm bảo lưu, thôi học, đã tốt nghiệp.'],
    ['Tỉ lệ nợ học phí', 'Tỉ lệ lượt sinh viên – học kỳ chưa nộp đủ học phí sau khi trừ học bổng.'],
    ['Giờ giảng quy đổi', 'Số tiết giảng dạy quy đổi theo quy định của trường (45 tiết/lớp/học phần 3 tín chỉ).'],
    ['Công bố ISI/Scopus', 'Bài báo đăng trên tạp chí thuộc danh mục Web of Science hoặc Scopus.'],
  ].map(([name, definition], i) => ({ id: i + 1, name, definition, ownerId: ID.steward }));
  const setTerm = (fq: string, column: string, termId: number) => {
    const column_ = db.datasetByName(fq)?.columns.find((x) => x.name === column);
    if (column_) column_.glossaryTermId = termId;
  };
  setTerm('gold.fact_term_result', 'academic_warning_level', 1);
  setTerm('gold.fact_term_result', 'gpa_cumulative', 2);
  setTerm('gold.fact_teaching_load', 'teaching_hours', 5);

  // ── Nguồn dữ liệu ──
  const silverStudents = dsId('silver.silver_sis_students');
  db.sources = [
    { id: 1, code: 'SRC-SIS', name: 'Quản lý đào tạo (SIS)', type: 'JDBC', status: 'ACTIVE', ownerId: ID.engineer, businessOwner: 'Phòng Đào tạo', purpose: 'Hợp nhất hồ sơ học tập phục vụ cảnh báo học vụ và báo cáo đào tạo', legalBasisRef: 'QĐ 1021/QĐ-ĐH ngày 15/08/2026', sensitivity: 'RESTRICTED', subjectTypes: ['STUDENT', 'LECTURER'], connectionConfig: { host: 'sis-db.uni.local', port: 5432, database: 'sis' }, hasSecret: true, connectionTested: true, schedule: { cron: '0 2 * * *', paused: false }, targetDatasetId: silverStudents },
    { id: 2, code: 'SRC-LMS', name: 'Học tập trực tuyến (LMS)', type: 'API', status: 'ACTIVE', ownerId: ID.engineer, businessOwner: 'Trung tâm Học liệu số', purpose: 'Theo dõi mức độ tham gia học tập trực tuyến', legalBasisRef: 'Thỏa thuận chia sẻ dữ liệu số 07/TT-HLS', sensitivity: 'INTERNAL', subjectTypes: ['STUDENT', 'LECTURER'], connectionConfig: { baseUrl: 'https://lms.uni.local/api', pageSize: 500 }, hasSecret: true, connectionTested: true, schedule: { cron: '30 2 * * *', paused: false }, targetDatasetId: dsId('silver.silver_lms_activity') },
    { id: 3, code: 'SRC-HRM', name: 'Quản lý nhân sự (HRM)', type: 'JDBC', status: 'ACTIVE', ownerId: ID.engineer, businessOwner: 'Phòng Tổ chức cán bộ', purpose: 'Hồ sơ cán bộ, giảng viên cho báo cáo nhân sự và giảng dạy', legalBasisRef: 'QĐ 1022/QĐ-ĐH ngày 15/08/2026', sensitivity: 'RESTRICTED', subjectTypes: ['LECTURER', 'STAFF'], connectionConfig: { host: 'hrm-db.uni.local', port: 1433, database: 'hrm' }, hasSecret: true, connectionTested: true, schedule: { cron: '0 3 * * 1', paused: false }, targetDatasetId: dsId('silver.silver_hrm_staff') },
    { id: 4, code: 'SRC-FIN', name: 'Tài chính – học phí', type: 'FILE', status: 'ACTIVE', ownerId: ID.engineer, businessOwner: 'Phòng Kế hoạch – Tài chính', purpose: 'Theo dõi tình trạng học phí để hỗ trợ sinh viên khó khăn', legalBasisRef: 'QĐ 1234/QĐ-ĐH ngày 01/09/2026', sensitivity: 'CONFIDENTIAL', subjectTypes: ['STUDENT'], connectionConfig: {}, fileTemplate: { requiredColumns: ['ma_sv', 'hoc_ky', 'so_tien_phai_nop', 'so_tien_da_nop', 'hoc_bong'] }, hasSecret: false, connectionTested: true, schedule: null, targetDatasetId: dsId('silver.silver_fin_tuition') },
    { id: 5, code: 'SRC-LIB', name: 'Thư viện', type: 'FILE', status: 'PAUSED', ownerId: ID.engineer, businessOwner: 'Thư viện trường', purpose: 'Thống kê sử dụng tài nguyên học tập', legalBasisRef: 'Thỏa thuận chia sẻ dữ liệu số 09/TV', sensitivity: 'INTERNAL', subjectTypes: ['STUDENT', 'LECTURER', 'STAFF'], connectionConfig: {}, fileTemplate: { requiredColumns: ['ma_ban_doc', 'ngay_muon', 'loai_tai_lieu'] }, hasSecret: false, connectionTested: true, schedule: null, targetDatasetId: silverStudents },
    { id: 6, code: 'SRC-RES', name: 'Quản lý khoa học công nghệ', type: 'FILE', status: 'ACTIVE', ownerId: ID.engineer, businessOwner: 'Phòng Khoa học công nghệ', purpose: 'Thống kê công bố và đề tài', legalBasisRef: 'QĐ 1300/QĐ-ĐH ngày 10/09/2026', sensitivity: 'INTERNAL', subjectTypes: ['LECTURER', 'STAFF'], connectionConfig: {}, fileTemplate: { requiredColumns: ['ma_can_bo', 'loai', 'ten', 'nam', 'cap'] }, hasSecret: false, connectionTested: true, schedule: null, targetDatasetId: dsId('gold.fact_research_output') },
    { id: 7, code: 'SRC-STA', name: 'Công tác sinh viên', type: 'FILE', status: 'ACTIVE', ownerId: ID.engineer, businessOwner: 'Phòng Công tác sinh viên', purpose: 'Điểm rèn luyện, khen thưởng, ký túc xá', legalBasisRef: 'QĐ 1301/QĐ-ĐH ngày 10/09/2026', sensitivity: 'CONFIDENTIAL', subjectTypes: ['STUDENT'], connectionConfig: {}, fileTemplate: { requiredColumns: ['ma_sv', 'hoc_ky', 'diem_ren_luyen'] }, hasSecret: false, connectionTested: true, schedule: null, targetDatasetId: silverStudents },
    { id: 8, code: 'SRC-SUR', name: 'Khảo sát', type: 'FILE', status: 'DRAFT', ownerId: ID.engineer, businessOwner: 'Phòng Đảm bảo chất lượng', purpose: 'Đánh giá giảng dạy và khảo sát việc làm sau tốt nghiệp', legalBasisRef: 'Đang chờ văn bản', sensitivity: 'CONFIDENTIAL', subjectTypes: ['STUDENT', 'LECTURER'], connectionConfig: {}, fileTemplate: { requiredColumns: ['ma_hoc_phan', 'hoc_ky', 'diem'] }, hasSecret: false, connectionTested: false, schedule: null, targetDatasetId: dsId('gold.fact_teaching_load') },
  ];

  // ── Lần chạy pipeline (lịch sử 7 ngày) ──
  let runSeq = 0;
  const addRun = (sourceId: number, daysAgo: number, outcome: MRun['outcome'], trigger: MRun['trigger'] = 'SCHEDULE', extra: Partial<MRun> = {}) => {
    const read = rng.int(1200, 6000);
    const quarantined = outcome === 'PARTIAL' ? rng.int(2, 6) : 0;
    db.runs.push({
      id: mockUuid(3, ++runSeq),
      sourceId,
      trigger,
      queuedAt: now - daysAgo * DAY - rng.int(0, 3) * HOUR,
      durationMs: rng.int(40, 180) * 1000,
      outcome,
      rowsRead: read,
      rowsWritten: outcome === 'FAILED' ? 0 : read - quarantined,
      rowsQuarantined: quarantined,
      errorMessage: outcome === 'FAILED' ? 'Hết thời gian chờ khi gọi API LMS (30 s) ở trang 14' : null,
      parentRunId: null,
      uploadId: null,
      ...extra,
    });
  };
  for (let d = 7; d >= 1; d--) {
    addRun(1, d, 'SUCCEEDED');
    addRun(2, d, d === 1 ? 'FAILED' : 'SUCCEEDED');
  }
  addRun(3, 6, 'SUCCEEDED');
  addRun(4, 10, 'SUCCEEDED', 'MANUAL');
  addRun(4, 3, 'PARTIAL', 'MANUAL');
  addRun(6, 38, 'SUCCEEDED', 'MANUAL');
  addRun(7, 12, 'PARTIAL', 'MANUAL');
  const finPartialRun = db.runs.find((r) => r.sourceId === 4 && r.outcome === 'PARTIAL') as MRun;
  const lmsFailedRun = db.runs.find((r) => r.sourceId === 2 && r.outcome === 'FAILED') as MRun;

  // ── Mapping ──
  db.mappings = [
    { id: 1, sourceId: 1, targetDatasetId: silverStudents, version: 3, active: true, createdById: ID.engineer, createdAt: iso(now - 20 * DAY), rules: ['student_id', 'full_name', 'date_of_birth', 'email', 'phone', 'faculty_code', 'program_code', 'cohort', 'status'].map((n): MMapping['rules'][number] => ({ sourceColumn: n, targetColumn: n, transform: null })).concat([{ sourceColumn: 'national_id', targetColumn: 'national_id_hash', transform: "to_hex(sha256(to_utf8(concat(:salt, national_id))))" }, { sourceColumn: 'updated_at', targetColumn: 'updated_at', transform: 'from_iso8601_timestamp(updated_at)' }]) },
    { id: 2, sourceId: 4, targetDatasetId: dsId('silver.silver_fin_tuition'), version: 1, active: true, createdById: ID.engineer, createdAt: iso(now - 15 * DAY), rules: [{ sourceColumn: 'ma_sv', targetColumn: 'student_id', transform: null }, { sourceColumn: 'hoc_ky', targetColumn: 'term_code', transform: null }, { sourceColumn: 'so_tien_phai_nop', targetColumn: 'amount_due', transform: 'cast(so_tien_phai_nop as decimal(14,0))' }, { sourceColumn: 'so_tien_da_nop', targetColumn: 'amount_paid', transform: 'cast(so_tien_da_nop as decimal(14,0))' }, { sourceColumn: 'hoc_bong', targetColumn: 'scholarship_amount', transform: null }] },
  ];

  // ── Quy tắc DQ và issue ──
  const colIdOf = (fq: string, name: string) => db.datasetByName(fq)?.columns.find((x) => x.name === name)?.id ?? null;
  const rule = (id: number, fq: string, column: string | null, ruleType: MRule['ruleType'], dimension: MRule['dimension'], severity: MRule['severity'], params: Record<string, unknown>, description: string, passRate: number | null, status: MRule['status'] = 'ACTIVE'): MRule => ({
    id, datasetId: dsId(fq), columnId: column ? colIdOf(fq, column) : null, ruleType, dimension, severity, params, description, status, version: 1, lastPassRate: passRate, lastDryRunVersion: status === 'DRAFT' ? null : 1,
  });
  db.rules = [
    rule(1, 'bronze.sis_students', 'student_id', 'NOT_NULL', 'COMPLETENESS', 'BLOCKING', {}, 'Mã sinh viên không được rỗng', 100),
    rule(2, 'bronze.sis_students', 'student_id', 'UNIQUE', 'UNIQUENESS', 'BLOCKING', {}, 'Mã sinh viên là duy nhất trong mỗi lô', 100),
    rule(3, 'bronze.sis_students', 'email', 'REGEX', 'VALIDITY', 'WARNING', { pattern: '^[a-z0-9._-]+@(st\\.)?uni\\.edu\\.vn$' }, 'Email đúng định dạng email trường', 99.2),
    rule(4, 'gold.fact_term_result', 'gpa_term', 'RANGE', 'VALIDITY', 'BLOCKING', { min: 0, max: 4 }, 'GPA học kỳ nằm trong [0, 4]', 100),
    rule(5, 'bronze.fin_tuition', 'so_tien_da_nop', 'RANGE', 'VALIDITY', 'BLOCKING', { min: 0 }, 'Số tiền đã nộp không âm', 99.9),
    rule(6, 'bronze.fin_tuition', 'ma_sv', 'REFERENCE', 'CONSISTENCY', 'BLOCKING', { ref_dataset: 'silver.silver_sis_students', ref_column: 'student_id' }, 'Mã sinh viên trong file học phí phải tồn tại ở SIS', 99.96),
    rule(7, 'bronze.lms_activity', null, 'FRESHNESS', 'TIMELINESS', 'WARNING', { maxAgeHours: 26 }, 'Dữ liệu LMS cập nhật trong 26 giờ', 0),
    rule(8, 'gold.fact_research_output', null, 'FRESHNESS', 'TIMELINESS', 'WARNING', { maxAgeHours: 744 }, 'Dữ liệu KHCN cập nhật trong 31 ngày', 0),
    rule(9, 'bronze.hrm_staff', 'national_id', 'NOT_NULL', 'COMPLETENESS', 'BLOCKING', {}, 'Cán bộ phải có số CCCD để đối soát danh tính', 99.8),
    rule(10, 'silver.silver_sis_students', null, 'CUSTOM_SQL', 'CONSISTENCY', 'WARNING', { sql: "select * from {table} where status = 'GRADUATED' and cohort = 'K68'" }, 'Khóa K68 chưa thể có sinh viên tốt nghiệp', null, 'DRAFT'),
  ];
  db.issues = [
    { id: 1, ruleId: 5, datasetId: dsId('bronze.fin_tuition'), affectedRows: 3, severity: 'BLOCKING', status: 'OPEN', assigneeId: null, lastRunId: finPartialRun.id, createdAt: iso(finPartialRun.queuedAt + 2 * 60_000), comments: [] },
    { id: 2, ruleId: 6, datasetId: dsId('bronze.fin_tuition'), affectedRows: 2, severity: 'BLOCKING', status: 'IN_PROGRESS', assigneeId: ID.steward, lastRunId: finPartialRun.id, createdAt: iso(finPartialRun.queuedAt + 2 * 60_000), comments: [{ id: 1, authorId: ID.steward, body: 'Hai mã SV không có ở SIS, đã gửi Phòng KH-TC xác minh.', createdAt: iso(now - 2 * DAY) }] },
    { id: 3, ruleId: 3, datasetId: dsId('bronze.sis_students'), affectedRows: 14, severity: 'WARNING', status: 'OPEN', assigneeId: null, lastRunId: db.runs[db.runs.length - 1].id, createdAt: iso(now - 5 * DAY), comments: [] },
    { id: 4, ruleId: 7, datasetId: dsId('bronze.lms_activity'), affectedRows: 1, severity: 'WARNING', status: 'OPEN', assigneeId: ID.engineer, lastRunId: lmsFailedRun.id, createdAt: iso(lmsFailedRun.queuedAt + 60_000), comments: [] },
    { id: 5, ruleId: 8, datasetId: dsId('gold.fact_research_output'), affectedRows: 1, severity: 'WARNING', status: 'OPEN', assigneeId: null, lastRunId: db.runs[db.runs.length - 2].id, createdAt: iso(now - 7 * DAY), comments: [] },
  ];

  // ── Đối soát danh tính ──
  const record = (sourceCode: string, sourceKey: string, personId: string, f: Record<string, [unknown, Sensitivity, boolean?]>): MatchRecord => ({
    sourceCode,
    sourceKey,
    personId,
    fields: Object.fromEntries(Object.entries(f).map(([k, [value, sensitivity, masked]]) => [k, { value, sensitivity, masked: !!masked, source: sourceCode }])),
  });
  let candSeq = 0;
  const students = db.persons.filter((p) => p.roles.includes('STUDENT') && p.student && !p.staff);
  const graduateStaff = db.persons.filter((p) => p.staff && p.student);
  for (const p of graduateStaff) {
    db.candidates.push({
      id: ++candSeq, score: 0.97, status: 'AUTO_MERGED', createdAt: iso(now - 9 * DAY),
      left: record('HRM', p.staff!.code, p.id, { fullName: [p.sourceNames['HRM'], 'INTERNAL'], dateOfBirth: ['••••', 'RESTRICTED', true], nationalId: ['••••', 'RESTRICTED', true], email: [p.email, 'INTERNAL'], orgUnit: [p.staff!.unit, 'PUBLIC'] }),
      right: record('SIS', p.student!.code, mockUuid(7, candSeq), { fullName: [p.sourceNames['SIS'], 'INTERNAL'], dateOfBirth: ['••••', 'RESTRICTED', true], nationalId: ['••••', 'RESTRICTED', true], email: [p.email.replace('@uni', '@st.uni'), 'INTERNAL'], orgUnit: ['KT', 'PUBLIC'] }),
      comparison: { fullName: 'PARTIAL', dateOfBirth: 'MATCH', nationalId: 'MATCH', email: 'PARTIAL', orgUnit: 'DIFFERENT' },
    });
  }
  for (const [i, p] of rng.sample(students, 11).entries()) {
    const differentPerson = i % 4 === 3;
    const score = differentPerson ? rng.float(0.75, 0.82) : rng.float(0.8, 0.94);
    db.candidates.push({
      id: ++candSeq,
      score,
      status: i === 9 ? 'MERGED' : i === 10 ? 'REJECTED' : 'PENDING',
      createdAt: iso(now - rng.int(1, 6) * DAY),
      left: record('SIS', p.student!.code, p.id, { fullName: [p.fullName, 'INTERNAL'], dateOfBirth: ['••••', 'RESTRICTED', true], nationalId: ['••••', 'RESTRICTED', true], email: [p.email, 'INTERNAL'], orgUnit: [p.student!.faculty, 'PUBLIC'] }),
      right: record(i % 2 ? 'LIB' : 'LMS', `${i % 2 ? 'BD' : 'U'}${rng.int(10000, 99999)}`, mockUuid(7, 100 + candSeq), { fullName: [p.sourceNames['LMS'] ?? p.fullName, 'INTERNAL'], dateOfBirth: ['••••', 'RESTRICTED', true], nationalId: [null, 'RESTRICTED'], email: [differentPerson ? p.email.replace(/\d+@/, `${rng.int(1, 9)}@`) : p.email.toUpperCase(), 'INTERNAL'], orgUnit: [p.student!.faculty, 'PUBLIC'] }),
      comparison: { fullName: 'PARTIAL', dateOfBirth: differentPerson ? 'DIFFERENT' : 'MATCH', nationalId: 'MISSING', email: differentPerson ? 'DIFFERENT' : 'MATCH', orgUnit: 'MATCH' },
    });
  }
  db.merges = db.candidates
    .filter((c) => c.status === 'AUTO_MERGED' || c.status === 'MERGED')
    .map((c, i) => ({ id: i + 1, action: 'MERGE' as const, survivorPersonId: c.left.personId as string, mergedPersonId: c.right.personId as string, actorId: c.status === 'MERGED' ? ID.steward : null, createdAt: c.createdAt, candidateId: c.id }));

  // ── Quyền truy cập ──
  db.requests = [
    { id: 1, requesterId: ID.analyst, resourceType: 'PROFILE_FACET', resourceId: 'FINANCE', resourceName: 'Tab Tài chính – hồ sơ sinh viên', accessLevel: 'READ', purpose: 'Phân tích tỉ lệ nợ học phí theo khoa để đề xuất chính sách hỗ trợ', scope: {}, requestedDays: 90, status: 'APPROVED', reviewerId: ID.steward, reviewNote: 'Đồng ý, thời hạn 60 ngày', createdAt: iso(now - 32 * DAY), decidedAt: iso(now - 31 * DAY), expiresAt: iso(now + 29 * DAY) },
    { id: 2, requesterId: ID.deanKt, resourceType: 'PROFILE_FACET', resourceId: 'FINANCE', resourceName: 'Tab Tài chính – hồ sơ sinh viên', accessLevel: 'READ', purpose: 'Rà soát sinh viên khoa Kinh tế nợ học phí để tư vấn hỗ trợ tài chính', scope: { orgUnitCodes: ['KT'] }, requestedDays: 90, status: 'PENDING', reviewerId: null, reviewNote: null, createdAt: iso(now - 6 * HOUR), decidedAt: null, expiresAt: null },
    { id: 3, requesterId: ID.dean, resourceType: 'DATASET', resourceId: String(dsId('gold.fact_tuition')), resourceName: 'gold.fact_tuition', accessLevel: 'EXPORT', purpose: 'Xuất danh sách để gửi phụ huynh', scope: {}, requestedDays: 180, status: 'REJECTED', reviewerId: ID.steward, reviewNote: 'Mục đích không phù hợp: không cấp quyền xuất dữ liệu tài chính cá nhân ra ngoài hệ thống.', createdAt: iso(now - 20 * DAY), decidedAt: iso(now - 19 * DAY), expiresAt: null },
  ];
  db.grants = [
    { id: 1, userId: ID.analyst, resourceType: 'PROFILE_FACET', resourceId: 'FINANCE', resourceName: 'Tab Tài chính – hồ sơ sinh viên', accessLevel: 'READ', validFrom: iso(now - 31 * DAY), validTo: iso(now + 29 * DAY), revokedAt: null, grantedById: ID.steward, requestId: 1 },
    { id: 2, userId: ID.analyst, resourceType: 'DATASET', resourceId: String(dsId('gold.fact_tuition')), resourceName: 'gold.fact_tuition', accessLevel: 'READ', validFrom: iso(now - 31 * DAY), validTo: iso(now + 29 * DAY), revokedAt: null, grantedById: ID.steward, requestId: null },
    { id: 3, userId: ID.dean, resourceType: 'DATASET', resourceId: String(dsId('gold.mart_student_term_kpi')), resourceName: 'gold.mart_student_term_kpi', accessLevel: 'READ', validFrom: iso(now - 60 * DAY), validTo: iso(now + 120 * DAY), revokedAt: null, grantedById: ID.steward, requestId: null },
  ];

  // ── Metric (semantic model) ──
  const mart = dsId('gold.mart_student_term_kpi');
  const teaching = dsId('gold.fact_teaching_load');
  const research = dsId('gold.fact_research_output');
  const dqMart = dsId('gold.mart_dq_daily');
  const studentDims = ['academic_year', 'term', 'faculty', 'program', 'cohort', 'status'];
  const lecturerDims = ['academic_year', 'term', 'faculty'];
  const researchDims = ['year', 'faculty', 'level'];
  const dqDims = ['dataset', 'dq_dimension', 'date'];
  const metric = (id: number, code: string, name: string, definition: string, expression: string, base: number, dims: string[], unit: string, status: MMetric['status'] = 'CERTIFIED', glossaryTermId: number | null = null): MMetric => ({
    id, code, name, definition, expression, baseDatasetId: base, allowedDimensions: dims, unit, ownerId: ID.analyst, glossaryTermId, status, version: 1,
    certifiedById: status === 'CERTIFIED' ? ID.steward : null, certifiedAt: status === 'CERTIFIED' ? iso(now - 40 * DAY) : null,
    versions: [{ version: 1, expression, changedById: ID.analyst, changedAt: iso(now - 45 * DAY) }],
  });
  db.metrics = [
    metric(1, 'student_count', 'Số sinh viên', 'Số sinh viên khác nhau có kết quả học kỳ trong phạm vi lọc.', 'count_distinct(person_id)', mart, studentDims, 'SV', 'CERTIFIED', 3),
    metric(2, 'academic_warning_rate', 'Tỉ lệ cảnh báo học vụ', 'Tỉ lệ lượt sinh viên – học kỳ bị cảnh báo học vụ (mức 1 hoặc 2).', 'rate(warning)', mart, studentDims, '%', 'CERTIFIED', 1),
    metric(3, 'avg_gpa', 'GPA trung bình', 'GPA học kỳ trung bình hệ 4.', 'avg(gpa)', mart, studentDims, '', 'CERTIFIED', 2),
    metric(4, 'dropout_rate', 'Tỉ lệ thôi học', 'Tỉ lệ sinh viên thôi học trên tổng sinh viên trong kỳ.', 'rate(dropped)', mart, studentDims, '%'),
    metric(5, 'tuition_unpaid_rate', 'Tỉ lệ nợ học phí', 'Tỉ lệ lượt sinh viên – học kỳ chưa nộp đủ học phí.', 'rate(unpaid)', mart, studentDims, '%', 'CERTIFIED', 4),
    metric(6, 'avg_conduct', 'Điểm rèn luyện trung bình', 'Điểm rèn luyện trung bình theo học kỳ.', 'avg(conduct)', mart, studentDims, 'điểm'),
    metric(7, 'avg_credits', 'Tín chỉ trung bình mỗi kỳ', 'Số tín chỉ đăng ký trung bình mỗi học kỳ.', 'avg(credits)', mart, studentDims, 'TC', 'DRAFT'),
    metric(8, 'lecturer_count', 'Số giảng viên', 'Số giảng viên có giảng dạy trong kỳ.', 'count_distinct(person_id)', teaching, lecturerDims, 'GV'),
    metric(9, 'teaching_hours', 'Giờ giảng', 'Tổng giờ giảng quy đổi.', 'sum(hours)', teaching, lecturerDims, 'giờ', 'CERTIFIED', 5),
    metric(10, 'avg_teaching_score', 'Điểm đánh giá giảng dạy', 'Điểm khảo sát đánh giá giảng dạy trung bình (thang 5).', 'avg(eval_score)', teaching, lecturerDims, '/5'),
    metric(11, 'publication_count', 'Số công bố', 'Số bài báo, công bố khoa học.', 'sum(publication)', research, researchDims, 'bài', 'CERTIFIED', 6),
    metric(12, 'research_project_count', 'Số đề tài', 'Số đề tài nghiên cứu các cấp.', 'sum(project)', research, researchDims, 'đề tài'),
    metric(13, 'dq_score', 'Điểm chất lượng dữ liệu', 'Tỉ lệ bản ghi đạt quy tắc chất lượng.', 'avg(score)', dqMart, dqDims, '%'),
  ];

  // ── Dashboard ──
  const w = (id: number, type: Widget['type'], title: string, metrics: string[], dimensions: string[], pos: [number, number, number, number], drillPath?: string[]): Widget => ({
    id, type, title, querySpec: { metrics, dimensions, ...(drillPath ? { drillPath } : {}) }, position: { x: pos[0], y: pos[1], w: pos[2], h: pos[3] },
  });
  db.dashboards = [
    { id: 1, title: 'Tổng quan đào tạo', description: 'Quy mô, kết quả học tập, cảnh báo học vụ và thôi học theo khoa, ngành, khóa.', topic: 'TRAINING', ownerId: ID.analyst, status: 'PUBLISHED', globalFilters: ['academic_year', 'faculty', 'cohort'], version: 4, publishedAt: iso(now - 40 * DAY), shares: [{ principalType: 'ROLE', principalId: 'REPORT_VIEWER' }, { principalType: 'ROLE', principalId: 'DATA_STEWARD' }],
      widgets: [w(11, 'KPI', 'Số sinh viên', ['student_count'], [], [0, 0, 3, 1]), w(12, 'KPI', 'Tỉ lệ cảnh báo học vụ', ['academic_warning_rate'], [], [3, 0, 3, 1]), w(13, 'KPI', 'GPA trung bình', ['avg_gpa'], [], [6, 0, 3, 1]), w(14, 'KPI', 'Tỉ lệ thôi học', ['dropout_rate'], [], [9, 0, 3, 1]), w(15, 'BAR', 'Cảnh báo học vụ theo khoa', ['academic_warning_rate'], ['faculty'], [0, 1, 6, 2], ['faculty', 'program', 'cohort']), w(16, 'LINE', 'GPA trung bình qua các học kỳ', ['avg_gpa'], ['term'], [6, 1, 6, 2]), w(17, 'TABLE', 'Chi tiết theo khoa, ngành, khóa', ['student_count', 'academic_warning_rate', 'avg_gpa'], ['faculty', 'program', 'cohort'], [0, 3, 12, 3])] },
    { id: 2, title: 'Giảng dạy và nhân sự', description: 'Số giảng viên, giờ giảng, điểm đánh giá giảng dạy.', topic: 'HR', ownerId: ID.analyst, status: 'PUBLISHED', globalFilters: ['academic_year', 'faculty'], version: 2, publishedAt: iso(now - 30 * DAY), shares: [{ principalType: 'ROLE', principalId: 'REPORT_VIEWER' }],
      widgets: [w(21, 'KPI', 'Số giảng viên', ['lecturer_count'], [], [0, 0, 4, 1]), w(22, 'KPI', 'Giờ giảng', ['teaching_hours'], [], [4, 0, 4, 1]), w(23, 'KPI', 'Điểm đánh giá giảng dạy', ['avg_teaching_score'], [], [8, 0, 4, 1]), w(24, 'BAR', 'Giờ giảng theo khoa', ['teaching_hours'], ['faculty'], [0, 1, 6, 2]), w(25, 'LINE', 'Điểm đánh giá qua các học kỳ', ['avg_teaching_score'], ['term'], [6, 1, 6, 2])] },
    { id: 3, title: 'Nghiên cứu khoa học', description: 'Công bố và đề tài theo khoa, năm, cấp.', topic: 'RESEARCH', ownerId: ID.analyst, status: 'PUBLISHED', globalFilters: ['faculty', 'year'], version: 1, publishedAt: iso(now - 25 * DAY), shares: [{ principalType: 'ROLE', principalId: 'REPORT_VIEWER' }],
      widgets: [w(31, 'KPI', 'Số công bố', ['publication_count'], [], [0, 0, 6, 1]), w(32, 'KPI', 'Số đề tài', ['research_project_count'], [], [6, 0, 6, 1]), w(33, 'BAR', 'Công bố theo khoa', ['publication_count'], ['faculty'], [0, 1, 6, 2]), w(34, 'LINE', 'Công bố theo năm', ['publication_count'], ['year'], [6, 1, 6, 2]), w(35, 'PIE', 'Công bố theo cấp', ['publication_count'], ['level'], [0, 3, 6, 2])] },
    { id: 4, title: 'Chất lượng dữ liệu', description: 'Điểm chất lượng theo dataset, chiều và thời gian.', topic: 'DATA_QUALITY', ownerId: ID.steward, status: 'PUBLISHED', globalFilters: ['dataset'], version: 1, publishedAt: iso(now - 20 * DAY), shares: [{ principalType: 'ROLE', principalId: 'DATA_STEWARD' }, { principalType: 'ROLE', principalId: 'DATA_ENGINEER' }, { principalType: 'ROLE', principalId: 'PLATFORM_ADMIN' }, { principalType: 'ROLE', principalId: 'BI_ANALYST' }],
      widgets: [w(41, 'KPI', 'Điểm DQ trung bình', ['dq_score'], [], [0, 0, 4, 1]), w(42, 'LINE', 'Điểm DQ 30 ngày', ['dq_score'], ['date'], [4, 0, 8, 2]), w(43, 'HEATMAP', 'Dataset × chiều chất lượng', ['dq_score'], ['dataset', 'dq_dimension'], [0, 2, 12, 3])] },
    { id: 5, title: 'Tài chính học phí', description: 'Tỉ lệ nợ học phí theo khoa, khóa (nháp).', topic: 'FINANCE', ownerId: ID.analyst, status: 'DRAFT', globalFilters: ['academic_year', 'faculty'], version: 1, publishedAt: null, shares: [],
      widgets: [w(51, 'KPI', 'Tỉ lệ nợ học phí', ['tuition_unpaid_rate'], [], [0, 0, 4, 1]), w(52, 'BAR', 'Nợ học phí theo khoa', ['tuition_unpaid_rate'], ['faculty'], [0, 1, 6, 2])] },
  ];
  db.favorites.add(`${ID.dean}:1`);
  db.favorites.add(`${ID.analyst}:1`);
  db.favorites.add(`${ID.steward}:4`);

  // ── Báo cáo tự động ──
  db.subscriptions = [
    { id: 1, ownerId: ID.dean, dashboardId: 1, cron: '0 7 * * MON', format: 'PDF', filters: [], includeAiSummary: true, recipientIds: [ID.dean], status: 'ACTIVE', nextRunAt: iso(now + 2 * DAY) },
    { id: 2, ownerId: ID.steward, dashboardId: 4, cron: '0 8 * * *', format: 'LINK', filters: [], includeAiSummary: false, recipientIds: [ID.steward, ID.engineer], status: 'PAUSED', nextRunAt: null },
  ];
  db.deliveries = [
    { id: 1, subscriptionId: 1, recipientId: ID.dean, status: 'SENT', aiSummary: 'Tỉ lệ cảnh báo học vụ khoa CNTT tăng ở khóa K66 trong năm học 2025–2026; GPA trung bình giảm nhẹ so với năm trước.', sentAt: iso(now - 5 * DAY) },
    { id: 2, subscriptionId: 1, recipientId: ID.dean, status: 'SENT', aiSummary: 'Quy mô sinh viên ổn định; tỉ lệ thôi học thấp hơn trung bình toàn trường.', sentAt: iso(now - 12 * DAY) },
    { id: 3, subscriptionId: 2, recipientId: ID.engineer, status: 'SENT', aiSummary: null, sentAt: iso(now - 9 * DAY) },
  ];

  // ── Cảnh báo bất thường ──
  const series = (base: number, spread: number, anomalyAt: number | null, anomalyValue: number) =>
    Array.from({ length: 14 }, (_, i) => {
      const value = i === anomalyAt ? anomalyValue : Number((base + rng.float(-spread, spread)).toFixed(2));
      return { at: iso(now - (13 - i) * DAY), value, low: Number((base - 2 * spread).toFixed(2)), high: Number((base + 2 * spread).toFixed(2)), anomalous: i === anomalyAt };
    });
  db.alerts = [
    { id: 1, kind: 'VOLUME', targetType: 'DATASET', targetId: String(dsId('bronze.lms_activity')), targetName: 'bronze.lms_activity', observedValue: 0, expectedLow: 5200, expectedHigh: 6800, severity: 'HIGH', status: 'OPEN', detectedAt: iso(lmsFailedRun.queuedAt + 5 * 60_000), acknowledgedById: null, note: null, runId: lmsFailedRun.id, series: series(6000, 400, 13, 0) },
    { id: 2, kind: 'FRESHNESS', targetType: 'DATASET', targetId: String(research), targetName: 'gold.fact_research_output', observedValue: 38, expectedLow: null, expectedHigh: 31, severity: 'MEDIUM', status: 'ACKNOWLEDGED', detectedAt: iso(now - 7 * DAY), acknowledgedById: ID.steward, note: 'Phòng KHCN gửi file mới vào cuối tháng.', runId: null, series: Array.from({ length: 14 }, (_, i) => ({ at: iso(now - (13 - i) * DAY), value: 25 + i, low: null, high: 31, anomalous: 25 + i > 31 })) },
    { id: 3, kind: 'METRIC_DRIFT', targetType: 'METRIC', targetId: 'academic_warning_rate', targetName: 'Tỉ lệ cảnh báo học vụ', observedValue: 21.4, expectedLow: 8.1, expectedHigh: 15.9, severity: 'MEDIUM', status: 'OPEN', detectedAt: iso(now - 2 * DAY), acknowledgedById: null, note: null, runId: null, series: series(12, 1.9, 13, 21.4) },
    { id: 4, kind: 'VOLUME', targetType: 'DATASET', targetId: String(dsId('bronze.fin_tuition')), targetName: 'bronze.fin_tuition', observedValue: 2140, expectedLow: 3400, expectedHigh: 4100, severity: 'LOW', status: 'RESOLVED', detectedAt: iso(now - 10 * DAY), acknowledgedById: ID.engineer, note: 'File thiếu một khoa, đã nhận bản bổ sung.', runId: null, series: series(3750, 170, 4, 2140) },
  ];

  // ── Lineage ──
  let nodeSeq = 0;
  const node = (type: MLineageNode['type'], refId: string, name: string, layer?: MLineageNode['layer']) => {
    const n = { id: ++nodeSeq, type, refId, name, layer };
    db.lineageNodes.push(n);
    return n.id;
  };
  const sourceNode: Record<string, number> = {};
  for (const s of db.sources.filter((x) => x.status !== 'DRAFT')) sourceNode[s.code] = node('SOURCE', s.code, s.name);
  const datasetNode: Record<string, number> = {};
  for (const d of db.datasets) datasetNode[`${d.schemaName}.${d.tableName}`] = node('DATASET', String(d.id), `${d.schemaName}.${d.tableName}`, d.layer);
  const metricNode: Record<string, number> = {};
  for (const m of db.metrics) metricNode[m.code] = node('METRIC', m.code, m.name);
  const dashNode: Record<number, number> = {};
  for (const d of db.dashboards) dashNode[d.id] = node('DASHBOARD', String(d.id), d.title);
  let edgeSeq = 0;
  const edge = (from: number, to: number, transformRef: string | null = null) => db.lineageEdges.push({ id: ++edgeSeq, from, to, transformRef });
  const dsn = (fq: string) => datasetNode[fq];
  edge(sourceNode['SRC-SIS'], dsn('bronze.sis_students'), 'dagster: landing_sis_students');
  edge(sourceNode['SRC-SIS'], dsn('bronze.sis_enrollments'), 'dagster: landing_sis_enrollments');
  edge(sourceNode['SRC-HRM'], dsn('bronze.hrm_staff'), 'dagster: landing_hrm_staff');
  edge(sourceNode['SRC-FIN'], dsn('bronze.fin_tuition'), 'upload');
  edge(sourceNode['SRC-LMS'], dsn('bronze.lms_activity'), 'dagster: landing_lms_activity');
  edge(sourceNode['SRC-RES'], dsn('gold.fact_research_output'), 'upload');
  edge(dsn('bronze.sis_students'), dsn('silver.silver_sis_students'), 'dbt: silver_sis_students');
  edge(dsn('bronze.fin_tuition'), dsn('silver.silver_fin_tuition'), 'dbt: silver_fin_tuition');
  edge(dsn('bronze.fin_tuition'), dsn('quarantine.fin_tuition'), 'dq: quarantine');
  edge(dsn('bronze.hrm_staff'), dsn('silver.silver_hrm_staff'), 'dbt: silver_hrm_staff');
  edge(dsn('bronze.lms_activity'), dsn('silver.silver_lms_activity'), 'dbt: silver_lms_activity');
  edge(dsn('silver.silver_sis_students'), dsn('gold.dim_person'), 'dbt: dim_person');
  edge(dsn('silver.silver_hrm_staff'), dsn('gold.dim_person'), 'dbt: dim_person');
  edge(dsn('silver.silver_sis_students'), dsn('gold.dim_student'), 'dbt: dim_student');
  edge(dsn('bronze.sis_enrollments'), dsn('gold.fact_term_result'), 'dbt: fact_term_result');
  edge(dsn('silver.silver_fin_tuition'), dsn('gold.fact_tuition'), 'dbt: fact_tuition');
  edge(dsn('silver.silver_hrm_staff'), dsn('gold.dim_lecturer'), 'dbt: dim_lecturer');
  edge(dsn('gold.dim_lecturer'), dsn('gold.fact_teaching_load'), 'dbt: fact_teaching_load');
  edge(dsn('gold.dim_student'), dsn('gold.mart_student_term_kpi'), 'dbt: mart_student_term_kpi');
  edge(dsn('gold.fact_term_result'), dsn('gold.mart_student_term_kpi'), 'dbt: mart_student_term_kpi');
  edge(dsn('gold.fact_tuition'), dsn('gold.mart_student_term_kpi'), 'dbt: mart_student_term_kpi');
  for (const m of db.metrics) {
    const base = db.dataset(m.baseDatasetId);
    if (base) edge(datasetNode[`${base.schemaName}.${base.tableName}`], metricNode[m.code], 'semantic');
  }
  for (const d of db.dashboards) {
    const used = new Set(d.widgets.flatMap((x) => x.querySpec.metrics));
    for (const code of used) if (metricNode[code]) edge(metricNode[code], dashNode[d.id], 'widget');
  }

  // ── Chính sách phân quyền ──
  db.policies = [
    { id: 1, name: 'Giới hạn khoa cho người dùng báo cáo', datasetId: mart, roleCode: 'REPORT_VIEWER', active: true, versions: [{ version: 1, rowFilter: "faculty_code = current_user_attr('faculty_code')", columnRules: [], changeNote: 'Khởi tạo', createdById: ID.admin, createdAt: iso(now - 50 * DAY) }] },
    { id: 2, name: 'Che định danh trong dim_person', datasetId: dsId('gold.dim_person'), roleCode: 'REPORT_VIEWER', active: true, versions: [
      { version: 1, rowFilter: null, columnRules: [{ column: 'national_id_hash', action: 'DENY' }], changeNote: 'Khởi tạo', createdById: ID.admin, createdAt: iso(now - 50 * DAY) },
      { version: 2, rowFilter: "primary_org_unit_code = current_user_attr('faculty_code')", columnRules: [{ column: 'national_id_hash', action: 'DENY' }, { column: 'date_of_birth', action: 'DENY' }, { column: 'phone', action: 'MASK_PARTIAL' }, { column: 'gender', action: 'HASH' }], changeNote: 'Thêm giới hạn khoa và che ngày sinh, điện thoại', createdById: ID.admin, createdAt: iso(now - 12 * DAY) },
    ] },
    { id: 3, name: 'Che số tiền học phí', datasetId: dsId('gold.fact_tuition'), roleCode: 'BI_ANALYST', active: true, versions: [{ version: 1, rowFilter: null, columnRules: [{ column: 'amount_due', action: 'MASK_PARTIAL' }, { column: 'amount_paid', action: 'MASK_PARTIAL' }], changeNote: 'Khởi tạo', createdById: ID.admin, createdAt: iso(now - 35 * DAY) }] },
  ];

  // ── Chủ đề bị chặn ──
  db.blockedTopics = [
    { id: 1, pattern: 'cccd|căn cước', description: 'Không trả định danh RESTRICTED', createdById: ID.admin, createdAt: iso(now - 60 * DAY) },
    { id: 2, pattern: 'lương', description: 'Dữ liệu lương cá nhân', createdById: ID.admin, createdAt: iso(now - 60 * DAY) },
    { id: 3, pattern: 'sức khỏe|bệnh án', description: 'Dữ liệu sức khỏe ngoài phạm vi', createdById: ID.admin, createdAt: iso(now - 60 * DAY) },
  ];

  // ── Thông báo ──
  db.notifications = [
    { id: 1, userId: ID.dean, type: 'REPORT_SENT', title: 'Báo cáo tuần “Tổng quan đào tạo” đã gửi', link: '/reports', readAt: null, createdAt: iso(now - 5 * DAY) },
    { id: 2, userId: ID.dean, type: 'ALERT', title: 'Cảnh báo: tỉ lệ cảnh báo học vụ vượt dải kỳ vọng', link: '/alerts', readAt: null, createdAt: iso(now - 2 * DAY) },
    { id: 3, userId: ID.steward, type: 'ACCESS_REQUEST', title: 'Yêu cầu truy cập mới từ Võ Ngọc Yến', link: '/access?box=review', readAt: null, createdAt: iso(now - 6 * HOUR) },
    { id: 4, userId: ID.engineer, type: 'RUN_FAILED', title: 'Run SRC-LMS thất bại', link: `/runs/${lmsFailedRun.id}`, readAt: null, createdAt: iso(lmsFailedRun.queuedAt + 3 * 60_000) },
    { id: 5, userId: ID.analyst, type: 'ACCESS_APPROVED', title: 'Yêu cầu xem tab Tài chính đã được duyệt', link: '/me', readAt: iso(now - 30 * DAY), createdAt: iso(now - 31 * DAY) },
  ];

  // ── Hội thoại trợ lý mẫu ──
  db.conversations = [
    { id: mockUuid(5, 1), userId: ID.dean, title: 'Cảnh báo học vụ khoa CNTT', dashboardId: 1, createdAt: iso(now - 3 * DAY), messages: [] },
  ];

  // ── Audit mẫu ──
  const actions: [string, string, string][] = [
    ['PROFILE_VIEW', 'PROFILE', ID.dean],
    ['QUERY', 'DASHBOARD', ID.dean],
    ['EXPORT', 'DASHBOARD', ID.analyst],
    ['GRANT_CHANGE', 'ACCESS_REQUEST', ID.steward],
    ['DATASET_PREVIEW', 'DATASET', ID.engineer],
    ['ROLE_CHANGE', 'USER', ID.admin],
    ['QA_ASK', 'CONVERSATION', ID.dean],
    ['PROFILE_VIEW', 'PROFILE', ID.deanKt],
  ];
  for (let i = 0; i < 36; i++) {
    const [action, objectType, actorId] = actions[i % actions.length];
    db.audits.push({
      id: 4000 + i,
      occurredAt: iso(now - i * 7 * HOUR),
      actorId,
      action,
      objectType,
      objectId: objectType === 'PROFILE' ? db.persons[i % db.persons.length].id : String((i % 5) + 1),
      outcome: i % 11 === 5 ? 'DENY' : 'ALLOW',
      ip: `10.0.${i % 4}.${20 + (i % 30)}`,
      details: i % 11 === 5 ? { reason: 'Ngoài phạm vi đơn vị' } : {},
    });
  }

  return db;
}
