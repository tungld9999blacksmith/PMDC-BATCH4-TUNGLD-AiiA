/**
 * Trợ lý mô phỏng (thay cho LLM ở chế độ demo). Giữ đúng ranh giới thiết kế (BR16):
 * chỉ chọn metric CERTIFIED, sinh SemanticQuery có cấu trúc, chạy dưới phạm vi người hỏi,
 * diễn giải từ kết quả tổng hợp, không bao giờ trả dữ liệu dòng.
 */
import type { AssistantMessage, Filter, SemanticQuery } from '../api/models';
import { foldVietnamese } from '../util/text';
import type { MockDb } from './db';
import { DIMENSIONS, SemanticError, baseOfMetric, execute } from './semantic';
import type { MMetric, MUser } from './types';

const METRIC_SYNONYMS: [string, string[]][] = [
  ['academic_warning_rate', ['canh bao hoc vu', 'canh bao']],
  ['dropout_rate', ['bo hoc', 'thoi hoc']],
  ['tuition_unpaid_rate', ['no hoc phi', 'chua dong hoc phi', 'hoc phi']],
  ['avg_gpa', ['gpa', 'diem trung binh', 'diem tb']],
  ['avg_conduct', ['ren luyen']],
  ['student_count', ['so sinh vien', 'bao nhieu sinh vien', 'so luong sinh vien', 'quy mo']],
  ['lecturer_count', ['so giang vien', 'bao nhieu giang vien']],
  ['teaching_hours', ['gio giang', 'khoi luong giang']],
  ['avg_teaching_score', ['danh gia giang day', 'diem danh gia']],
  ['publication_count', ['cong bo', 'bai bao']],
  ['research_project_count', ['de tai']],
  ['dq_score', ['chat luong du lieu', 'diem dq']],
];

const DIMENSION_SYNONYMS: [string, string[]][] = [
  ['faculty', ['theo khoa', 'giua cac khoa', 'tung khoa']],
  ['program', ['theo nganh', 'tung nganh']],
  ['cohort', ['theo khoa hoc', 'theo khoa tuyen', 'giua cac khoa k', 'theo k6', 'cac khoa k']],
  ['term', ['theo hoc ky', 'theo ky', 'qua cac ky', 'qua cac hoc ky', 'xu huong']],
  ['academic_year', ['theo nam hoc']],
  ['year', ['theo nam']],
  ['level', ['theo cap']],
];

const FACULTY_WORDS: [string, string[]][] = [
  ['CNTT', ['cntt', 'cong nghe thong tin']],
  ['KT', ['kinh te', 'khoa kt']],
  ['NN', ['ngoai ngu', 'khoa nn']],
];

const RESTRICTED_DETAIL = /(ngay sinh|so dien thoai|dia chi nha|danh sach (ten|ho ten|sinh vien|ca nhan)|liet ke .*(ten|sinh vien))/;
const INJECTION = /(bo qua|ignore).*(huong dan|chi dan|instruction)|system prompt|in ra (prompt|cau lenh)/;
const TOPIC_WORDS = /(hoc tap|dao tao|sinh vien|tinh hinh|ket qua)/;

export type Plan =
  | { kind: 'refuse'; reason: 'OUT_OF_SCOPE' | 'BLOCKED_TOPIC' | 'RESTRICTED_DETAIL' | 'NO_METRIC'; text: string }
  | { kind: 'clarify'; question: string; options: { label: string; patch: Record<string, unknown> }[] }
  | { kind: 'answer'; query: SemanticQuery; metric: MMetric };

