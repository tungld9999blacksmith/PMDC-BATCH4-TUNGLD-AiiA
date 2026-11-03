/** Sinh người (sinh viên, giảng viên, cán bộ) tổng hợp. Không có dữ liệu thật. */
import { foldVietnamese } from '../util/text';
import { Rng, mockUuid } from './rng';
import type { MLecturer, MPerson, MStaff, MStudent, MTermResult, MTuition } from './types';

export const FACULTY_PROGRAMS: Record<string, string[]> = {
  CNTT: ['KHMT', 'HTTT', 'KTPM'],
  KT: ['QTKD', 'TCNH'],
  NN: ['NNA', 'NNT'],
};

export const PROGRAM_NAMES: Record<string, string> = {
  KHMT: 'Khoa học máy tính',
  HTTT: 'Hệ thống thông tin',
  KTPM: 'Kỹ thuật phần mềm',
  QTKD: 'Quản trị kinh doanh',
  TCNH: 'Tài chính – Ngân hàng',
  NNA: 'Ngôn ngữ Anh',
  NNT: 'Ngôn ngữ Trung',
};

export const TERMS = [
  { code: '2024-2025-HK1', year: '2024-2025', semester: 1, startYear: 2024 },
  { code: '2024-2025-HK2', year: '2024-2025', semester: 2, startYear: 2024 },
  { code: '2025-2026-HK1', year: '2025-2026', semester: 1, startYear: 2025 },
  { code: '2025-2026-HK2', year: '2025-2026', semester: 2, startYear: 2025 },
];

const COURSES: Record<string, [string, string, number][]> = {
  CNTT: [
    ['IT101', 'Nhập môn lập trình', 3],
    ['IT205', 'Cấu trúc dữ liệu', 3],
    ['IT310', 'Cơ sở dữ liệu', 4],
    ['IT320', 'Mạng máy tính', 3],
    ['IT330', 'Trí tuệ nhân tạo', 3],
  ],
  KT: [
    ['EC120', 'Kinh tế vi mô', 3],
    ['EC240', 'Tài chính doanh nghiệp', 3],
    ['EC250', 'Marketing căn bản', 3],
    ['EC310', 'Kế toán quản trị', 3],
  ],
  NN: [
    ['LN110', 'Ngữ âm học', 2],
    ['LN210', 'Biên dịch', 3],
    ['LN220', 'Văn hóa Anh – Mỹ', 3],
    ['LN310', 'Phiên dịch', 3],
  ],
  COMMON: [
    ['MA101', 'Giải tích', 3],
    ['PH100', 'Triết học Mác – Lênin', 3],
  ],
};

const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương'];
const MIDDLE_M = ['Văn', 'Minh', 'Quốc', 'Đức', 'Gia', 'Hữu', 'Thành'];
const MIDDLE_F = ['Thị', 'Ngọc', 'Thu', 'Hồng', 'Mai', 'Thanh', 'Khánh'];
const GIVEN_M = ['An', 'Bình', 'Dũng', 'Hải', 'Khánh', 'Nam', 'Phúc', 'Quang', 'Tuấn', 'Long', 'Sơn', 'Trung', 'Hiếu', 'Kiên'];
const GIVEN_F = ['Chi', 'Hà', 'Linh', 'Oanh', 'Thảo', 'Vy', 'Yến', 'Lan', 'Ngân', 'Trang', 'Hương', 'My', 'Nhung', 'Quỳnh'];
const COHORT_YEAR: Record<string, number> = { K64: 2021, K65: 2022, K66: 2023, K67: 2024, K68: 2025 };
const TUITION_BY_FACULTY: Record<string, number> = { CNTT: 12_400_000, KT: 11_200_000, NN: 9_750_000 };
const RESEARCH_LEVELS = ['ISI/Scopus', 'Tạp chí trong nước', 'Hội thảo quốc tế', 'Cấp Bộ', 'Cấp trường'];

function letter(score: number): string {
  if (score >= 8.5) return 'A';
  if (score >= 7.0) return 'B';
  if (score >= 5.5) return 'C';
  if (score >= 4.0) return 'D';
  return 'F';
}

