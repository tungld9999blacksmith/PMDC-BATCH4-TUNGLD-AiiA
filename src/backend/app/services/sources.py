"""Nguồn dữ liệu: đăng ký (BR01), kiểm tra kết nối, upload (US05), lịch (US06), ánh xạ schema (US08)."""

import csv
import hashlib
import io
import time
from datetime import UTC, datetime
from typing import Any

import httpx
import psycopg
from croniter import croniter
from fastapi import UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.config import settings
from app.core.errors import ProblemError, conflict, not_found, unprocessable
from app.core.pagination import PageParams, paginate
from app.core.security import Principal
from app.domain.enums import DqRuleStatus, DqRuleType, LineageNodeType, SourceStatus, SourceType
from app.domain.models import (
    DataSource,
    Dataset,
    DatasetColumn,
    DqRule,
    IngestionBatch,
    PipelineRun,
    SchemaMapping,
    SourceUpload,
)
from app.integrations.secrets import get_secret_store
from app.integrations.storage import get_storage
from app.schemas.common import TabularColumn, TabularResult, UserRef
from app.schemas.sources import (
    ConnectionTestResult,
    DataSourceInput,
    DataSourceOut,
    DataSourcePatch,
    MappingError,
    MappingPreview,
    MappingRule,
    PipelineRunOut,
    Schedule,
    ScheduleOut,
    SchemaMappingInput,
    SchemaMappingOut,
    UploadResult,
)
from app.semantic.validator import validate_expression

PREVIEW_ROWS = 20

# Chuyển trạng thái nguồn hợp lệ.
SOURCE_TRANSITIONS: dict[SourceStatus, set[SourceStatus]] = {
    SourceStatus.DRAFT: {SourceStatus.ACTIVE, SourceStatus.ARCHIVED},
    SourceStatus.ACTIVE: {SourceStatus.PAUSED, SourceStatus.ARCHIVED},
    SourceStatus.PAUSED: {SourceStatus.ACTIVE, SourceStatus.ARCHIVED},
    SourceStatus.ARCHIVED: set(),
}


def run_out(run: PipelineRun) -> PipelineRunOut:
    return PipelineRunOut(
        id=run.id,
        source_id=run.source_id,
        source_code=run.source.code,
        trigger=run.trigger,
        status=run.status,
        rows_read=run.rows_read,
        rows_written=run.rows_written,
        rows_quarantined=run.rows_quarantined,
        queued_at=run.queued_at,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


def source_out(db: Session, source: DataSource) -> DataSourceOut:
    last_run = db.scalar(
        select(PipelineRun).where(PipelineRun.source_id == source.id).order_by(PipelineRun.queued_at.desc()).limit(1)
    )
    return DataSourceOut(
        id=source.id,
        code=source.code,
        name=source.name,
        type=source.type,
        business_owner=source.business_owner,
        purpose=source.purpose,
        legal_basis_ref=source.legal_basis_ref,
        legal_doc_uri=source.legal_doc_uri,
        sensitivity=source.sensitivity,
        subject_types=source.subject_types,
        connection_config=source.connection_config,
        file_template=source.file_template,
        status=source.status,
        owner=UserRef.of(source.owner),
        has_secret=source.secret_ref is not None,
        schedule=Schedule(cron=source.schedule_cron, paused=source.schedule_paused) if source.schedule_cron else None,
        last_run=run_out(last_run) if last_run else None,
    )


def get_source_or_404(db: Session, source_id: int) -> DataSource:
    source = db.get(DataSource, source_id)
    if source is None:
        raise not_found()
    return source


def list_sources(db: Session, q: str | None, type_: SourceType | None, status: SourceStatus | None, params: PageParams):
    stmt = select(DataSource)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(DataSource.code.ilike(like), DataSource.name.ilike(like)))
    if type_:
        stmt = stmt.where(DataSource.type == type_)
    if status:
        stmt = stmt.where(DataSource.status == status)
    items, total = paginate(db, stmt.order_by(DataSource.code), params)
    return [source_out(db, s) for s in items], total


def _secret_values(config: dict[str, Any]) -> list[str]:
    suspicious = {"password", "passwd", "secret", "token", "apikey", "api_key", "accesskey", "privatekey"}
    return [k for k in config if k.lower().replace("-", "").replace("_", "") in {s.replace("_", "") for s in suspicious}]