export function plan(db: MockDb, user: MUser, question: string, clarification?: Record<string, unknown>): Plan {
  const q = ` ${foldVietnamese(question)} `;

  for (const topic of db.blockedTopics) {
    const pattern = new RegExp(foldVietnamese(topic.pattern));
    if (pattern.test(q)) return { kind: 'refuse', reason: 'BLOCKED_TOPIC', text: 'Câu hỏi thuộc chủ đề hạn chế nên tôi không trả lời.' };
  }
  if (INJECTION.test(q)) return { kind: 'refuse', reason: 'BLOCKED_TOPIC', text: 'Yêu cầu thay đổi chỉ dẫn của trợ lý không được chấp nhận.' };
  if (RESTRICTED_DETAIL.test(q)) {
    return { kind: 'refuse', reason: 'RESTRICTED_DETAIL', text: 'Tôi chỉ trả lời bằng số liệu tổng hợp, không cung cấp thông tin định danh hay danh sách cá nhân.' };
  }

  const certified = db.metrics.filter((m) => m.status === 'CERTIFIED');
  const metricCode =
    (clarification?.['metric'] as string | undefined) ??
    METRIC_SYNONYMS.map(([code, words]) => ({ code, pos: Math.min(...words.map((w) => (q.includes(w) ? q.indexOf(w) : Infinity))) }))
      .filter((x) => x.pos !== Infinity)
      .sort((a, b) => a.pos - b.pos)[0]?.code;
  const metric = certified.find((m) => m.code === metricCode);

  if (!metric) {
    if (metricCode) {
      return { kind: 'refuse', reason: 'NO_METRIC', text: 'Chỉ số liên quan chưa được chứng nhận nên tôi chưa trả lời được.' };
    }
    if (TOPIC_WORDS.test(q)) {
      return {
        kind: 'clarify',
        question: 'Bạn muốn xem chỉ số nào?',
        options: ['academic_warning_rate', 'avg_gpa', 'student_count', 'dropout_rate']
          .map((code) => certified.find((m) => m.code === code))
          .filter((m): m is MMetric => !!m)
          .map((m) => ({ label: m.name, patch: { metric: m.code } })),
      };
    }
    return { kind: 'refuse', reason: 'NO_METRIC', text: 'Tôi chưa tìm thấy chỉ số được chứng nhận phù hợp với câu hỏi.' };
  }

  const base = baseOfMetric(db, metric);
  const dimension =
    (clarification?.['dimension'] as string | undefined) ??
    DIMENSION_SYNONYMS.find(([code, words]) => DIMENSIONS[code].bases.includes(base) && words.some((w) => q.includes(w)))?.[0];

  const filters: Filter[] = [];
  const faculty = FACULTY_WORDS.find(([, words]) => words.some((w) => q.includes(` ${w}`)))?.[0];
  if (faculty && DIMENSIONS['faculty'].bases.includes(base)) {
    const scope = db.scopeOf(user);
    if (scope && !scope.includes(faculty)) {
      return { kind: 'refuse', reason: 'OUT_OF_SCOPE', text: `Bạn chưa được cấp quyền xem dữ liệu của ${db.orgUnitRef(faculty).name}.` };
    }
    filters.push({ dimension: 'faculty', op: 'eq', value: faculty });
  }
  const cohort = /\bk(6[4-8])\b/.exec(q)?.[1];
  if (cohort && base === 'student' && dimension !== 'cohort') filters.push({ dimension: 'cohort', op: 'eq', value: `K${cohort}` });
  const academicYear = /(20\d\d)\s*-\s*(20\d\d)/.exec(q);
  const year = /nam (20\d\d)/.exec(q)?.[1];
  if (academicYear && DIMENSIONS['academic_year'].bases.includes(base)) {
    filters.push({ dimension: 'academic_year', op: 'eq', value: `${academicYear[1]}-${academicYear[2]}` });
  } else if (year && base === 'research') {
    filters.push({ dimension: 'year', op: 'eq', value: year });
  } else if (year && DIMENSIONS['academic_year'].bases.includes(base)) {
    filters.push({ dimension: 'academic_year', op: 'in', values: [`${Number(year) - 1}-${year}`, `${year}-${Number(year) + 1}`] });
  }

  return {
    kind: 'answer',
    metric,
    query: { metrics: [metric.code], dimensions: dimension ? [dimension] : [], filters, limit: 50 },
  };
}

function fmt(value: unknown, unit: string): string {
  if (typeof value !== 'number') return '< 5 người (đã ẩn)';
  const n = value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  return unit === '%' ? `${n}%` : unit ? `${n} ${unit}` : n;
}