function makeName(rng: Rng): { name: string; gender: 'Nam' | 'Nữ' } {
  const female = rng.chance(0.5);
  const middle = female ? rng.pick(MIDDLE_F) : rng.pick(MIDDLE_M);
  const given = female ? rng.pick(GIVEN_F) : rng.pick(GIVEN_M);
  return { name: `${rng.pick(LAST)} ${middle} ${given}`, gender: female ? 'Nữ' : 'Nam' };
}

function emailOf(name: string, n: number, domain: string): string {
  const parts = foldVietnamese(name).split(/\s+/);
  return `${parts[parts.length - 1]}.${parts[0][0]}${n}@${domain}`;
}

function dob(rng: Rng, from: number, to: number): string {
  return `${rng.int(from, to)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;
}

function nationalId(rng: Rng): string {
  return Array.from({ length: 12 }, () => rng.int(0, 9)).join('');
}

function isoDaysAgo(now: number, days: number, rng?: Rng): string {
  const jitter = rng ? rng.int(0, 600) * 60_000 : 0;
  return new Date(now - days * 86_400_000 - jitter).toISOString();
}

function makeStudent(rng: Rng, n: number, now: number, faculty: string, cohort: string, graduate = false): MStudent {
  const program = graduate ? 'QTKD' : rng.pick(FACULTY_PROGRAMS[faculty]);
  const admissionYear = COHORT_YEAR[cohort];
  let status: MStudent['status'] = 'STUDYING';
  if (cohort === 'K64') status = rng.chance(0.7) ? 'GRADUATED' : 'STUDYING';
  else if (rng.chance(0.06)) status = 'DROPPED';
  else if (rng.chance(0.05)) status = 'RESERVED';

  let terms = TERMS.filter((t) => t.startYear >= admissionYear);
  if (status === 'GRADUATED') terms = terms.filter((t) => t.year === '2024-2025');
  if (status === 'DROPPED') terms = terms.slice(0, Math.max(1, rng.int(1, terms.length - 1)));

  const ability = rng.float(1.5, 3.8);
  const results: MTermResult[] = [];
  const tuition: MTuition[] = [];
  let cumSum = 0;
  const pool = [...COURSES[faculty], ...COURSES['COMMON']];
  terms.forEach((t, i) => {
    // Khóa K66 có xu hướng giảm điểm ở năm 2025-2026 (dữ liệu cho kịch bản persona P1).
    const drift = cohort === 'K66' && t.year === '2025-2026' ? -0.45 : 0;
    const gpa = Math.min(4, Math.max(0, Number((ability + drift + rng.float(-0.5, 0.5)).toFixed(2))));
    cumSum += gpa;
    const courses = rng.sample(pool, 4).map(([code, name, credits]) => {
      const score = Math.min(10, Math.max(0, Number((gpa * 2.4 + rng.float(-1.2, 1.2)).toFixed(1))));
      return { code, name, credits, score, letter: letter(score) };
    });
    results.push({
      term: t.code,
      year: t.year,
      gpa,
      gpaCum: Number((cumSum / (i + 1)).toFixed(2)),
      credits: courses.reduce((s, c) => s + c.credits, 0),
      warning: gpa < 1.0 ? 2 : gpa < 2.0 ? 1 : 0,
      conduct: rng.int(55, 96),
      courses,
    });
    const due = TUITION_BY_FACULTY[faculty];
    const scholarship = rng.chance(0.15) ? 2_000_000 : 0;
    const roll = rng.next();
    const paid = roll < 0.82 ? due - scholarship : roll < 0.92 ? Math.round((due - scholarship) / 2) : 0;
    tuition.push({
      term: t.code,
      due,
      paid,
      scholarship,
      status: paid + scholarship >= due ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID',
    });
  });

  return {
    code: graduate ? `HV${String(n).padStart(5, '0')}` : `SV${admissionYear}${String(n).padStart(4, '0')}`,
    faculty,
    program,
    cohort,
    className: graduate ? 'CH24-01' : `${program}${String(admissionYear).slice(2)}-0${rng.int(1, 3)}`,
    status,
    admissionDate: `${admissionYear}-09-05`,
    terms: results,
    tuition,
    lms: Array.from({ length: 8 }, () => ({
      date: isoDaysAgo(now, rng.int(0, 30)).slice(0, 10),
      course: rng.pick(pool)[0],
      logins: rng.int(0, 6),
      submissions: rng.int(0, 3),
      minutes: rng.int(0, 240),
    })).sort((a, b) => b.date.localeCompare(a.date)),
    libraryLoans: rng.int(0, 15),
    awards: rng.chance(0.12)
      ? [{ date: '2025-06-15', title: 'Sinh viên 5 tốt cấp trường', level: 'Cấp trường' }]
      : [],
    disciplines: rng.chance(0.03) ? [{ date: '2025-03-10', title: 'Khiển trách: vi phạm quy chế thi' }] : [],
    dormitory: rng.chance(0.3),
    employment: status === 'GRADUATED' ? rng.pick(['Có việc làm đúng ngành', 'Có việc làm trái ngành', 'Học tiếp sau đại học', 'Chưa có thông tin']) : null,
  };
}

function makeLecturer(rng: Rng, n: number, faculty: string): MLecturer {
  const pool = COURSES[faculty];
  const teaching: MLecturer['teaching'] = [];
  const evaluations: MLecturer['evaluations'] = [];
  for (const t of TERMS) {
    for (const [code, name] of rng.sample(pool, 2)) {
      const sections = rng.int(1, 3);
      teaching.push({ term: t.code, course: code, courseName: name, sections, hours: sections * 45 });
      evaluations.push({ term: t.code, course: code, responses: rng.int(2, 60), score: rng.float(3.2, 4.9) });
    }
  }
  const research: MLecturer['research'] = Array.from({ length: rng.int(0, 6) }, (_, i) => {
    const roll = rng.next();
    const type: MLecturer['research'][number]['type'] = roll < 0.6 ? 'PUBLICATION' : roll < 0.85 ? 'PROJECT' : 'SUPERVISION';
    return {
      type,
      title:
        type === 'PUBLICATION'
          ? `Bài báo ${i + 1}: ${rng.pick(['Học sâu cho dữ liệu giáo dục', 'Phân tích chuỗi thời gian', 'Tài chính hành vi', 'Ngữ dụng học đối chiếu', 'Kinh tế số'])}`
          : type === 'PROJECT'
            ? `Đề tài ${rng.pick(['cấp Bộ', 'cấp trường'])}: ${rng.pick(['Nền tảng dữ liệu mở', 'Chuyển đổi số giáo dục', 'Mô hình dự báo'])}`
            : `Hướng dẫn luận văn thạc sĩ ${i + 1}`,
      year: rng.int(2022, 2026),
      level: type === 'SUPERVISION' ? 'Thạc sĩ' : rng.pick(RESEARCH_LEVELS),
      role: rng.pick(['Tác giả chính', 'Đồng tác giả', 'Chủ nhiệm', 'Thành viên']),
    };
  });
  return {
    code: `GV${String(n).padStart(4, '0')}`,
    faculty,
    title: rng.chance(0.15) ? 'PGS' : rng.chance(0.03) ? 'GS' : null,
    degree: rng.chance(0.55) ? 'TS' : 'ThS',
    employment: rng.pick(['Cơ hữu', 'Cơ hữu', 'Thỉnh giảng']),
    teaching,
    research,
    evaluations,
  };
}

function makeStaff(rng: Rng, n: number, unit: string): MStaff {
  return {
    code: `CB${String(n).padStart(4, '0')}`,
    unit,
    position: rng.pick(['Chuyên viên', 'Chuyên viên chính', 'Trưởng phòng', 'Phó phòng', 'Kỹ sư dữ liệu']),
    grade: rng.pick(['Chuyên viên chính (bậc 3)', 'Chuyên viên (bậc 5)', 'Cán sự (bậc 4)']),
    contract: rng.pick(['Viên chức', 'Hợp đồng không xác định thời hạn', 'Hợp đồng 1 năm']),
    startDate: `${rng.int(2008, 2023)}-0${rng.int(1, 9)}-01`,
    trainings: Array.from({ length: rng.int(0, 3) }, () => ({
      year: rng.int(2021, 2026),
      title: rng.pick(['Bồi dưỡng quản lý nhà nước', 'An toàn thông tin', 'Kỹ năng phân tích dữ liệu', 'Ngoại ngữ B2']),
    })),
    awards: rng.chance(0.3) ? [{ date: '2025-12-20', title: 'Lao động tiên tiến', level: 'Cấp trường' }] : [],
  };
}

export function generatePeople(rng: Rng, now: number): MPerson[] {
  const people: MPerson[] = [];
  let seq = 0;
  const add = (p: Omit<MPerson, 'id'>) => people.push({ ...p, id: mockUuid(1, ++seq) });

  // Sinh viên
  for (let i = 1; i <= 168; i++) {
    const { name, gender } = makeName(rng);
    const roll = rng.next();
    const faculty = roll < 0.45 ? 'CNTT' : roll < 0.8 ? 'KT' : 'NN';
    const student = makeStudent(rng, i, now, faculty, rng.pick(['K64', 'K65', 'K66', 'K66', 'K67', 'K68']));
    add({
      fullName: name,
      dob: dob(rng, 2001, 2007),
      gender,
      email: emailOf(name, i, 'st.uni.edu.vn'),
      phone: `09${rng.int(10_000_000, 99_999_999)}`,
      nationalId: nationalId(rng),
      primaryUnit: faculty,
      roles: ['STUDENT'],
      student,
      updatedAt: isoDaysAgo(now, rng.int(0, 20), rng),
      completeness: rng.float(0.72, 1),
      sourceNames: { SIS: name, LMS: foldVietnamese(name), FIN: name.toUpperCase() },
    });
  }

  // Giảng viên
  for (let j = 1; j <= 36; j++) {
    const { name, gender } = makeName(rng);
    const faculty = rng.pick(['CNTT', 'CNTT', 'KT', 'KT', 'NN']);
    const lecturer = makeLecturer(rng, j, faculty);
    add({
      fullName: (lecturer.title ? `${lecturer.title}.` : '') + (lecturer.degree === 'TS' ? 'TS. ' : 'ThS. ') + name,
      dob: dob(rng, 1965, 1992),
      gender,
      email: emailOf(name, j, 'uni.edu.vn'),
      phone: `09${rng.int(10_000_000, 99_999_999)}`,
      nationalId: nationalId(rng),
      primaryUnit: faculty,
      roles: ['LECTURER'],
      lecturer,
      updatedAt: isoDaysAgo(now, rng.int(1, 40), rng),
      completeness: rng.float(0.8, 1),
      sourceNames: { HRM: name, SIS: name, RES: foldVietnamese(name) },
    });
  }

  // Cán bộ; một số đang học cao học (vừa là cán bộ vừa là sinh viên — BR06)
  for (let k = 1; k <= 18; k++) {
    const { name, gender } = makeName(rng);
    const unit = rng.pick(['PDT', 'TCCB', 'KHCN', 'TTDL', 'CNTT', 'KT']);
    const isGraduateStudent = k % 5 === 0;
    add({
      fullName: name,
      dob: dob(rng, 1975, 1998),
      gender,
      email: emailOf(name, k + 100, 'uni.edu.vn'),
      phone: `09${rng.int(10_000_000, 99_999_999)}`,
      nationalId: nationalId(rng),
      primaryUnit: unit,
      roles: isGraduateStudent ? ['STAFF', 'STUDENT'] : ['STAFF'],
      staff: makeStaff(rng, k, unit),
      student: isGraduateStudent ? makeStudent(rng, k, now, 'KT', 'K67', true) : undefined,
      updatedAt: isoDaysAgo(now, rng.int(1, 30), rng),
      completeness: rng.float(0.75, 1),
      sourceNames: { HRM: name, SIS: isGraduateStudent ? foldVietnamese(name) : name },
    });
  }
  return people;
}

/** Các đơn vị mà một người thuộc về (dùng để áp phạm vi quyền). */
export function unitsOf(person: MPerson): string[] {
  return [person.student?.faculty, person.lecturer?.faculty, person.staff?.unit].filter((u): u is string => !!u);
}
