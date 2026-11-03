import type { DataSourceInput, DataSourcePatch, PipelineRunDetail, RunStatus, SchemaMappingInput } from '../../api/models';
import type { MockDb } from '../db';
import { runOf, sourceOf } from '../mappers';
import { MockRouter, body, iso, noContent, ok, paginate, problem, requireRole, type MockRequest } from '../router';
import type { MRun, MUpload } from '../types';

const MAX_UPLOAD = 50 * 1024 * 1024;
const CRON_FIELD = /^(\*|\d+|\d+-\d+|\*\/\d+|[\d,]+|[A-Z]{3})$/;

function validCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => CRON_FIELD.test(p));
}

function nextRun(cron: string, now: number): string {
  const [min, hour] = cron.split(/\s+/);
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(/^\d+$/.test(min) ? Number(min) : 0);
  d.setHours(/^\d+$/.test(hour) ? Number(hour) : d.getHours() + 1);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Môi trường không có SubtleCrypto: băm đơn giản đủ để phát hiện trùng trong demo.
  let h = 0;
  for (const b of new Uint8Array(buffer)) h = (h * 31 + b) >>> 0;
  return h.toString(16).padStart(64, '0');
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const split = (l: string) => l.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
  return { header: lines.length ? split(lines[0]) : [], rows: lines.slice(1).map(split) };
}

function sourceFor(req: MockRequest) {
  return req.db.sources.find((s) => s.id === Number(req.params['sourceId']));
}

/** Kiểm tra mapping: mọi cột bắt buộc của dataset đích phải được ánh xạ (AC08.1). */
function mappingErrors(db: MockDb, input: SchemaMappingInput): { targetColumn: string; message: string }[] {
  const ds = db.dataset(input.targetDatasetId);
  if (!ds) return [{ targetColumn: '-', message: 'Dataset đích không tồn tại' }];
  const mapped = new Set((input.rules ?? []).filter((r) => r.sourceColumn || r.transform).map((r) => r.targetColumn));
  return ds.columns.filter((c) => c.required && !mapped.has(c.name)).map((c) => ({ targetColumn: c.name, message: 'Thiếu ánh xạ cho trường bắt buộc' }));
}

function downstream(db: MockDb, datasetId: number) {
  const start = db.lineageNodes.find((n) => n.type === 'DATASET' && n.refId === String(datasetId));
  if (!start) return [];
  const seen = new Set<number>([start.id]);
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift() as number;
    for (const e of db.lineageEdges.filter((x) => x.from === id)) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  seen.delete(start.id);
  return db.lineageNodes.filter((n) => seen.has(n.id)).map((n) => ({ id: n.id, type: n.type, refId: n.refId, name: n.name, layer: n.layer }));
}

function runDetail(db: MockDb, run: MRun): PipelineRunDetail {
  const summary = runOf(db, run);
  const elapsed = db.clock() - run.queuedAt;
  const stepNames = ['BRONZE', 'DQ', 'SILVER', 'GOLD'] as const;
  const stepLen = (run.durationMs - 1500) / 4;
  const steps = stepNames.map((name, i) => {
    const start = run.queuedAt + 1500 + i * stepLen;
    const end = start + stepLen;
    let status: RunStatus = 'QUEUED';
    if (elapsed >= end - run.queuedAt) status = 'SUCCEEDED';
    else if (elapsed >= start - run.queuedAt) status = 'RUNNING';
    if (summary.status === 'FAILED' && name !== 'BRONZE') status = i === 1 ? 'FAILED' : 'QUEUED';
    if (summary.status === 'PARTIAL' && name === 'DQ') status = 'PARTIAL';
    return { name, status, startedAt: status === 'QUEUED' ? undefined : iso(start), finishedAt: status === 'SUCCEEDED' || status === 'PARTIAL' ? iso(end) : undefined };
  });
  const source = db.sources.find((s) => s.id === run.sourceId);
  const bronze = db.datasets.find((d) => d.layer === 'BRONZE' && d.sourceCode === source?.code);
  const done = summary.status !== 'QUEUED' && summary.status !== 'RUNNING';
  const dqResults = done
    ? db.rules
        .filter((r) => r.status === 'ACTIVE' && (r.datasetId === bronze?.id || r.datasetId === source?.targetDatasetId))
        .map((r) => {
          const failed = summary.status === 'PARTIAL' && r.severity === 'BLOCKING' && r.ruleType === 'RANGE' ? run.rowsQuarantined : 0;
          return { ruleId: r.id, description: r.description, severity: r.severity, evaluated: run.rowsRead, failed, status: failed ? ('FAIL' as const) : ('PASS' as const) };
        })
    : [];
  return { ...summary, steps, dqResults, errorMessage: summary.status === 'FAILED' ? run.errorMessage : null };
}