def create_source(db: Session, principal: Principal, body: DataSourceInput) -> DataSourceOut:
    if db.scalar(select(DataSource.id).where(DataSource.code == body.code)):
        raise conflict(f"Mã nguồn {body.code} đã tồn tại", type_="duplicate")
    if body.type == SourceType.FILE and not (body.file_template and body.file_template.required_columns):
        raise unprocessable(
            "Nguồn FILE cần template cột bắt buộc",
            [{"field": "fileTemplate.requiredColumns", "message": "Bắt buộc với nguồn FILE"}],
        )
    if leaked := _secret_values(body.connection_config):
        raise unprocessable(
            "connectionConfig không được chứa bí mật — dùng kiểm tra kết nối để lưu vào secret store",
            [{"field": f"connectionConfig.{k}", "message": "Không lưu bí mật trong cấu hình"} for k in leaked],
        )
    source = DataSource(
        code=body.code,
        name=body.name,
        type=body.type,
        status=SourceStatus.DRAFT,
        owner_user_id=principal.id,
        business_owner=body.business_owner,
        purpose=body.purpose,
        legal_basis_ref=body.legal_basis_ref,
        legal_doc_uri=str(body.legal_doc_uri) if body.legal_doc_uri else None,
        sensitivity=body.sensitivity,
        subject_types=body.subject_types,
        connection_config=body.connection_config,
        file_template=body.file_template.model_dump(by_alias=True) if body.file_template else None,
    )
    db.add(source)
    db.flush()
    audit(db, principal, "SOURCE_CREATE", "SOURCE", source.id, {"code": source.code})
    db.commit()
    return source_out(db, source)


def update_source(db: Session, principal: Principal, source_id: int, body: DataSourcePatch) -> DataSourceOut:
    source = get_source_or_404(db, source_id)
    if source.status == SourceStatus.ARCHIVED:
        raise conflict("Nguồn đã lưu trữ, không sửa được")
    data = body.model_dump(exclude_unset=True)
    if "connection_config" in data and (leaked := _secret_values(data["connection_config"] or {})):
        raise unprocessable(
            "connectionConfig không được chứa bí mật",
            [{"field": f"connectionConfig.{k}", "message": "Không lưu bí mật trong cấu hình"} for k in leaked],
        )
    new_status = data.pop("status", None)
    for field, value in data.items():
        if value is not None:
            setattr(source, field, value)
    if "connection_config" in data:
        # Đổi cấu hình kết nối thì phải kiểm tra lại trước khi kích hoạt.
        source.connection_tested_at = None
    if new_status is not None and new_status != source.status:
        if new_status not in SOURCE_TRANSITIONS[source.status]:
            raise conflict(f"Không chuyển được nguồn từ {source.status} sang {new_status}", type_="invalid-transition")
        if new_status == SourceStatus.ACTIVE:
            _check_activation(source)
        source.status = new_status
    audit(db, principal, "SOURCE_UPDATE", "SOURCE", source.id, {k: str(v) for k, v in body.model_dump(exclude_unset=True).items()})
    db.commit()
    db.refresh(source)
    return source_out(db, source)


def _check_activation(source: DataSource) -> None:
    # BR01 + AC04.
    errors = []
    if not source.purpose.strip() or not source.legal_basis_ref.strip():
        errors.append({"field": "purpose", "message": "Thiếu mục đích hoặc căn cứ cho phép"})
    if source.type == SourceType.FILE:
        if not (source.file_template or {}).get("requiredColumns"):
            errors.append({"field": "fileTemplate", "message": "Nguồn FILE cần template cột"})
    else:
        if source.secret_ref is None:
            errors.append({"field": "secret", "message": "Chưa lưu thông tin xác thực kết nối"})
        if source.connection_tested_at is None:
            errors.append({"field": "status", "message": "Chưa kiểm tra kết nối thành công (AC04)"})
    if errors:
        raise unprocessable("Nguồn chưa đủ điều kiện kích hoạt", errors, type_="source-not-ready")


# ───────────────────────── Kiểm tra kết nối ─────────────────────────
def test_connection(db: Session, principal: Principal, source_id: int, secret: str | None) -> ConnectionTestResult:
    source = get_source_or_404(db, source_id)
    if source.type == SourceType.FILE:
        return ConnectionTestResult(ok=True, latency_ms=0, message="Nguồn FILE không cần kết nối", discovered_tables=[])
    store = get_secret_store()
    password = secret if secret is not None else (store.get(source.secret_ref) if source.secret_ref else None)
    started = time.perf_counter()
    try:
        tables = _probe_jdbc(source, password) if source.type == SourceType.JDBC else _probe_api(source, password)
        ok, message = True, "Kết nối thành công"
    except Exception as exc:  # noqa: BLE001 — trả lỗi kết nối cho người dùng, không ném 500
        tables, ok, message = [], False, f"Kết nối thất bại: {_safe_error(exc, password)}"
    latency = int((time.perf_counter() - started) * 1000)
    if ok:
        if secret is not None:
            source.secret_ref = store.put(f"source-{source.code.lower()}", secret)
        source.connection_tested_at = datetime.now(UTC)
    audit(db, principal, "SOURCE_CONNECTION_TEST", "SOURCE", source.id, {"ok": ok, "latencyMs": latency})
    db.commit()
    return ConnectionTestResult(ok=ok, latency_ms=latency, message=message, discovered_tables=tables)


