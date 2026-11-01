import type { FacetCode, FacetData, MaskableValue, Profile360, ProfileSummary, Sensitivity, SubjectType, TabularResult, TimelineEvent } from '../../api/models';
import { FACET_LABELS } from '../../util/labels';
import { maskPartial, matchesQuery } from '../../util/text';
import type { MockDb } from '../db';
import { freshness } from '../mappers';
import { MockRouter, ok, paginate, problem, requireRole } from '../router';
import { PROGRAM_NAMES } from '../seed-people';
import { unitsOf } from '../seed-people';
import type { MPerson, MUser } from '../types';

const FACETS: Record<SubjectType, FacetCode[]> = {
  STUDENT: ['OVERVIEW', 'ACADEMIC', 'FINANCE', 'CONDUCT', 'ACTIVITY', 'OUTCOME'],
  LECTURER: ['OVERVIEW', 'TEACHING', 'RESEARCH', 'EVALUATION'],
  STAFF: ['OVERVIEW', 'HR', 'DEVELOPMENT', 'RECOGNITION'],
};

/** Facet chứa dữ liệu nhạy cảm, cần quyền PROFILE_FACET được cấp riêng (BR08, BR09). */
const GRANT_REQUIRED: FacetCode[] = ['FINANCE', 'HR', 'EVALUATION'];

const FACET_DATASET: Record<FacetCode, [string, string[]]> = {
  OVERVIEW: ['gold.dim_person', ['SIS', 'HRM']],
  ACADEMIC: ['gold.fact_term_result', ['SIS']],
  FINANCE: ['gold.fact_tuition', ['FIN']],
  CONDUCT: ['gold.fact_term_result', ['STA']],
  ACTIVITY: ['silver.silver_lms_activity', ['LMS', 'LIB']],
  OUTCOME: ['gold.dim_student', ['SIS', 'SUR']],
  TEACHING: ['gold.fact_teaching_load', ['SIS']],
  RESEARCH: ['gold.fact_research_output', ['RES']],
  EVALUATION: ['gold.fact_teaching_load', ['SUR']],
  HR: ['silver.silver_hrm_staff', ['HRM']],
  DEVELOPMENT: ['silver.silver_hrm_staff', ['HRM']],
  RECOGNITION: ['silver.silver_hrm_staff', ['HRM']],
};

const PROFILE_ROLES = ['REPORT_VIEWER', 'BI_ANALYST', 'DATA_STEWARD'] as const;

function facetAllowed(db: MockDb, user: MUser, facet: FacetCode): boolean {
  if (!GRANT_REQUIRED.includes(facet)) return true;
  return db.hasRole(user, 'DATA_STEWARD') || db.hasGrant(user.id, 'PROFILE_FACET', facet);
}

function mv(db: MockDb, user: MUser, value: unknown, sensitivity: Sensitivity, source: string | null, mask?: (v: string) => string): MaskableValue {
  const hidden = sensitivity === 'RESTRICTED' || (sensitivity === 'CONFIDENTIAL' && !db.hasRole(user, 'DATA_STEWARD'));
  if (!hidden || value === null || value === undefined) return { value, masked: false, sensitivity, source };
  return { value: mask ? mask(String(value)) : '••••', masked: true, sensitivity, source };
}

function codeOf(p: MPerson): string {
  return p.student?.code ?? p.lecturer?.code ?? p.staff?.code ?? '';
}

function statusOf(p: MPerson): string {
  return p.student?.status ?? (p.lecturer ? 'Đang giảng dạy' : 'Đang công tác');
}

function summaryOf(db: MockDb, p: MPerson): ProfileSummary {
  return {
    personId: p.id,
    fullName: p.fullName,
    code: codeOf(p),
    roles: p.roles,
    orgUnit: db.orgUnitRef(p.primaryUnit),
    status: statusOf(p),
    completeness: p.completeness,
  };
}

function table(columns: [string, string, boolean?][], rows: unknown[][]): TabularResult {
  return { columns: columns.map(([name, type, masked]) => ({ name, type, masked: !!masked })), rows };
}

function findPerson(db: MockDb, user: MUser, id: string): MPerson | null {
  const p = db.persons.find((x) => x.id === id);
  return p && db.inScope(user, p) ? p : null;
}

const NOT_FOUND = () => problem(404, 'Không tìm thấy hồ sơ', 'Hồ sơ không tồn tại hoặc nằm ngoài phạm vi quyền của bạn.');

