"""Access, Dashboards, Semantic."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Response
from fastapi.responses import Response as RawResponse

from app.api.v1.deps import ANALYST, STEWARD, AnyUser, Db, Gateway
from app.core.errors import not_found
from app.core.pagination import PageParams, page_params
from app.core.security import require_roles
from app.domain.enums import AccessRequestStatus, MetricStatus, RoleCode
from app.domain.models import ExportJob
from app.integrations.storage import get_storage, verify_signature
from app.schemas.bi import (
    AccessDecision,
    AccessRequestInput,
    AccessRequestOut,
    DashboardInput,
    DashboardOut,
    DashboardSummary,
    DashboardTopic,
    DimensionOut,
    ExportJobOut,
    ExportRequest,
    MetricCertification,
    MetricDetail,
    MetricInput,
    MetricOut,
    MetricValidation,
    Share,
)
from app.schemas.common import Page, QueryResult, SemanticQuery
from app.services import access_requests, dashboards, exports, semantic
from app.worker_dispatch import dispatch_export

R = RoleCode
router = APIRouter(prefix="/api/v1")
EXPORTERS = Depends(require_roles(R.REPORT_VIEWER, R.BI_ANALYST, R.DATA_STEWARD))


# ───────────────────────── Access ─────────────────────────
@router.get("/access-requests", tags=["Access"], response_model=Page[AccessRequestOut])
def list_access_requests(
    box: str = Query(..., pattern="^(mine|review)$"),
    status: AccessRequestStatus | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    principal=AnyUser,
):
    items, total = access_requests.list_requests(db, principal, box, status, params)
    return Page.of(items, total, params)


@router.post("/access-requests", tags=["Access"], response_model=AccessRequestOut, status_code=201)
def create_access_request(body: AccessRequestInput, db=Db, principal=AnyUser):
    return access_requests.create_request(db, principal, body)


@router.delete("/access-requests/{requestId}", tags=["Access"], status_code=204)
def cancel_access_request(requestId: int, db=Db, principal=AnyUser):  # noqa: N803
    access_requests.cancel_request(db, principal, requestId)
    return Response(status_code=204)


@router.post("/access-requests/{requestId}/decision", tags=["Access"], response_model=AccessRequestOut)
def decide_access_request(requestId: int, body: AccessDecision, db=Db, principal=STEWARD):  # noqa: N803
    return access_requests.decide(db, principal, requestId, body)


@router.delete("/access-grants/{grantId}", tags=["Access"], status_code=204)
def revoke_access_grant(
    grantId: int,  # noqa: N803
    db=Db,
    principal=Depends(require_roles(R.DATA_STEWARD, R.PLATFORM_ADMIN)),
):
    access_requests.revoke_grant(db, principal, grantId)
    return Response(status_code=204)


# ───────────────────────── Dashboards ─────────────────────────
@router.get("/dashboards", tags=["Dashboards"], response_model=list[DashboardSummary])
def list_dashboards(
    q: str | None = None,
    topic: DashboardTopic | None = None,
    favorite: bool | None = None,
    mine: bool | None = None,
    db=Db,
    principal=AnyUser,
):
    return dashboards.list_dashboards(db, principal, q, topic, favorite, mine)


@router.post("/dashboards", tags=["Dashboards"], response_model=DashboardOut, status_code=201)
def create_dashboard(body: DashboardInput, db=Db, principal=ANALYST):
    return dashboards.create_dashboard(db, principal, body)


@router.get("/dashboards/{dashboardId}", tags=["Dashboards"], response_model=DashboardOut)
def get_dashboard(dashboardId: int, response: Response, db=Db, principal=AnyUser):  # noqa: N803
    out = dashboards.get_dashboard(db, principal, dashboardId)
    response.headers["ETag"] = f'"{out.version}"'
    return out


@router.put("/dashboards/{dashboardId}", tags=["Dashboards"], response_model=DashboardOut)
def save_dashboard(
    dashboardId: int,  # noqa: N803
    body: DashboardInput,
    response: Response,
    if_match: str = Header(..., alias="If-Match", description="Giá trị version hiện tại"),
    db=Db,
    principal=ANALYST,
):
    out = dashboards.save_dashboard(db, principal, dashboardId, if_match, body)
    response.headers["ETag"] = f'"{out.version}"'
    return out


@router.post("/dashboards/{dashboardId}/publish", tags=["Dashboards"], response_model=DashboardOut)
def publish_dashboard(dashboardId: int, db=Db, principal=ANALYST):  # noqa: N803
    return dashboards.publish(db, principal, dashboardId)


@router.put("/dashboards/{dashboardId}/shares", tags=["Dashboards"], response_model=list[Share])
def set_dashboard_shares(dashboardId: int, body: list[Share], db=Db, principal=ANALYST):  # noqa: N803
    return dashboards.set_shares(db, principal, dashboardId, body)


@router.put("/dashboards/{dashboardId}/favorite", tags=["Dashboards"], status_code=204)
def favorite_dashboard(dashboardId: int, db=Db, principal=AnyUser):  # noqa: N803
    dashboards.set_favorite(db, principal, dashboardId, True)
    return Response(status_code=204)


@router.delete("/dashboards/{dashboardId}/favorite", tags=["Dashboards"], status_code=204)
def unfavorite_dashboard(dashboardId: int, db=Db, principal=AnyUser):  # noqa: N803
    dashboards.set_favorite(db, principal, dashboardId, False)
    return Response(status_code=204)


@router.post("/dashboards/{dashboardId}/exports", tags=["Dashboards"], response_model=ExportJobOut, status_code=202)
def export_dashboard(
    dashboardId: int,  # noqa: N803
    body: ExportRequest,
    background: BackgroundTasks,
    db=Db,
    gateway=Gateway,
    principal=EXPORTERS,
):
    job = exports.request_export(db, principal, dashboardId, body)
    dispatch_export(job.id, background, gateway)
    return exports.job_out(job)


@router.get("/exports/{exportId}", tags=["Dashboards"], response_model=ExportJobOut)
def get_export(exportId: uuid.UUID, db=Db, principal=AnyUser):  # noqa: N803
    return exports.get_export(db, principal, exportId)


@router.get("/exports/{exportId}/file", tags=["Dashboards"], include_in_schema=False)
def download_export(exportId: uuid.UUID, expires: int, sig: str, db=Db):  # noqa: N803
    # Link tải ký HMAC có hạn (chỉ dùng khi lưu file cục bộ; với MinIO/S3 là presigned URL).
    path = f"/api/v1/exports/{exportId}/file"
    job = db.get(ExportJob, exportId)
    if job is None or not job.storage_uri or not verify_signature(path, expires, sig):
        raise not_found()
    media = "text/csv" if job.format.value == "CSV" else "application/pdf"
    name = f"aiia-export-{job.id}.{job.format.value.lower()}"
    return RawResponse(get_storage().get(job.storage_uri), media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ───────────────────────── Semantic ─────────────────────────
@router.post("/semantic/query", tags=["Semantic"], response_model=QueryResult)
def run_semantic_query(body: SemanticQuery, db=Db, gateway=Gateway, principal=AnyUser):
    return semantic.run_query(db, gateway, principal, body)


@router.get("/semantic/metrics", tags=["Semantic"], response_model=list[MetricOut])
def list_metrics(q: str | None = None, status: MetricStatus | None = None, db=Db, principal=AnyUser):
    return semantic.list_metrics(db, principal, q, status)


@router.post("/semantic/metrics", tags=["Semantic"], response_model=MetricOut, status_code=201)
def create_metric(body: MetricInput, db=Db, principal=ANALYST):
    return semantic.create_metric(db, principal, body)


@router.post("/semantic/metrics/validate", tags=["Semantic"], response_model=MetricValidation)
def validate_metric(body: MetricInput, db=Db, gateway=Gateway, principal=ANALYST):
    return semantic.validate_metric(db, gateway, principal, body)


@router.get("/semantic/metrics/{metricCode}", tags=["Semantic"], response_model=MetricDetail)
def get_metric(metricCode: str, db=Db, principal=AnyUser):  # noqa: N803
    return semantic.get_metric(db, principal, metricCode)


@router.put("/semantic/metrics/{metricCode}", tags=["Semantic"], response_model=MetricOut)
def update_metric(metricCode: str, body: MetricInput, db=Db, principal=ANALYST):  # noqa: N803
    return semantic.update_metric(db, principal, metricCode, body)


@router.post("/semantic/metrics/{metricCode}/certification", tags=["Semantic"], response_model=MetricOut)
def certify_metric(metricCode: str, body: MetricCertification, db=Db, principal=STEWARD):  # noqa: N803
    return semantic.certify(db, principal, metricCode, body.status)


@router.get("/semantic/dimensions", tags=["Semantic"], response_model=list[DimensionOut])
def list_dimensions(db=Db, _=AnyUser):
    return semantic.list_dimensions(db)