def _safe_error(exc: Exception, secret: str | None) -> str:
    text = str(exc).splitlines()[0][:300] if str(exc) else exc.__class__.__name__
    return text.replace(secret, "***") if secret else text


def _probe_jdbc(source: DataSource, password: str | None) -> list[str]:
    cfg = source.connection_config
    url = cfg.get("url", "")
    if url and not url.startswith(("jdbc:postgresql://", "postgresql://")):
        raise ValueError("Hiện chỉ hỗ trợ kiểm tra JDBC PostgreSQL")
    conninfo = url.removeprefix("jdbc:") if url else None
    kwargs = {
        "host": cfg.get("host"),
        "port": cfg.get("port", 5432),
        "dbname": cfg.get("database"),
        "user": cfg.get("user") or cfg.get("username"),
        "password": password,
        "connect_timeout": 5,
    }
    with psycopg.connect(conninfo or "", **{k: v for k, v in kwargs.items() if v is not None}) as conn:
        rows = conn.execute(
            "SELECT table_schema || '.' || table_name FROM information_schema.tables "
            "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1 LIMIT 200"
        ).fetchall()
    return [r[0] for r in rows]


def _probe_api(source: DataSource, token: str | None) -> list[str]:
    cfg = source.connection_config
    base = cfg.get("baseUrl") or cfg.get("url")
    if not base:
        raise ValueError("connectionConfig.baseUrl chưa khai báo")
    url = base.rstrip("/") + "/" + str(cfg.get("healthPath", "")).lstrip("/")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = httpx.get(url, headers=headers, timeout=5)
    response.raise_for_status()
    return list(cfg.get("endpoints", []))


# ───────────────────────── Upload ─────────────────────────
def _parse_table(name: str, data: bytes) -> tuple[list[str], list[list[Any]]]:
    lower = name.lower()
    if lower.endswith(".xlsx"):
        from openpyxl import load_workbook

        sheet = load_workbook(io.BytesIO(data), read_only=True, data_only=True).active
        rows = [list(r) for r in sheet.iter_rows(values_only=True)]
        rows = [r for r in rows if any(v is not None for v in r)]
    elif lower.endswith(".csv"):
        text = data.decode("utf-8-sig")
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in r)]
    else:
        raise unprocessable("Chỉ nhận file CSV hoặc XLSX", type_="unsupported-format")
    if not rows:
        raise unprocessable("File không có dữ liệu", type_="empty-file")
    header = [str(h).strip() if h is not None else "" for h in rows[0]]
    return header, rows[1:]