/** Diễn giải kết quả tổng hợp thành câu trả lời tiếng Việt (mô phỏng bước AnswerWriter). */
export function describe(db: MockDb, user: MUser, metric: MMetric, query: SemanticQuery, result: NonNullable<AssistantMessage['result']>): string {
  const rows = result.rows ?? [];
  const dim = query.dimensions?.[0];
  const filterText = (query.filters ?? [])
    .map((f) => (f.dimension === 'faculty' ? db.orgUnitRef(String(f.value)).name : f.op === 'in' ? (f.values ?? []).join(', ') : String(f.value)))
    .join(', ');
  const scope = db.scopeOf(user);
  const scopeText = scope ? ` (trong phạm vi ${scope.map((s) => db.orgUnitRef(s).name).join(', ')})` : '';
  const parts: string[] = [];

  if (!dim) {
    parts.push(`${metric.name}${filterText ? ` của ${filterText}` : ''}${scopeText} là ${fmt(rows[0]?.[0], metric.unit)}.`);
  } else {
    const items = rows.map((r) => ({ key: String(r[0]), value: r[1] }));
    const numeric = items.filter((x): x is { key: string; value: number } => typeof x.value === 'number');
    parts.push(`${metric.name} theo ${DIMENSIONS[dim].name.toLowerCase()}${filterText ? ` (${filterText})` : ''}${scopeText}:`);
    parts.push(items.map((x) => `${dim === 'faculty' ? db.orgUnitRef(x.key).name : x.key}: ${fmt(x.value, metric.unit)}`).join('; ') + '.');
    if (numeric.length >= 2) {
      if (dim === 'term' || dim === 'academic_year' || dim === 'year') {
        const first = numeric[0];
        const last = numeric[numeric.length - 1];
        const trend = last.value > first.value ? 'tăng' : last.value < first.value ? 'giảm' : 'không đổi';
        parts.push(`Xu hướng ${trend} từ ${fmt(first.value, metric.unit)} (${first.key}) tới ${fmt(last.value, metric.unit)} (${last.key}).`);
      } else {
        const sorted = [...numeric].sort((a, b) => b.value - a.value);
        const name = (k: string) => (dim === 'faculty' ? db.orgUnitRef(k).name : k);
        parts.push(`Cao nhất là ${name(sorted[0].key)} (${fmt(sorted[0].value, metric.unit)}), thấp nhất là ${name(sorted[sorted.length - 1].key)} (${fmt(sorted[sorted.length - 1].value, metric.unit)}).`);
      }
    }
  }
  if (result.suppressedCells) parts.push(`Có ${result.suppressedCells} nhóm dưới 5 người được ẩn để bảo vệ dữ liệu cá nhân.`);
  if (result.stale) parts.push('Lưu ý: dữ liệu nguồn đã quá hạn cập nhật.');
  return parts.join(' ');
}

export interface AssistantRun {
  message: AssistantMessage;
  clarify?: AssistantMessage['clarify'];
}

/** Thực thi trọn vẹn một lượt hỏi; streaming do lớp gọi đảm nhiệm. */
export function answer(db: MockDb, user: MUser, id: number, question: string, clarification?: Record<string, unknown>): AssistantRun {
  const now = new Date(db.clock()).toISOString();
  const p = plan(db, user, question, clarification);
  const base: AssistantMessage = { id, role: 'ASSISTANT', aiGenerated: true, createdAt: now, metricCodes: [], feedback: null };

  if (p.kind === 'refuse') {
    return { message: { ...base, status: 'REFUSED', content: p.text, refusalReason: p.reason } };
  }
  if (p.kind === 'clarify') {
    const clarify = { question: p.question, options: p.options };
    return { message: { ...base, status: 'CLARIFYING', content: p.question, clarify }, clarify };
  }
  try {
    const exec = execute(db, p.query, { scope: db.scopeOf(user), allowUncertified: false });
    const dim = p.query.dimensions?.[0];
    const chartType = !dim ? null : ['term', 'academic_year', 'year'].includes(dim) ? 'LINE' : 'BAR';
    return {
      message: {
        ...base,
        status: 'ANSWERED',
        content: describe(db, user, p.metric, p.query, exec.result),
        metricCodes: [p.metric.code],
        appliedFilters: p.query.filters,
        dataAsOf: exec.result.dataAsOf,
        result: exec.result,
        semanticQuery: p.query,
        sql: exec.sql,
        chart: chartType && dim ? { type: chartType, x: dim, y: [p.metric.code] } : null,
      },
    };
  } catch (error) {
    const text = error instanceof SemanticError ? error.message : 'Không thực thi được truy vấn.';
    return { message: { ...base, status: 'FAILED', content: text } };
  }
}