export function registerProfiles(router: MockRouter): void {
  router
    .add('GET', '/profiles', (req) => {
      const denied = requireRole(req, ...PROFILE_ROLES);
      if (denied) return denied;
      const { db, user, query } = req;
      const q = query.get('q') ?? '';
      const type = query.get('type');
      const orgUnit = query.get('orgUnit');
      const cohort = query.get('cohort');
      const status = query.get('status');
      const items = db.persons
        .filter((p) => db.inScope(user, p))
        .filter((p) => !q || matchesQuery(`${p.fullName} ${p.email} ${codeOf(p)}`, q))
        .filter((p) => !type || p.roles.includes(type as SubjectType))
        .filter((p) => !orgUnit || unitsOf(p).includes(orgUnit))
        .filter((p) => !cohort || p.student?.cohort === cohort)
        .filter((p) => !status || p.student?.status === status)
        .map((p) => summaryOf(db, p));
      return ok(paginate(items, query));
    })
    .add('GET', '/profiles/:personId', (req) => {
      const denied = requireRole(req, ...PROFILE_ROLES);
      if (denied) return denied;
      const { db, user, params, query } = req;
      const p = findPerson(db, user, params['personId']);
      if (!p) {
        db.audit(user.id, 'PROFILE_VIEW', 'PROFILE', params['personId'], 'DENY');
        return NOT_FOUND();
      }
      const requested = query.get('role') as SubjectType | null;
      const role: SubjectType = requested && p.roles.includes(requested) ? requested : p.roles[0];
      const src = role === 'STUDENT' ? 'SIS' : 'HRM';
      const header: Record<string, MaskableValue> = {
        fullName: mv(db, user, p.fullName, 'INTERNAL', src),
        code: mv(db, user, role === 'STUDENT' ? p.student?.code : (p.lecturer?.code ?? p.staff?.code), 'INTERNAL', src),
        email: mv(db, user, p.email, 'INTERNAL', src),
        phone: mv(db, user, p.phone, 'CONFIDENTIAL', src, (v) => maskPartial(v, 3)),
        gender: mv(db, user, p.gender, 'CONFIDENTIAL', src),
        dateOfBirth: mv(db, user, p.dob, 'RESTRICTED', src, () => '••/••/••••'),
        nationalId: mv(db, user, p.nationalId, 'RESTRICTED', src, (v) => maskPartial(v, 3)),
        orgUnit: mv(db, user, db.orgUnitRef(role === 'STUDENT' ? (p.student?.faculty ?? p.primaryUnit) : p.primaryUnit).name, 'PUBLIC', src),
        status: mv(db, user, role === 'STUDENT' ? p.student?.status : role === 'LECTURER' ? p.lecturer?.employment : p.staff?.contract, 'INTERNAL', src),
      };
      if (role === 'STUDENT' && p.student) {
        header['cohort'] = mv(db, user, p.student.cohort, 'PUBLIC', 'SIS');
        header['className'] = mv(db, user, p.student.className, 'PUBLIC', 'SIS');
        header['program'] = mv(db, user, PROGRAM_NAMES[p.student.program] ?? p.student.program, 'PUBLIC', 'SIS');
      }
      if (role === 'LECTURER' && p.lecturer) {
        header['academicTitle'] = mv(db, user, [p.lecturer.title, p.lecturer.degree].filter(Boolean).join(', '), 'PUBLIC', 'HRM');
      }
      if (role === 'STAFF' && p.staff) header['position'] = mv(db, user, p.staff.position, 'INTERNAL', 'HRM');

      const kpis: NonNullable<Profile360['kpis']> = [];
      if (role === 'STUDENT' && p.student) {
        const last = p.student.terms[p.student.terms.length - 1];
        const tuition = p.student.tuition[p.student.tuition.length - 1];
        kpis.push(
          { code: 'gpa_cumulative', label: 'GPA tích lũy', value: { value: last?.gpaCum ?? null, masked: false, sensitivity: 'CONFIDENTIAL', source: 'SIS' } },
          { code: 'credits_earned', label: 'Tín chỉ tích lũy', value: { value: p.student.terms.reduce((s, t) => s + t.credits, 0), masked: false, sensitivity: 'INTERNAL', source: 'SIS' } },
          { code: 'conduct_score', label: 'Điểm rèn luyện', value: { value: last?.conduct ?? null, masked: false, sensitivity: 'CONFIDENTIAL', source: 'STA' } },
          {
            code: 'tuition_status',
            label: 'Học phí kỳ gần nhất',
            value: facetAllowed(db, user, 'FINANCE')
              ? { value: tuition ? { PAID: 'Đã nộp đủ', PARTIAL: 'Nộp một phần', UNPAID: 'Chưa nộp' }[tuition.status] : null, masked: false, sensitivity: 'CONFIDENTIAL', source: 'FIN' }
              : { value: '••••', masked: true, sensitivity: 'CONFIDENTIAL', source: 'FIN' },
          },
        );
      } else if (role === 'LECTURER' && p.lecturer) {
        const year = p.lecturer.teaching.filter((t) => t.term.startsWith('2025-2026'));
        const evals = p.lecturer.evaluations.filter((e) => e.responses >= 5);
        kpis.push(
          { code: 'teaching_hours', label: 'Giờ giảng 2025–2026', value: { value: year.reduce((s, t) => s + t.hours, 0), masked: false, sensitivity: 'INTERNAL', source: 'SIS' } },
          { code: 'publications', label: 'Số công bố', value: { value: p.lecturer.research.filter((r) => r.type === 'PUBLICATION').length, masked: false, sensitivity: 'PUBLIC', source: 'RES' } },
          {
            code: 'teaching_score',
            label: 'Điểm đánh giá giảng dạy',
            value: facetAllowed(db, user, 'EVALUATION')
              ? { value: evals.length ? Math.round((evals.reduce((s, e) => s + e.score, 0) / evals.length) * 100) / 100 : null, masked: false, sensitivity: 'CONFIDENTIAL', source: 'SUR' }
              : { value: '••••', masked: true, sensitivity: 'CONFIDENTIAL', source: 'SUR' },
          },
        );
      } else if (p.staff) {
        kpis.push(
          { code: 'seniority', label: 'Thâm niên (năm)', value: { value: new Date(db.clock()).getFullYear() - Number(p.staff.startDate.slice(0, 4)), masked: false, sensitivity: 'INTERNAL', source: 'HRM' } },
          { code: 'grade', label: 'Ngạch bậc', value: facetAllowed(db, user, 'HR') ? { value: p.staff.grade, masked: false, sensitivity: 'CONFIDENTIAL', source: 'HRM' } : { value: '••••', masked: true, sensitivity: 'CONFIDENTIAL', source: 'HRM' } },
          { code: 'trainings', label: 'Khóa bồi dưỡng', value: { value: p.staff.trainings.length, masked: false, sensitivity: 'INTERNAL', source: 'HRM' } },
        );
      }

      const profile: Profile360 = {
        personId: p.id,
        activeRole: role,
        availableRoles: p.roles,
        header,
        kpis,
        facets: FACETS[role].map((code) => ({
          code,
          label: FACET_LABELS[code],
          allowed: facetAllowed(db, user, code),
          freshness: { ...freshness(db, db.datasetByName(FACET_DATASET[code][0])), sources: FACET_DATASET[code][1] },
        })),
      };
      db.audit(user.id, 'PROFILE_VIEW', 'PROFILE', p.id);
      db.remember(user.id, 'PROFILE', p.id, p.fullName);
      return ok(profile);
    })
    .add('GET', '/profiles/:personId/facets/:facet', (req) => {
      const denied = requireRole(req, ...PROFILE_ROLES);
      if (denied) return denied;
      const { db, user, params } = req;
      const p = findPerson(db, user, params['personId']);
      if (!p) return NOT_FOUND();
      const facet = params['facet'] as FacetCode;
      if (!facetAllowed(db, user, facet)) {
        db.audit(user.id, 'FACET_VIEW', 'PROFILE', `${p.id}/${facet}`, 'DENY');
        return problem(403, 'Facet bị khóa', `Bạn chưa có quyền xem tab ${FACET_LABELS[facet] ?? facet}.`, {
          requestable: { resourceType: 'PROFILE_FACET', resourceId: facet },
        });
      }
      db.audit(user.id, 'FACET_VIEW', 'PROFILE', `${p.id}/${facet}`);
      return ok(facetData(db, user, p, facet));
    })
    .add('GET', '/profiles/:personId/timeline', (req) => {
      const denied = requireRole(req, ...PROFILE_ROLES);
      if (denied) return denied;
      const { db, user, params, query } = req;
      const p = findPerson(db, user, params['personId']);
      if (!p) return NOT_FOUND();
      const types = query.get('eventType')?.split(',').filter(Boolean) ?? [];
      const sources = query.get('source')?.split(',').filter(Boolean) ?? [];
      const before = query.get('before');
      const size = Math.min(50, Number(query.get('pageSize') ?? 10));
      const events = timeline(p)
        .filter((e) => facetAllowed(db, user, e.facet as FacetCode))
        .filter((e) => !types.length || types.includes(e.type ?? ''))
        .filter((e) => !sources.length || sources.includes(e.source ?? ''))
        .filter((e) => !before || (e.time ?? '') < before);
      const items = events.slice(0, size);
      return ok({ items, nextBefore: events.length > size ? items[items.length - 1].time : null });
    })
    .add('GET', '/profiles/:personId/attributes/:attribute/provenance', (req) => {
      const denied = requireRole(req, ...PROFILE_ROLES);
      if (denied) return denied;
      const { db, user, params } = req;
      const p = findPerson(db, user, params['personId']);
      if (!p) return NOT_FOUND();
      const attr = params['attribute'];
      const isStudent = p.roles[0] === 'STUDENT';
      const winning = isStudent ? 'SIS' : 'HRM';
      const steward = db.hasRole(user, 'DATA_STEWARD');
      const specs: Record<string, [unknown, Sensitivity, [string, unknown][]]> = {
        fullName: [p.fullName, 'INTERNAL', Object.entries(p.sourceNames)],
        email: [p.email, 'INTERNAL', [[winning, p.email], ['LMS', p.email.toUpperCase()]]],
        phone: [p.phone, 'CONFIDENTIAL', [[winning, p.phone], ['FIN', p.phone.replace(/^0/, '+84')]]],
        dateOfBirth: [p.dob, 'RESTRICTED', [[winning, p.dob]]],
        nationalId: [p.nationalId, 'RESTRICTED', [[winning, p.nationalId]]],
        orgUnit: [p.primaryUnit, 'PUBLIC', [[winning, p.primaryUnit]]],
      };
      const spec = specs[attr];
      if (!spec) return problem(404, 'Không có thuộc tính này');
      const [value, sensitivity, candidates] = spec;
      const showCandidates = sensitivity !== 'RESTRICTED' && (steward || sensitivity === 'INTERNAL' || sensitivity === 'PUBLIC');
      return ok({
        attribute: attr,
        value: mv(db, user, value, sensitivity, winning, sensitivity === 'RESTRICTED' ? (v: string) => maskPartial(v, 3) : undefined),
        winningSource: winning,
        sourceUpdatedAt: p.updatedAt,
        survivorshipRule: isStudent ? 'Ưu tiên SIS cho thông tin học vụ; nguồn khác chỉ bổ sung khi SIS trống' : 'Ưu tiên HRM cho thông tin nhân sự',
        candidates: showCandidates ? candidates.map(([source, v]) => ({ source, value: v, updatedAt: p.updatedAt })) : [],
      });
    });
}