async def upload_file(db: Session, principal: Principal, source_id: int, file: UploadFile) -> UploadResult:
    source = get_source_or_404(db, source_id)
    if source.type != SourceType.FILE:
        raise unprocessable("Chỉ nguồn loại FILE mới upload được", type_="not-file-source")
    data = await file.read(settings.upload_max_bytes + 1)
    if len(data) > settings.upload_max_bytes:
        raise ProblemError(413, "File quá lớn", "File vượt 50 MB", type_="file-too-large")
    name = (file.filename or "upload.csv").replace("\\", "/").rsplit("/", 1)[-1][:255]
    try:
        header, rows = _parse_table(name, data)
    except UnicodeDecodeError as exc:
        raise unprocessable("File CSV phải mã hóa UTF-8", type_="encoding") from exc
    except ProblemError:
        raise
    except Exception as exc:  # noqa: BLE001 — file hỏng
        raise unprocessable(f"Không đọc được file: {exc.__class__.__name__}", type_="unreadable-file") from exc

    required = (source.file_template or {}).get("requiredColumns", [])
    missing = [c for c in required if c not in header]
    if missing:
        raise unprocessable(
            "Header không khớp template",
            [{"field": c, "message": "Thiếu cột bắt buộc"} for c in missing],
            type_="header-mismatch",
        )

    checksum = hashlib.sha256(data).hexdigest()
    duplicate = db.scalar(
        select(IngestionBatch.id)
        .where(IngestionBatch.source_id == source.id, IngestionBatch.checksum_sha256 == checksum)
        .order_by(IngestionBatch.id.desc())
        .limit(1)
    )
    upload = SourceUpload(
        source_id=source.id,
        file_name=name,
        checksum_sha256=checksum,
        size_bytes=len(data),
        row_count=len(rows),
        storage_uri="",
        uploaded_by=principal.id,
    )
    db.add(upload)
    db.flush()
    content_type = file.content_type or "application/octet-stream"
    upload.storage_uri = get_storage().put(
        settings.s3_upload_bucket, f"uploads/{source.code}/{upload.id}/{name}", data, content_type
    )
    audit(db, principal, "SOURCE_UPLOAD", "SOURCE", source.id, {"uploadId": str(upload.id), "file": name, "rows": len(rows)})
    db.commit()
    preview = TabularResult(
        columns=[TabularColumn(name=h, type="string") for h in header],
        rows=[[_cell(v) for v in r[: len(header)]] for r in rows[:PREVIEW_ROWS]],
    )
    return UploadResult(
        upload_id=upload.id,
        file_name=name,
        row_count=len(rows),
        checksum_sha256=checksum,
        duplicate_of_batch_id=duplicate,
        preview=preview,
    )


