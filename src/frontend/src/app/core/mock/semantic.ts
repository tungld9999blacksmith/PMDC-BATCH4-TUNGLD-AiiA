/**
 * Semantic engine của mock: thực thi SemanticQuery trên bảng fact tổng hợp, áp phạm vi đơn vị
 * (tương đương row filter của Trino/OPA) và ẩn nhóm < 5 người (BR12).
 */
import type { Filter, QueryResult, SemanticQuery } from '../api/models';
import type { MockDb } from './db';
import { TERMS } from './seed-people';
import type { FactBase, MMetric } from './types';

export const SUPPRESSION_K = 5;

type Row = Record<string, string | number | boolean>;

export const DIMENSIONS: Record<string, { name: string; description: string; bases: FactBase[] }> = {
  academic_year: { name: 'Năm học', description: 'Năm học, VD 2025-2026', bases: ['student', 'lecturer'] },
  term: { name: 'Học kỳ', description: 'Mã học kỳ, VD 2025-2026-HK1', bases: ['student', 'lecturer'] },
  faculty: { name: 'Khoa', description: 'Mã khoa', bases: ['student', 'lecturer', 'research'] },
  program: { name: 'Ngành', description: 'Mã ngành đào tạo', bases: ['student'] },
  cohort: { name: 'Khóa', description: 'Khóa tuyển sinh, VD K66', bases: ['student'] },
  status: { name: 'Trạng thái', description: 'Trạng thái học tập', bases: ['student'] },
  year: { name: 'Năm', description: 'Năm công bố, nghiệm thu', bases: ['research'] },
  level: { name: 'Cấp', description: 'Cấp công bố, đề tài', bases: ['research'] },
  dataset: { name: 'Dataset', description: 'Tên dataset', bases: ['dq'] },
  dq_dimension: { name: 'Chiều chất lượng', description: 'Đầy đủ, duy nhất, hợp lệ, nhất quán, kịp thời', bases: ['dq'] },
  date: { name: 'Ngày', description: 'Ngày đánh giá', bases: ['dq'] },
};

const BASE_FIELDS: Record<FactBase, string[]> = {
  student: ['person_id', 'gpa', 'warning', 'dropped', 'unpaid', 'conduct', 'credits'],
  lecturer: ['person_id', 'hours', 'sections', 'eval_score'],
  research: ['person_id', 'publication', 'project'],
  dq: ['score'],
};

const BASE_TABLE: Record<FactBase, string> = {
  student: 'iceberg.gold.mart_student_term_kpi',
  lecturer: 'iceberg.gold.fact_teaching_load',
  research: 'iceberg.gold.fact_research_output',
  dq: 'iceberg.gold.mart_dq_daily',
};

export function baseOfMetric(db: MockDb, metric: MMetric): FactBase {
  const table = db.dataset(metric.baseDatasetId)?.tableName;
  if (table === 'fact_teaching_load' || table === 'dim_lecturer') return 'lecturer';
  if (table === 'fact_research_output') return 'research';
  if (table === 'mart_dq_daily') return 'dq';
  return 'student';
}

// ── Biểu thức tổng hợp: count_distinct(f) | count(*) | avg(f) | sum(f) | min(f) | max(f) | rate(f) ──
const EXPR = /^\s*(count_distinct|count|avg|sum|min|max|rate)\(\s*(\*|[a-z_]+)\s*\)\s*$/;

export function validateExpression(expression: string, base: FactBase): string[] {
  const m = EXPR.exec(expression);
  if (!m) return ['Biểu thức phải có dạng hàm(trường): count_distinct, count, avg, sum, min, max, rate.'];
  const [, fn, field] = m;
  if (field === '*' && fn !== 'count') return ['Chỉ count(*) được dùng với *.'];
  if (field !== '*' && !BASE_FIELDS[base].includes(field)) {
    return [`Trường "${field}" không có trong dataset nền. Trường hợp lệ: ${BASE_FIELDS[base].join(', ')}.`];
  }
  return [];
}