function facetData(db: MockDb, user: MUser, p: MPerson, facet: FacetCode): FacetData {
  const [dataset, sources] = FACET_DATASET[facet];
  const base: FacetData = { facet, freshness: { ...freshness(db, db.datasetByName(dataset)), sources }, fields: {}, tables: [], series: [] };
  const f = (value: unknown, sensitivity: Sensitivity = 'INTERNAL', source = sources[0]) => mv(db, user, value, sensitivity === 'CONFIDENTIAL' ? 'INTERNAL' : sensitivity, source);
  const s = p.student;
  const l = p.lecturer;
  const st = p.staff;
  switch (facet) {
    case 'OVERVIEW':
      if (s) base.fields = { 'Ngày nhập học': f(s.admissionDate), 'Lớp': f(s.className), 'Ngành': f(PROGRAM_NAMES[s.program] ?? s.program), 'Khóa': f(s.cohort), 'Trạng thái': f(s.status), 'Ở ký túc xá': f(s.dormitory ? 'Có' : 'Không') };
      else if (l) base.fields = { 'Học hàm': f(l.title ?? '—'), 'Học vị': f(l.degree), 'Loại hình': f(l.employment), 'Khoa': f(db.orgUnitRef(l.faculty).name) };
      else if (st) base.fields = { 'Đơn vị': f(db.orgUnitRef(st.unit).name), 'Chức vụ': f(st.position), 'Hợp đồng': f(st.contract), 'Ngày vào làm': f(st.startDate) };
      break;
    case 'ACADEMIC':
      if (!s) break;
      base.tables = [
        { code: 'terms', title: 'Kết quả theo học kỳ', ...table([['Học kỳ', 'varchar'], ['GPA', 'decimal'], ['GPA tích lũy', 'decimal'], ['Tín chỉ', 'integer'], ['Cảnh báo', 'varchar']], s.terms.map((t) => [t.term, t.gpa, t.gpaCum, t.credits, t.warning ? `Mức ${t.warning}` : '—'])) },
        { code: 'courses', title: `Học phần kỳ ${s.terms[s.terms.length - 1]?.term ?? ''}`, ...table([['Mã', 'varchar'], ['Học phần', 'varchar'], ['Tín chỉ', 'integer'], ['Điểm', 'decimal'], ['Điểm chữ', 'varchar']], (s.terms[s.terms.length - 1]?.courses ?? []).map((c) => [c.code, c.name, c.credits, c.score, c.letter])) },
      ];
      base.series = [{ code: 'gpa_by_term', points: s.terms.map((t) => ({ x: t.term, y: t.gpa })) }];
      break;
    case 'FINANCE':
      if (!s) break;
      base.fields = { 'Tổng phải nộp': f(s.tuition.reduce((a, t) => a + t.due, 0)), 'Tổng đã nộp': f(s.tuition.reduce((a, t) => a + t.paid, 0)), 'Tổng học bổng': f(s.tuition.reduce((a, t) => a + t.scholarship, 0)) };
      base.tables = [{ code: 'tuition', title: 'Học phí theo học kỳ', ...table([['Học kỳ', 'varchar'], ['Phải nộp', 'decimal'], ['Đã nộp', 'decimal'], ['Học bổng', 'decimal'], ['Trạng thái', 'varchar']], s.tuition.map((t) => [t.term, t.due, t.paid, t.scholarship, { PAID: 'Đã nộp đủ', PARTIAL: 'Một phần', UNPAID: 'Chưa nộp' }[t.status]])) }];
      break;
    case 'CONDUCT':
      if (!s) break;
      base.series = [{ code: 'conduct_by_term', points: s.terms.map((t) => ({ x: t.term, y: t.conduct })) }];
      base.tables = [
        { code: 'awards', title: 'Khen thưởng', ...table([['Ngày', 'date'], ['Nội dung', 'varchar'], ['Cấp', 'varchar']], s.awards.map((a) => [a.date, a.title, a.level])) },
        { code: 'disciplines', title: 'Kỷ luật (RESTRICTED)', ...table([['Ngày', 'date', true], ['Nội dung', 'varchar', true]], s.disciplines.map(() => ['••••', '••••'])) },
      ];
      break;
    case 'ACTIVITY':
      if (!s) break;
      base.fields = { 'Lượt mượn thư viện (năm học)': f(s.libraryLoans) };
      base.tables = [{ code: 'lms', title: 'Hoạt động LMS 30 ngày gần nhất', ...table([['Ngày', 'date'], ['Học phần', 'varchar'], ['Đăng nhập', 'integer'], ['Nộp bài', 'integer'], ['Phút hoạt động', 'integer']], s.lms.map((a) => [a.date, a.course, a.logins, a.submissions, a.minutes])) }];
      break;
    case 'OUTCOME':
      if (!s) break;
      base.fields = { 'Trạng thái': f(s.status), 'Dự kiến tốt nghiệp': f(`${Number(s.admissionDate.slice(0, 4)) + 4}-06`), 'Việc làm sau tốt nghiệp': f(s.employment ?? 'Chưa có dữ liệu khảo sát') };
      break;
    case 'TEACHING':
      if (!l) break;
      base.tables = [{ code: 'teaching', title: 'Học phần giảng dạy', ...table([['Học kỳ', 'varchar'], ['Mã', 'varchar'], ['Học phần', 'varchar'], ['Số lớp', 'integer'], ['Giờ giảng', 'integer']], l.teaching.map((t) => [t.term, t.course, t.courseName, t.sections, t.hours])) }];
      base.series = [{ code: 'hours_by_term', points: [...new Set(l.teaching.map((t) => t.term))].map((term) => ({ x: term, y: l.teaching.filter((t) => t.term === term).reduce((a, t) => a + t.hours, 0) })) }];
      break;
    case 'RESEARCH':
      if (!l) break;
      base.tables = [{ code: 'research', title: 'Kết quả nghiên cứu', ...table([['Năm', 'integer'], ['Loại', 'varchar'], ['Tên', 'varchar'], ['Cấp', 'varchar'], ['Vai trò', 'varchar']], [...l.research].sort((a, b) => b.year - a.year).map((r) => [r.year, { PUBLICATION: 'Công bố', PROJECT: 'Đề tài', SUPERVISION: 'Hướng dẫn' }[r.type], r.title, r.level, r.role])) }];
      break;
    case 'EVALUATION':
      if (!l) break;
      base.tables = [{ code: 'evaluations', title: 'Đánh giá giảng dạy (thang 5)', ...table([['Học kỳ', 'varchar'], ['Học phần', 'varchar'], ['Số phản hồi', 'integer'], ['Điểm', 'decimal']], l.evaluations.map((e) => [e.term, e.course, e.responses < 5 ? '< 5' : e.responses, e.responses < 5 ? { suppressed: true } : e.score])) }];
      break;
    case 'HR':
      if (!st) break;
      base.fields = { 'Đơn vị': f(db.orgUnitRef(st.unit).name), 'Chức vụ': f(st.position), 'Ngạch bậc': f(st.grade), 'Loại hợp đồng': f(st.contract), 'Ngày vào làm': f(st.startDate) };
      break;
    case 'DEVELOPMENT':
      if (!st) break;
      base.tables = [{ code: 'trainings', title: 'Đào tạo, bồi dưỡng', ...table([['Năm', 'integer'], ['Khóa học', 'varchar']], st.trainings.map((t) => [t.year, t.title])) }];
      break;
    case 'RECOGNITION':
      if (!st) break;
      base.tables = [{ code: 'awards', title: 'Khen thưởng', ...table([['Ngày', 'date'], ['Nội dung', 'varchar'], ['Cấp', 'varchar']], st.awards.map((a) => [a.date, a.title, a.level])) }];
      break;
  }
  return base;
}