def _cell(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


# ───────────────────────── Lịch ─────────────────────────
def next_run(cron: str, paused: bool) -> datetime | None:
    return None if paused else croniter(cron, datetime.now(UTC)).get_next(datetime)


def set_schedule(db: Session, principal: Principal, source_id: int, body: Schedule) -> ScheduleOut:
    source = get_source_or_404(db, source_id)
    if source.status == SourceStatus.ARCHIVED:
        raise conflict("Nguồn đã lưu trữ")
    if not croniter.is_valid(body.cron) or len(body.cron.split()) != 5:
        raise unprocessable("Biểu thức cron không hợp lệ (5 trường)", [{"field": "cron", "message": "Sai cú pháp cron"}])
    source.schedule_cron = body.cron
    source.schedule_paused = body.paused
    audit(db, principal, "SOURCE_SCHEDULE", "SOURCE", source.id, {"cron": body.cron, "paused": body.paused})
    db.commit()
    return ScheduleOut(cron=body.cron, paused=body.paused, next_run_at=next_run(body.cron, body.paused))


# ───────────────────────── Ánh xạ schema ─────────────────────────
def mapping_out(m: SchemaMapping) -> SchemaMappingOut:
    return SchemaMappingOut(
        id=m.id,
        target_dataset_id=m.target_dataset_id,
        rules=[MappingRule.model_validate(r) for r in m.mapping],
        version=m.version,
        active=m.is_active,
        created_by=UserRef.of(m.creator),
        created_at=m.created_at,
    )


def list_mappings(db: Session, source_id: int) -> list[SchemaMappingOut]:
    get_source_or_404(db, source_id)
    rows = db.scalars(
        select(SchemaMapping)
        .where(SchemaMapping.source_id == source_id)
        .order_by(SchemaMapping.target_dataset_id, SchemaMapping.version.desc())
    ).all()
    return [mapping_out(m) for m in rows]


def _source_columns(db: Session, source: DataSource) -> set[str]:
    columns = set((source.file_template or {}).get("requiredColumns", []))
    last_upload = db.scalar(
        select(SourceUpload).where(SourceUpload.source_id == source.id).order_by(SourceUpload.created_at.desc()).limit(1)
    )
    if last_upload is not None:
        try:
            header, _ = _parse_table(last_upload.file_name, get_storage().get(last_upload.storage_uri))
            columns |= set(header)
        except Exception:  # noqa: BLE001 — thiếu file mẫu thì chỉ dựa vào template
            pass
    return columns


def _validate_mapping(db: Session, source: DataSource, body: SchemaMappingInput) -> tuple[Dataset, list[MappingError]]:
    dataset = db.get(Dataset, body.target_dataset_id)
    if dataset is None:
        raise unprocessable("Dataset đích không tồn tại", [{"field": "targetDatasetId", "message": "Không tồn tại"}])
    target_columns = {c.name for c in dataset.columns}
    source_columns = _source_columns(db, source)
    errors: list[MappingError] = []
    seen: set[str] = set()
    for rule in body.rules:
        if rule.target_column not in target_columns:
            errors.append(MappingError(target_column=rule.target_column, message="Cột đích không có trong dataset"))
        if rule.target_column in seen:
            errors.append(MappingError(target_column=rule.target_column, message="Cột đích được ánh xạ nhiều lần"))
        seen.add(rule.target_column)
        if rule.source_column and source_columns and rule.source_column not in source_columns:
            errors.append(MappingError(target_column=rule.target_column, message=f"Cột nguồn {rule.source_column} không tồn tại"))
        if rule.transform:
            for msg in validate_expression(rule.transform, source_columns or {rule.source_column or ""}, allow_aggregates=False):
                errors.append(MappingError(target_column=rule.target_column, message=msg))
        if not rule.source_column and not rule.transform:
            errors.append(MappingError(target_column=rule.target_column, message="Cần cột nguồn hoặc phép biến đổi"))
    # Cột đích có quy tắc NOT_NULL đang hoạt động là trường bắt buộc.
    required = db.scalars(
        select(DatasetColumn.name)
        .join(DqRule, DqRule.column_id == DatasetColumn.id)
        .where(
            DqRule.dataset_id == dataset.id,
            DqRule.rule_type == DqRuleType.NOT_NULL,
            DqRule.status == DqRuleStatus.ACTIVE,
        )
    ).all()
    for column in sorted(set(required) - seen):
        errors.append(MappingError(target_column=column, message="Thiếu ánh xạ cho trường bắt buộc"))
    return dataset, errors


def create_mapping(db: Session, principal: Principal, source_id: int, body: SchemaMappingInput) -> SchemaMappingOut:
    source = get_source_or_404(db, source_id)
    dataset, errors = _validate_mapping(db, source, body)
    if errors:
        raise unprocessable(
            "Mapping không hợp lệ", [{"field": e.target_column, "message": e.message} for e in errors], type_="invalid-mapping"
        )
    version = (
        db.scalar(
            select(func.max(SchemaMapping.version)).where(
                SchemaMapping.source_id == source.id, SchemaMapping.target_dataset_id == dataset.id
            )
        )
        or 0
    ) + 1
    db.query(SchemaMapping).filter(
        SchemaMapping.source_id == source.id, SchemaMapping.target_dataset_id == dataset.id, SchemaMapping.is_active
    ).update({SchemaMapping.is_active: False})
    db.flush()
    mapping = SchemaMapping(
        source_id=source.id,
        target_dataset_id=dataset.id,
        version=version,
        mapping=[r.model_dump(by_alias=True) for r in body.rules],
        is_active=True,
        created_by=principal.id,
    )
    db.add(mapping)
    db.flush()
    audit(db, principal, "MAPPING_VERSION_CREATE", "SOURCE", source.id, {"datasetId": dataset.id, "version": version})
    db.commit()
    db.refresh(mapping)
    return mapping_out(mapping)


_SIMPLE_TRANSFORMS = {"trim": str.strip, "upper": str.upper, "lower": str.lower}


def preview_mapping(db: Session, source_id: int, body: SchemaMappingInput) -> MappingPreview:
    from app.services.lineage import impacted_nodes

    source = get_source_or_404(db, source_id)
    dataset, errors = _validate_mapping(db, source, body)
    preview = TabularResult(columns=[TabularColumn(name=r.target_column, type="string") for r in body.rules])
    last_upload = db.scalar(
        select(SourceUpload).where(SourceUpload.source_id == source.id).order_by(SourceUpload.created_at.desc()).limit(1)
    )
    if last_upload is not None and not errors:
        header, rows = _parse_table(last_upload.file_name, get_storage().get(last_upload.storage_uri))
        index = {h: i for i, h in enumerate(header)}
        for row in rows[:PREVIEW_ROWS]:
            preview.rows.append([_apply_rule(rule, row, index) for rule in body.rules])
    impacted = impacted_nodes(db, LineageNodeType.DATASET, str(dataset.id))
    return MappingPreview(valid=not errors, errors=errors, preview=preview, impacted=impacted)


def _apply_rule(rule: MappingRule, row: list[Any], index: dict[str, int]) -> Any:
    value = row[index[rule.source_column]] if rule.source_column in index and index[rule.source_column] < len(row) else None
    if not rule.transform:
        return _cell(value)
    expr = rule.transform.strip().lower()
    for name, fn in _SIMPLE_TRANSFORMS.items():
        if expr == f"{name}({(rule.source_column or '').lower()})" and isinstance(value, str):
            return fn(value)
    # Phép biến đổi phức tạp được Trino tính khi chạy pipeline; preview hiển thị giá trị gốc.
    return _cell(value)