function aggregate(expression: string, rows: Row[]): number | null {
  const m = EXPR.exec(expression);
  if (!m || rows.length === 0) return null;
  const [, fn, field] = m;
  const values = field === '*' ? [] : rows.map((r) => Number(r[field]));
  switch (fn) {
    case 'count':
      return rows.length;
    case 'count_distinct':
      return new Set(rows.map((r) => r[field])).size;
    case 'sum':
      return round(values.reduce((a, b) => a + b, 0));
    case 'avg':
      return round(values.reduce((a, b) => a + b, 0) / values.length);
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'rate':
      return round((rows.filter((r) => r[field] === true || r[field] === 1).length * 100) / rows.length);
    default:
      return null;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Bảng fact theo nền, sinh từ dữ liệu người. */
export function facts(db: MockDb, base: FactBase): Row[] {
  const rows: Row[] = [];
  if (base === 'student') {
    for (const p of db.persons) {
      const s = p.student;
      if (!s) continue;
      s.terms.forEach((t, i) => {
        const tuition = s.tuition.find((x) => x.term === t.term);
        rows.push({
          person_id: p.id,
          academic_year: t.year,
          term: t.term,
          faculty: s.faculty,
          program: s.program,
          cohort: s.cohort,
          status: s.status,
          gpa: t.gpa,
          warning: t.warning > 0,
          dropped: s.status === 'DROPPED' && i === s.terms.length - 1,
          unpaid: tuition ? tuition.status !== 'PAID' : false,
          conduct: t.conduct,
          credits: t.credits,
        });
      });
    }
  } else if (base === 'lecturer') {
    for (const p of db.persons) {
      const l = p.lecturer;
      if (!l) continue;
      for (const term of TERMS) {
        const items = l.teaching.filter((x) => x.term === term.code);
        if (!items.length) continue;
        const evals = l.evaluations.filter((x) => x.term === term.code);
        const responses = evals.reduce((a, e) => a + e.responses, 0);
        rows.push({
          person_id: p.id,
          academic_year: term.year,
          term: term.code,
          faculty: l.faculty,
          hours: items.reduce((a, x) => a + x.hours, 0),
          sections: items.reduce((a, x) => a + x.sections, 0),
          eval_score: responses ? round(evals.reduce((a, e) => a + e.score * e.responses, 0) / responses) : 0,
        });
      }
    }
  } else if (base === 'research') {
    for (const p of db.persons) {
      const l = p.lecturer;
      if (!l) continue;
      for (const r of l.research) {
        rows.push({
          person_id: p.id,
          year: String(r.year),
          faculty: l.faculty,
          level: r.level,
          publication: r.type === 'PUBLICATION' ? 1 : 0,
          project: r.type === 'PROJECT' ? 1 : 0,
        });
      }
    }
  } else {
    for (const rule of db.rules.filter((r) => r.status === 'ACTIVE')) {
      const ds = db.dataset(rule.datasetId);
      if (!ds) continue;
      for (let d = 29; d >= 0; d--) {
        const date = new Date(db.seededAt - d * 86_400_000).toISOString().slice(0, 10);
        const base_ = rule.lastPassRate ?? 100;
        const wobble = ((rule.id * 7 + d * 13) % 10) / 10;
        rows.push({
          dataset: `${ds.schemaName}.${ds.tableName}`,
          dq_dimension: rule.dimension,
          date,
          score: Math.max(0, Math.min(100, round(base_ + (base_ < 100 ? wobble - 0.5 : 0)))),
        });
      }
    }
  }
  return rows;
}

function matchesFilter(row: Row, filter: Filter): boolean {
  const value = row[filter.dimension];
  const target = filter.value;
  const list = (filter.values ?? (Array.isArray(target) ? target : [])) as unknown[];
  switch (filter.op) {
    case 'eq':
      return String(value) === String(target);
    case 'neq':
      return String(value) !== String(target);
    case 'in':
      return list.map(String).includes(String(value));
    case 'gte':
      return String(value) >= String(target);
    case 'lte':
      return String(value) <= String(target);
    case 'between':
      return list.length === 2 && String(value) >= String(list[0]) && String(value) <= String(list[1]);
    default:
      return true;
  }
}

export class SemanticError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ExecutionContext {
  /** Phạm vi đơn vị của người gọi; null = toàn trường. */
  scope: string[] | null;
  /** Cho phép dùng metric chưa chứng nhận (dashboard nháp, builder). Trợ lý luôn false. */
  allowUncertified: boolean;
}

export interface Execution {
  result: QueryResult;
  sql: string;
  base: FactBase;
  metrics: MMetric[];
}

export function execute(db: MockDb, query: SemanticQuery, ctx: ExecutionContext): Execution {
  const codes = query.metrics ?? [];
  if (!codes.length) throw new SemanticError(422, 'Cần ít nhất một metric.');
  const metrics = codes.map((code) => {
    const m = db.metrics.find((x) => x.code === code);
    if (!m) throw new SemanticError(422, `Metric "${code}" không tồn tại.`);
    if (m.status === 'DEPRECATED') throw new SemanticError(422, `Metric "${m.name}" đã ngừng dùng.`);
    if (!ctx.allowUncertified && m.status !== 'CERTIFIED') throw new SemanticError(422, `Metric "${m.name}" chưa được chứng nhận.`);
    return m;
  });
  const base = baseOfMetric(db, metrics[0]);
  if (metrics.some((m) => baseOfMetric(db, m) !== base)) {
    throw new SemanticError(422, 'Các metric trong một truy vấn phải cùng dataset nền.');
  }
  const dims = query.dimensions ?? [];
  const filters = query.filters ?? [];
  for (const d of [...dims, ...filters.map((f) => f.dimension)]) {
    if (!DIMENSIONS[d]?.bases.includes(base)) throw new SemanticError(422, `Dimension "${d}" không dùng được với metric đã chọn.`);
  }

  let rows = facts(db, base);
  // Row filter theo phạm vi đơn vị (BR08, BR11)
  if (ctx.scope && base !== 'dq') rows = rows.filter((r) => ctx.scope!.includes(String(r['faculty'])));
  rows = rows.filter((r) => filters.every((f) => matchesFilter(r, f)));

  const groups = new Map<string, { keys: string[]; rows: Row[] }>();
  for (const r of rows) {
    const keys = dims.map((d) => String(r[d]));
    const id = keys.join('\u0001');
    const g = groups.get(id) ?? { keys, rows: [] };
    g.rows.push(r);
    groups.set(id, g);
  }
  if (!dims.length && !groups.size) groups.set('', { keys: [], rows: [] });

  let suppressedCells = 0;
  let out = [...groups.values()].map((g) => {
    const people = base === 'dq' ? Infinity : new Set(g.rows.map((r) => r['person_id'])).size;
    const values = metrics.map((m) => {
      if (people < SUPPRESSION_K) {
        suppressedCells++;
        return { suppressed: true };
      }
      return aggregate(m.expression, g.rows);
    });
    return [...g.keys, ...values] as unknown[];
  });

  const order = query.orderBy?.length ? query.orderBy : dims.map((d) => ({ field: d, direction: 'asc' as const }));
  const headers = [...dims, ...metrics.map((m) => m.code)];
  out.sort((a, b) => {
    for (const o of order) {
      const i = headers.indexOf(o.field ?? '');
      if (i < 0) continue;
      const av = a[i];
      const bv = b[i];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      if (cmp) return o.direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  out = out.slice(0, query.limit ?? 500);

  const freshest = Math.max(...metrics.map((m) => db.dataset(m.baseDatasetId)?.lastUpdatedAt ?? db.seededAt));
  const sla = Math.min(...metrics.map((m) => db.dataset(m.baseDatasetId)?.freshnessSlaMinutes ?? 1e9));
  const result: QueryResult = {
    columns: [
      ...dims.map((d) => ({ name: d, kind: 'DIMENSION' as const, unit: null })),
      ...metrics.map((m) => ({ name: m.code, kind: 'METRIC' as const, unit: m.unit })),
    ],
    rows: out,
    dataAsOf: new Date(freshest).toISOString(),
    stale: db.clock() - freshest > sla * 60_000,
    suppressedCells,
  };
  return { result, sql: compileSql(base, dims, metrics, filters, ctx.scope, query.limit ?? 500), base, metrics };
}

/** SQL Trino tương đương, hiển thị ở “Xem truy vấn”. */
export function compileSql(base: FactBase, dims: string[], metrics: MMetric[], filters: Filter[], scope: string[] | null, limit: number): string {
  const col = (d: string) => (d === 'faculty' ? 'faculty_code' : d === 'program' ? 'program_code' : d === 'term' ? 'term_code' : d);
  const select = [
    ...dims.map((d) => `    ${col(d)} AS ${d}`),
    ...metrics.map((m) => `    ${m.expression} AS ${m.code}`),
    ...(base === 'dq' ? [] : ['    count(DISTINCT person_id) AS _group_size']),
  ];
  const where = filters.map((f) => {
    const v = f.op === 'in' || f.op === 'between' ? (f.values ?? []).map((x) => `'${x}'`).join(', ') : `'${f.value}'`;
    const op = { eq: '=', neq: '<>', gte: '>=', lte: '<=', in: 'IN', between: 'BETWEEN' }[f.op];
    return f.op === 'in' ? `${col(f.dimension)} IN (${v})` : f.op === 'between' ? `${col(f.dimension)} BETWEEN ${v.replace(', ', ' AND ')}` : `${col(f.dimension)} ${op} ${v}`;
  });
  const lines = [`SELECT\n${select.join(',\n')}`, `FROM ${BASE_TABLE[base]}`];
  if (where.length) lines.push(`WHERE ${where.join('\n  AND ')}`);
  if (dims.length) lines.push(`GROUP BY ${dims.map((_, i) => i + 1).join(', ')}`);
  lines.push(`LIMIT ${limit}`);
  const note = scope && base !== 'dq'
    ? `-- Trino áp row filter theo người gọi: faculty_code IN (${scope.map((s) => `'${s}'`).join(', ')})\n`
    : '';
  return `${note}-- Nhóm có _group_size < ${SUPPRESSION_K} được thay bằng {"suppressed": true}\n${lines.join('\n')}`;
}
