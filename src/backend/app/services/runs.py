"""Lần chạy pipeline.

API chỉ ghi run ở trạng thái QUEUED; Dagster (sensor đọc pipeline_runs) nhận run, chạy
landing → bronze → DQ → silver/gold và cập nhật status, steps, số dòng. Log SSE đọc lại các
cập nhật đó.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.db import get_sessionmaker
from app.core.errors import conflict, not_found, unprocessable
from app.core.pagination import PageParams, paginate
from app.core.security import Principal
from app.domain.enums import RunStatus, RunTrigger, SourceStatus, SourceType
from app.domain.models import DqRule, DqRuleResult, IngestionBatch, PipelineRun, SourceUpload
from app.schemas.sources import PipelineRunDetail, RunDqResult, RunStep, TriggerRunRequest
from app.services.sources import get_source_or_404, run_out

ACTIVE_STATUSES = (RunStatus.QUEUED, RunStatus.RUNNING)
FINAL_STATUSES = (RunStatus.SUCCEEDED, RunStatus.PARTIAL, RunStatus.FAILED)


def list_runs(
    db: Session,
    source_id: int | None,
    status: RunStatus | None,
    from_: datetime | None,
    to: datetime | None,
    params: PageParams,
):
    stmt = select(PipelineRun)
    if source_id:
        stmt = stmt.where(PipelineRun.source_id == source_id)
    if status:
        stmt = stmt.where(PipelineRun.status == status)
    if from_:
        stmt = stmt.where(PipelineRun.queued_at >= from_)
    if to:
        stmt = stmt.where(PipelineRun.queued_at <= to)
    items, total = paginate(db, stmt.order_by(PipelineRun.queued_at.desc()), params)
    return [run_out(r) for r in items], total


def _get_run(db: Session, run_id: uuid.UUID) -> PipelineRun:
    run = db.get(PipelineRun, run_id)
    if run is None:
        raise not_found()
    return run


def _steps(run: PipelineRun) -> list[RunStep]:
    out = []
    for step in run.steps or []:
        try:
            out.append(RunStep.model_validate(step))
        except ValueError:
            continue
    return out


def get_run(db: Session, run_id: uuid.UUID) -> PipelineRunDetail:
    run = _get_run(db, run_id)
    results = db.execute(
        select(DqRuleResult, DqRule)
        .join(DqRule, DqRule.id == DqRuleResult.rule_id)
        .where(DqRuleResult.run_id == run.id)
        .order_by(DqRule.id)
    ).all()
    return PipelineRunDetail(
        **run_out(run).model_dump(),
        steps=_steps(run),
        dq_results=[
            RunDqResult(
                rule_id=rule.id,
                description=rule.description,
                severity=rule.severity.value,
                evaluated=res.evaluated_count,
                failed=res.failed_count,
                status=res.status.value,
            )
            for res, rule in results
        ],
        error_message=run.error_message,
    )


def _ensure_runnable(db: Session, source_id: int) -> None:
    active = db.scalar(
        select(PipelineRun.id).where(PipelineRun.source_id == source_id, PipelineRun.status.in_(ACTIVE_STATUSES)).limit(1)
    )
    if active:
        raise conflict("Nguồn đang có lần chạy chưa kết thúc", type_="run-in-progress")


def trigger_run(db: Session, principal: Principal, source_id: int, body: TriggerRunRequest) -> Any:
    source = get_source_or_404(db, source_id)
    if source.status != SourceStatus.ACTIVE:
        # BR01: chỉ ingest từ nguồn ACTIVE.
        raise conflict("Nguồn chưa ở trạng thái ACTIVE", type_="source-not-active")
    _ensure_runnable(db, source.id)

    batch_id = None
    if body.upload_id is not None:
        upload = db.get(SourceUpload, body.upload_id)
        if upload is None or upload.source_id != source.id:
            raise not_found("Không tìm thấy file đã upload")
        if upload.batch_id is not None:
            raise conflict("File này đã được ingest", type_="upload-consumed")
        duplicate = db.scalar(
            select(IngestionBatch.id).where(
                IngestionBatch.source_id == source.id, IngestionBatch.checksum_sha256 == upload.checksum_sha256
            ).limit(1)
        )
        if duplicate and not body.confirm_duplicate:
            # AC05: file trùng checksum chỉ ingest khi người dùng xác nhận.
            raise conflict(f"File trùng với lô #{duplicate}; gửi confirmDuplicate=true để vẫn ingest", type_="duplicate-file")
        batch = IngestionBatch(
            source_id=source.id,
            file_name=upload.file_name,
            checksum_sha256=upload.checksum_sha256,
            row_count=upload.row_count,
            bronze_path=upload.storage_uri,
            uploaded_by=upload.uploaded_by,
        )
        db.add(batch)
        db.flush()
        upload.batch_id = batch.id
        batch_id = batch.id
    elif source.type == SourceType.FILE:
        raise unprocessable("Nguồn FILE cần uploadId của file đã upload", [{"field": "uploadId", "message": "Bắt buộc"}])

    run = PipelineRun(source_id=source.id, batch_id=batch_id, trigger=RunTrigger.MANUAL, triggered_by=principal.id)
    db.add(run)
    db.flush()
    audit(db, principal, "RUN_TRIGGER", "SOURCE", source.id, {"runId": str(run.id), "batchId": batch_id})
    db.commit()
    db.refresh(run)
    return run_out(run)


def rerun(db: Session, principal: Principal, run_id: uuid.UUID, mode: str) -> Any:
    parent = _get_run(db, run_id)
    if parent.status not in FINAL_STATUSES:
        raise conflict("Lần chạy chưa kết thúc", type_="run-in-progress")
    if parent.source.status != SourceStatus.ACTIVE:
        raise conflict("Nguồn chưa ở trạng thái ACTIVE", type_="source-not-active")
    if mode == "REPROCESS_QUARANTINE" and parent.rows_quarantined == 0:
        raise conflict("Lần chạy không có bản ghi quarantine để xử lý lại", type_="nothing-to-reprocess")
    _ensure_runnable(db, parent.source_id)
    # BR14: chạy lại cùng batch, Silver/Gold MERGE theo khóa nên không sinh bản ghi trùng.
    run = PipelineRun(
        source_id=parent.source_id,
        batch_id=parent.batch_id,
        parent_run_id=parent.id,
        trigger=RunTrigger.REPROCESS if mode == "REPROCESS_QUARANTINE" else RunTrigger.RERUN,
        triggered_by=principal.id,
    )
    db.add(run)
    db.flush()
    audit(db, principal, "RUN_RERUN", "SOURCE", parent.source_id, {"runId": str(run.id), "parentRunId": str(parent.id), "mode": mode})
    db.commit()
    db.refresh(run)
    return run_out(run)


# ───────────────────────── Log SSE ─────────────────────────
def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _snapshot(run_id: uuid.UUID) -> tuple[dict[str, Any], list[dict[str, Any]], bool] | None:
    with get_sessionmaker()() as db:
        run = db.get(PipelineRun, run_id)
        if run is None:
            return None
        lines: list[dict[str, Any]] = []
        for step in run.steps or []:
            for entry in step.get("logs", []):
                lines.append({"step": step.get("name"), **entry})
            if not step.get("logs"):
                lines.append({"ts": step.get("startedAt"), "level": "INFO", "step": step.get("name"), "message": f"{step.get('name')}: {step.get('status')}"})
        if run.error_message:
            lines.append({"ts": run.finished_at, "level": "ERROR", "step": None, "message": run.error_message})
        return run_out(run).model_dump(mode="json", by_alias=True), lines, run.status in FINAL_STATUSES


async def stream_run_logs(run_id: uuid.UUID, poll_seconds: float = 2.0, max_seconds: float = 900) -> AsyncIterator[str]:
    sent = 0
    last_status: dict[str, Any] | None = None
    waited = 0.0
    while waited <= max_seconds:
        snap = await run_in_threadpool(_snapshot, run_id)
        if snap is None:
            yield sse("end", {"reason": "not-found"})
            return
        status, lines, finished = snap
        for line in lines[sent:]:
            yield sse("log", line)
        sent = len(lines)
        if status != last_status:
            yield sse("status", status)
            last_status = status
        if finished:
            yield sse("end", {"status": status["status"]})
            return
        await asyncio.sleep(poll_seconds)
        waited += poll_seconds
        if int(waited) % 15 == 0:
            yield ": keep-alive\n\n"
    yield sse("end", {"reason": "timeout"})