export function registerIntegration(router: MockRouter): void {
  router
    .add('GET', '/sources', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER', 'DATA_STEWARD', 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, query } = req;
      const q = (query.get('q') ?? '').toLowerCase();
      const items = db.sources
        .filter((s) => !q || `${s.code} ${s.name} ${s.businessOwner}`.toLowerCase().includes(q))
        .filter((s) => !query.get('type') || s.type === query.get('type'))
        .filter((s) => !query.get('status') || s.status === query.get('status'))
        .map((s) => sourceOf(db, s));
      return ok(paginate(items, query));
    })
    .add('POST', '/sources', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER');
      if (denied) return denied;
      const { db, user } = req;
      const input = body<DataSourceInput>(req);
      const errors: { field: string; message: string }[] = [];
      if (!/^SRC-[A-Z0-9]{2,20}$/.test(input.code ?? '')) errors.push({ field: 'code', message: 'Mã nguồn có dạng SRC-XXX (chữ hoa, số)' });
      if (!input.name?.trim()) errors.push({ field: 'name', message: 'Bắt buộc' });
      if (!input.businessOwner?.trim()) errors.push({ field: 'businessOwner', message: 'Bắt buộc' });
      if ((input.purpose ?? '').trim().length < 10) errors.push({ field: 'purpose', message: 'Mục đích sử dụng tối thiểu 10 ký tự (BR01)' });
      if ((input.legalBasisRef ?? '').trim().length < 3) errors.push({ field: 'legalBasisRef', message: 'Căn cứ cho phép là bắt buộc (BR01)' });
      if (!input.subjectTypes?.length) errors.push({ field: 'subjectTypes', message: 'Chọn ít nhất một đối tượng dữ liệu' });
      if (input.type === 'FILE' && !input.fileTemplate?.requiredColumns?.length) errors.push({ field: 'fileTemplate', message: 'Nguồn FILE cần danh sách cột bắt buộc' });
      if (errors.length) return problem(422, 'Dữ liệu không hợp lệ', undefined, { errors });
      if (db.sources.some((s) => s.code === input.code)) return problem(409, 'Mã nguồn đã tồn tại');
      const id = Math.max(...db.sources.map((s) => s.id)) + 1;
      const source = {
        id,
        code: input.code,
        name: input.name,
        type: input.type,
        status: 'DRAFT' as const,
        ownerId: user.id,
        businessOwner: input.businessOwner,
        purpose: input.purpose,
        legalBasisRef: input.legalBasisRef,
        legalDocUri: input.legalDocUri,
        sensitivity: input.sensitivity,
        subjectTypes: input.subjectTypes,
        connectionConfig: input.connectionConfig ?? {},
        fileTemplate: input.fileTemplate?.requiredColumns ? { requiredColumns: input.fileTemplate.requiredColumns } : undefined,
        hasSecret: false,
        connectionTested: input.type === 'FILE',
        schedule: null,
        targetDatasetId: db.datasetByName('silver.silver_sis_students')?.id ?? 1,
      };
      db.sources.push(source);
      db.audit(user.id, 'SOURCE_CREATE', 'SOURCE', String(id));
      return ok(sourceOf(db, source), 201);
    })
    .add('GET', '/sources/:sourceId', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER', 'DATA_STEWARD', 'PLATFORM_ADMIN');
      if (denied) return denied;
      const s = sourceFor(req);
      return s ? ok(sourceOf(req.db, s)) : problem(404, 'Không tìm thấy nguồn');
    })
    .add('PATCH', '/sources/:sourceId', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER');
      if (denied) return denied;
      const s = sourceFor(req);
      if (!s) return problem(404, 'Không tìm thấy nguồn');
      const patch = body<DataSourcePatch>(req);
      if (patch.purpose !== undefined && patch.purpose.trim().length < 10) {
        return problem(422, 'Dữ liệu không hợp lệ', undefined, { errors: [{ field: 'purpose', message: 'Tối thiểu 10 ký tự' }] });
      }
      if (patch.status === 'ACTIVE' && s.status !== 'ACTIVE') {
        if (!s.connectionTested) return problem(409, 'Chưa kiểm tra kết nối', 'Cần kiểm tra kết nối thành công trước khi kích hoạt nguồn (AC04.2).');
        if (s.type !== 'FILE' && !s.hasSecret) return problem(409, 'Thiếu bí mật kết nối', 'Nhập mật khẩu hoặc token ở bước kiểm tra kết nối.');
      }
      Object.assign(s, {
        name: patch.name ?? s.name,
        businessOwner: patch.businessOwner ?? s.businessOwner,
        purpose: patch.purpose ?? s.purpose,
        legalBasisRef: patch.legalBasisRef ?? s.legalBasisRef,
        sensitivity: patch.sensitivity ?? s.sensitivity,
        connectionConfig: patch.connectionConfig ?? s.connectionConfig,
        fileTemplate: (patch.fileTemplate as { requiredColumns: string[] } | undefined) ?? s.fileTemplate,
        status: patch.status ?? s.status,
      });
      if (patch.connectionConfig) s.connectionTested = s.type === 'FILE';
      req.db.audit(req.user.id, 'SOURCE_UPDATE', 'SOURCE', String(s.id), 'ALLOW', { status: s.status });
      return ok(sourceOf(req.db, s));
    })
    .add('POST', '/sources/:sourceId/connection-test', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER');
      if (denied) return denied;
      const s = sourceFor(req);
      if (!s) return problem(404, 'Không tìm thấy nguồn');
      const secret = body<{ secret?: string }>(req).secret;
      if (secret) s.hasSecret = true;
      const cfg = s.connectionConfig;
      const okConn = s.type === 'FILE' || (!!(cfg['host'] || cfg['baseUrl']) && s.hasSecret);
      s.connectionTested = okConn;
      return ok({
        ok: okConn,
        latencyMs: okConn ? 38 : 0,
        message: okConn ? 'Kết nối thành công' : s.hasSecret ? 'Thiếu host hoặc baseUrl trong cấu hình kết nối' : 'Thiếu mật khẩu hoặc token',
        discoveredTables: okConn && s.type !== 'FILE' ? ['students', 'enrollments', 'courses', 'terms'] : [],
      });
    })
    .add('POST', '/sources/:sourceId/uploads', async (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER');
      if (denied) return denied;
      const { db } = req;
      const s = sourceFor(req);
      if (!s) return problem(404, 'Không tìm thấy nguồn');
      const file = req.body instanceof FormData ? req.body.get('file') : null;
      if (!(file instanceof File)) return problem(422, 'Thiếu file', undefined, { errors: [{ field: 'file', message: 'Chọn file CSV hoặc XLSX' }] });
      if (file.size > MAX_UPLOAD) return problem(413, 'File vượt 50 MB', `Kích thước ${(file.size / 1048576).toFixed(1)} MB.`);
      const name = file.name.toLowerCase();
      if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) return problem(422, 'Sai định dạng', 'Chỉ nhận CSV hoặc XLSX.');
      const buffer = await file.arrayBuffer();
      const checksum = await sha256(buffer);
      const required = s.fileTemplate?.requiredColumns ?? [];
      let header: string[];
      let rows: string[][];
      if (name.endsWith('.csv')) {
        ({ header, rows } = parseCsv(new TextDecoder().decode(buffer)));
      } else {
        // Mock không đọc nhị phân XLSX: coi như header khớp template và sinh dòng xem trước mẫu.
        header = required;
        rows = Array.from({ length: 25 }, (_, i) => required.map((c) => `${c}_${i + 1}`));
      }
      const missing = required.filter((c) => !header.includes(c));
      if (missing.length) {
        return problem(422, 'Header không khớp template', `Thiếu ${missing.length} cột bắt buộc.`, { errors: missing.map((field) => ({ field, message: 'Thiếu cột bắt buộc' })) });
      }
      const duplicate = db.batches.find((b) => b.sourceId === s.id && b.checksum === checksum);
      const upload: MUpload = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
        sourceId: s.id,
        fileName: file.name,
        rowCount: rows.length,
        checksum,
        columns: header,
        rows,
        duplicateOfBatchId: duplicate?.id ?? null,
      };
      db.uploads.push(upload);
      return ok(
        {
          uploadId: upload.id,
          fileName: upload.fileName,
          rowCount: upload.rowCount,
          checksumSha256: checksum,
          duplicateOfBatchId: upload.duplicateOfBatchId,
          preview: { columns: header.map((c) => ({ name: c, type: 'varchar', masked: false })), rows: rows.slice(0, 20) },
        },
        201,
      );
    })
    .add('PUT', '/sources/:sourceId/schedule', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER');
      if (denied) return denied;
      const s = sourceFor(req);
      if (!s) return problem(404, 'Không tìm thấy nguồn');
      const input = body<{ cron?: string; paused?: boolean }>(req);
      if (!input.cron || !validCron(input.cron)) {
        return problem(422, 'Cron không hợp lệ', 'Cần 5 trường: phút giờ ngày tháng thứ (VD 0 2 * * *).', { errors: [{ field: 'cron', message: 'Sai cú pháp' }] });
      }
      s.schedule = { cron: input.cron, paused: !!input.paused };
      req.db.audit(req.user.id, 'SCHEDULE_UPDATE', 'SOURCE', String(s.id));
      return ok({ ...s.schedule, nextRunAt: s.schedule.paused ? null : nextRun(input.cron, req.db.clock()) });
    })
    .add('GET', '/sources/:sourceId/mappings', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER', 'DATA_STEWARD');
      if (denied) return denied;
      const { db } = req;
      return ok(
        db.mappings
          .filter((m) => m.sourceId === Number(req.params['sourceId']))
          .sort((a, b) => b.version - a.version)
          .map((m) => ({ id: m.id, targetDatasetId: m.targetDatasetId, rules: m.rules, version: m.version, active: m.active, createdBy: db.userRef(m.createdById), createdAt: m.createdAt })),
      );
    })
    .add('POST', '/sources/:sourceId/mappings', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER');
      if (denied) return denied;
      const { db, user } = req;
      const s = sourceFor(req);
      if (!s) return problem(404, 'Không tìm thấy nguồn');
      const input = body<SchemaMappingInput>(req);
      const errors = mappingErrors(db, input);
      if (errors.length) return problem(422, 'Mapping chưa đầy đủ', undefined, { errors: errors.map((e) => ({ field: e.targetColumn, message: e.message })) });
      const existing = db.mappings.filter((m) => m.sourceId === s.id && m.targetDatasetId === input.targetDatasetId);
      existing.forEach((m) => (m.active = false));
      const mapping = {
        id: db.nextId('mapping', 10),
        sourceId: s.id,
        targetDatasetId: input.targetDatasetId,
        version: Math.max(0, ...existing.map((m) => m.version)) + 1,
        active: true,
        rules: (input.rules ?? []).map((r) => ({ sourceColumn: r.sourceColumn ?? null, targetColumn: r.targetColumn, transform: r.transform ?? null })),
        createdById: user.id,
        createdAt: new Date(db.clock()).toISOString(),
      };
      db.mappings.push(mapping);
      db.audit(user.id, 'MAPPING_VERSION', 'SOURCE', String(s.id), 'ALLOW', { version: mapping.version });
      return ok({ ...mapping, createdBy: db.userRef(user.id) }, 201);
    })
    .add('POST', '/sources/:sourceId/mappings/preview', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER');
      if (denied) return denied;
      const { db } = req;
      const input = body<SchemaMappingInput>(req);
      const errors = mappingErrors(db, input);
      const students = db.persons.filter((p) => p.student).slice(0, 5);
      const pick = (col: string, i: number): unknown => {
        const p = students[i];
        const s = p.student!;
        const map: Record<string, unknown> = { student_id: s.code, full_name: p.fullName, date_of_birth: '••/••/••••', email: p.email, phone: '••••', faculty_code: s.faculty, program_code: s.program, cohort: s.cohort, status: s.status, national_id_hash: '••••', updated_at: p.updatedAt, term_code: s.terms[0]?.term, amount_due: s.tuition[0]?.due, amount_paid: s.tuition[0]?.paid, scholarship_amount: s.tuition[0]?.scholarship };
        return map[col] ?? '—';
      };
      const targets = (input.rules ?? []).map((r) => r.targetColumn);
      return ok({
        valid: errors.length === 0,
        errors,
        preview: { columns: targets.map((t) => ({ name: t, type: 'varchar', masked: ['date_of_birth', 'national_id_hash', 'phone'].includes(t) })), rows: students.map((_, i) => targets.map((t) => pick(t, i))) },
        impacted: downstream(db, input.targetDatasetId),
      });
    })
    .add('POST', '/sources/:sourceId/runs', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER');
      if (denied) return denied;
      const { db, user } = req;
      const s = sourceFor(req);
      if (!s) return problem(404, 'Không tìm thấy nguồn');
      if (s.status !== 'ACTIVE') return problem(409, 'Nguồn chưa hoạt động', 'Chỉ nguồn ACTIVE mới được ingest (BR01).');
      if (db.runs.some((r) => r.sourceId === s.id && ['QUEUED', 'RUNNING'].includes(db.runStatus(r)))) return problem(409, 'Đang có lần chạy', 'Chờ lần chạy hiện tại kết thúc.');
      const input = body<{ uploadId?: string; confirmDuplicate?: boolean }>(req);
      const upload = input.uploadId ? db.uploads.find((u) => u.id === input.uploadId) : undefined;
      if (input.uploadId && !upload) return problem(404, 'Không tìm thấy file đã upload');
      if (upload?.duplicateOfBatchId && !input.confirmDuplicate) {
        return problem(409, 'File trùng checksum', `File giống hệt lô #${upload.duplicateOfBatchId} đã ingest. Xác nhận nếu vẫn muốn chạy lại (AC05.3).`);
      }
      let quarantined = 0;
      if (upload) {
        const idx = upload.columns.indexOf('so_tien_da_nop');
        quarantined = idx >= 0 ? upload.rows.filter((r) => Number((r as string[])[idx]) < 0).length : 0;
      }
      const read = upload ? upload.rowCount : 2000 + Math.round((db.clock() / 1000) % 3000);
      const run: MRun = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
        sourceId: s.id,
        trigger: 'MANUAL',
        queuedAt: db.clock(),
        durationMs: 11_000,
        outcome: quarantined ? 'PARTIAL' : 'SUCCEEDED',
        rowsRead: read,
        rowsWritten: read - quarantined,
        rowsQuarantined: quarantined,
        errorMessage: null,
        parentRunId: null,
        uploadId: upload?.id ?? null,
      };
      db.runs.push(run);
      if (upload) db.batches.push({ id: db.nextId('batch', 200), sourceId: s.id, checksum: upload.checksum, runId: run.id });
      const target = db.dataset(s.targetDatasetId);
      if (target) target.lastUpdatedAt = run.queuedAt + run.durationMs;
      if (quarantined) {
        const rule = db.rules.find((r) => r.ruleType === 'RANGE' && db.dataset(r.datasetId)?.sourceCode === s.code);
        if (rule) {
          const open = db.issues.find((i) => i.ruleId === rule.id && (i.status === 'OPEN' || i.status === 'IN_PROGRESS'));
          if (open) {
            open.lastRunId = run.id;
            open.affectedRows = quarantined;
          } else {
            db.issues.push({ id: db.nextId('issue', 100), ruleId: rule.id, datasetId: rule.datasetId, affectedRows: quarantined, severity: rule.severity, status: 'OPEN', assigneeId: null, lastRunId: run.id, createdAt: new Date(db.clock()).toISOString(), comments: [] });
          }
        }
      }
      db.audit(user.id, 'RUN_TRIGGER', 'SOURCE', String(s.id), 'ALLOW', { runId: run.id });
      return ok(runOf(db, run), 202);
    })
    .add('GET', '/runs', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER', 'DATA_STEWARD', 'PLATFORM_ADMIN');
      if (denied) return denied;
      const { db, query } = req;
      const from = query.get('from');
      const to = query.get('to');
      const items = db.runs
        .filter((r) => !query.get('sourceId') || r.sourceId === Number(query.get('sourceId')))
        .filter((r) => !query.get('status') || db.runStatus(r) === query.get('status'))
        .filter((r) => !from || r.queuedAt >= Date.parse(from))
        .filter((r) => !to || r.queuedAt <= Date.parse(to))
        .sort((a, b) => b.queuedAt - a.queuedAt)
        .map((r) => runOf(db, r));
      return ok(paginate(items, query));
    })
    .add('GET', '/runs/:runId', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER', 'DATA_STEWARD', 'PLATFORM_ADMIN');
      if (denied) return denied;
      const run = req.db.runs.find((r) => r.id === req.params['runId']);
      return run ? ok(runDetail(req.db, run)) : problem(404, 'Không tìm thấy lần chạy');
    })
    .add('POST', '/runs/:runId/rerun', (req) => {
      const denied = requireRole(req, 'DATA_ENGINEER', 'DATA_STEWARD');
      if (denied) return denied;
      const { db, user } = req;
      const parent = db.runs.find((r) => r.id === req.params['runId']);
      if (!parent) return problem(404, 'Không tìm thấy lần chạy');
      const s = db.sources.find((x) => x.id === parent.sourceId);
      if (s?.status !== 'ACTIVE') return problem(409, 'Nguồn chưa hoạt động');
      if (db.runs.some((r) => r.sourceId === parent.sourceId && ['QUEUED', 'RUNNING'].includes(db.runStatus(r)))) return problem(409, 'Đang có lần chạy');
      const mode = body<{ mode?: string }>(req).mode === 'REPROCESS_QUARANTINE' ? 'REPROCESS' : 'RERUN';
      const run: MRun = {
        ...parent,
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
        trigger: mode,
        queuedAt: db.clock(),
        durationMs: 9_000,
        outcome: 'SUCCEEDED',
        // Idempotent (BR14): chạy lại không ghi thêm dòng mới vào Silver.
        rowsRead: mode === 'REPROCESS' ? parent.rowsQuarantined : parent.rowsRead,
        rowsWritten: mode === 'REPROCESS' ? parent.rowsQuarantined : 0,
        rowsQuarantined: 0,
        errorMessage: null,
        parentRunId: parent.id,
      };
      db.runs.push(run);
      if (mode === 'REPROCESS') {
        for (const issue of db.issues.filter((i) => i.lastRunId === parent.id && (i.status === 'OPEN' || i.status === 'IN_PROGRESS'))) {
          issue.status = 'RESOLVED';
          issue.lastRunId = run.id;
          issue.comments.push({ id: db.nextId('comment', 50), authorId: user.id, body: 'Đã xử lý lại quarantine sau khi sửa dữ liệu.', createdAt: new Date(db.clock()).toISOString() });
        }
      }
      db.audit(user.id, mode === 'REPROCESS' ? 'RUN_REPROCESS' : 'RUN_RERUN', 'RUN', parent.id);
      return ok(runOf(db, run), 202);
    });
}

export const _test = { validCron, parseCsv, noContent };
