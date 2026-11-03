"""Export dashboard PDF/CSV (US29, BR13): xử lý bất đồng bộ, có watermark, chạy dưới quyền người xuất,
ô nhóm < 5 ghi "< 5", không bao giờ chứa cột RESTRICTED."""

import csv
import io
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.config import settings
from app.core.errors import ProblemError, not_found, unprocessable
from app.core.security import Principal, load_principal
from app.domain.enums import ExportFormat, ExportStatus
from app.domain.models import Dashboard, DashboardWidget, ExportJob, User
from app.integrations.storage import get_storage
from app.query.gateway import LakehouseGateway
from app.schemas.bi import ExportJobOut, ExportRequest
from app.schemas.common import Filter, QueryResult, SemanticQuery
from app.semantic import compiler
from app.services.access import DASHBOARD_ROLES, data_scope
from app.services.dashboards import get_visible

log = logging.getLogger("aiia.exports")


def job_out(job: ExportJob) -> ExportJobOut:
    url = None
    if job.status == ExportStatus.READY and job.storage_uri and job.expires_at and job.expires_at > datetime.now(UTC):
        remaining = job.expires_at - datetime.now(UTC)
        url = get_storage().download_url(job.storage_uri, remaining, f"/api/v1/exports/{job.id}/file")
    return ExportJobOut(
        id=job.id,
        status=job.status.value,
        format=job.format.value,
        download_url=url,
        expires_at=job.expires_at,
        watermark=job.watermark,
        excluded_columns=job.excluded_columns,
    )


def request_export(db: Session, principal: Principal, dashboard_id: int, body: ExportRequest) -> ExportJob:
    dashboard = get_visible(db, principal, dashboard_id)
    if body.format == "CSV":
        if body.widget_id is None:
            raise unprocessable("Export CSV cần chọn widget", [{"field": "widgetId", "message": "Bắt buộc với CSV"}])
        if body.widget_id not in {w.id for w in dashboard.widgets}:
            raise not_found("Widget không thuộc dashboard")
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M")
    job = ExportJob(
        dashboard_id=dashboard.id,
        widget_id=body.widget_id,
        requested_by=principal.id,
        format=ExportFormat(body.format),
        filters=[f.model_dump(by_alias=True) for f in body.filters],
        watermark=f"{principal.email} · {stamp} UTC",
    )
    db.add(job)
    db.flush()
    audit(db, principal, "EXPORT_REQUEST", "DASHBOARD", dashboard.id, {"exportId": str(job.id), "format": body.format})
    db.commit()
    db.refresh(job)
    return job


def get_export(db: Session, principal: Principal, export_id: uuid.UUID) -> ExportJobOut:
    job = db.get(ExportJob, export_id)
    if job is None or job.requested_by != principal.id:
        raise not_found()
    return job_out(job)


def _widget_result(
    db: Session, gateway: LakehouseGateway | None, principal: Principal, widget: DashboardWidget, filters: list[dict[str, Any]]
) -> QueryResult:
    spec = dict(widget.query_spec)
    spec.pop("drillPath", None)
    query = SemanticQuery.model_validate(spec)
    query.filters = [*query.filters, *(Filter.model_validate(f) for f in filters)]
    compiled = compiler.compile_query(db, principal, query, data_scope(db, principal, DASHBOARD_ROLES))
    return compiler.execute(gateway, principal, compiled)


def _cell(value: Any) -> Any:
    return "< 5" if isinstance(value, dict) and value.get("suppressed") else value


def _csv(watermark: str, result: QueryResult) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([f"# {watermark}"])
    writer.writerow([c.name for c in result.columns])
    for row in result.rows:
        writer.writerow([_cell(v) for v in row])
    return ("﻿" + buffer.getvalue()).encode("utf-8")


def _pdf(title: str, watermark: str, sections: list[tuple[str, QueryResult]]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buffer = io.BytesIO()

    def stamp(canvas, doc) -> None:  # noqa: ANN001
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.grey)
        canvas.drawString(30, 20, watermark)
        canvas.restoreState()

    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), title=title)
    styles = getSampleStyleSheet()
    story: list[Any] = [Paragraph(title, styles["Title"])]
    for name, result in sections:
        story += [Paragraph(name, styles["Heading2"]), Spacer(1, 6)]
        data = [[c.name for c in result.columns]] + [[str(_cell(v)) for v in row] for row in result.rows[:500]]
        table = Table(data, repeatRows=1)
        table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey)]))
        story += [table, Spacer(1, 12)]
    doc.build(story, onFirstPage=stamp, onLaterPages=stamp)
    return buffer.getvalue()


def generate(db: Session, gateway: LakehouseGateway | None, export_id: uuid.UUID) -> None:
    """Tạo file export — gọi từ worker (Celery) hoặc tác vụ nền của API."""
    job = db.get(ExportJob, export_id)
    if job is None or job.status != ExportStatus.PENDING:
        return
    user = db.get(User, job.requested_by)
    try:
        # Quyền tính theo người xuất tại thời điểm tạo file (BR11).
        principal = load_principal(db, user, token_key="export")
        dashboard = db.get(Dashboard, job.dashboard_id)
        widgets = [w for w in dashboard.widgets if job.widget_id is None or w.id == job.widget_id]
        sections = [(w.title, _widget_result(db, gateway, principal, w, job.filters)) for w in widgets]
        if job.format == ExportFormat.CSV:
            data, content_type, ext = _csv(job.watermark, sections[0][1]), "text/csv", "csv"
        else:
            data, content_type, ext = _pdf(dashboard.title, job.watermark, sections), "application/pdf", "pdf"
        job.storage_uri = get_storage().put(settings.s3_export_bucket, f"{job.requested_by}/{job.id}.{ext}", data, content_type)
        job.status = ExportStatus.READY
        job.expires_at = datetime.now(UTC) + timedelta(minutes=settings.export_link_ttl_minutes)
        audit(db, principal, "EXPORT", "DASHBOARD", dashboard.id, {"exportId": str(job.id), "format": job.format.value})
    except ProblemError as exc:
        job.status, job.error_message = ExportStatus.FAILED, exc.detail or exc.title
    except Exception as exc:  # noqa: BLE001 — ghi lỗi vào job để người dùng thấy trạng thái FAILED
        log.exception("Export %s thất bại", export_id)
        job.status, job.error_message = ExportStatus.FAILED, exc.__class__.__name__
    db.commit()