function timeline(p: MPerson): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let n = 0;
  const add = (time: string, type: string, facet: FacetCode, source: string, title: string) =>
    events.push({ eventId: `${p.id.slice(-6)}-${++n}`, time: time.length === 10 ? `${time}T08:00:00Z` : time, type, facet, source, title });
  const s = p.student;
  if (s) {
    add(s.admissionDate, 'ADMISSION', 'OVERVIEW', 'SIS', `Nhập học ngành ${PROGRAM_NAMES[s.program] ?? s.program}, lớp ${s.className}`);
    s.terms.forEach((t, i) => {
      const year = Number(t.term.slice(0, 4)) + (t.term.endsWith('HK2') ? 1 : 0);
      const month = t.term.endsWith('HK2') ? '06' : '01';
      add(`${year}-${month}-20`, 'TERM_RESULT', 'ACADEMIC', 'SIS', `Kết quả ${t.term}: GPA ${t.gpa}${t.warning ? ` — cảnh báo học vụ mức ${t.warning}` : ''}`);
      const tu = s.tuition[i];
      if (tu) add(`${t.term.endsWith('HK2') ? year : year - 1}-${t.term.endsWith('HK2') ? '02' : '09'}-15`, 'TUITION', 'FINANCE', 'FIN', `Học phí ${t.term}: ${{ PAID: 'đã nộp đủ', PARTIAL: 'nộp một phần', UNPAID: 'chưa nộp' }[tu.status]}`);
    });
    s.awards.forEach((a) => add(a.date, 'AWARD', 'CONDUCT', 'STA', a.title));
    if (s.lms[0]) add(s.lms[0].date, 'LMS_ACTIVITY', 'ACTIVITY', 'LMS', `Hoạt động gần nhất trên LMS: ${s.lms[0].course}`);
  }
  const l = p.lecturer;
  if (l) {
    l.research.forEach((r) => add(`${r.year}-10-01`, r.type, 'RESEARCH', 'RES', r.title));
    [...new Set(l.teaching.map((t) => t.term))].forEach((term) => add(`${term.slice(term.endsWith('HK2') ? 5 : 0, term.endsWith('HK2') ? 9 : 4)}-${term.endsWith('HK2') ? '02' : '09'}-01`, 'TEACHING', 'TEACHING', 'SIS', `Phân công giảng dạy ${term}`));
  }
  const st = p.staff;
  if (st) {
    add(st.startDate, 'CONTRACT', 'HR', 'HRM', `Bắt đầu công tác tại ${st.unit} — ${st.contract}`);
    st.trainings.forEach((t) => add(`${t.year}-05-01`, 'TRAINING', 'DEVELOPMENT', 'HRM', t.title));
    st.awards.forEach((a) => add(a.date, 'AWARD', 'RECOGNITION', 'HRM', a.title));
  }
  return events.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
}
