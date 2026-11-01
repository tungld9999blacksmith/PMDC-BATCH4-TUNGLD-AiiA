import uuid
from datetime import datetime

from fastapi import APIRouter, Body, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse

from app.api.v1.deps import DATA_OPS, ENGINEER, SOURCE_READERS, Db
from app.core.pagination import PageParams, page_params
from app.core.security import require_roles
from app.domain.enums import RoleCode, RunStatus, SourceStatus, SourceType
from app.schemas.common import Page
from app.schemas.sources import (
    ConnectionTestRequest,
    ConnectionTestResult,
    DataSourceInput,
    DataSourceOut,
    DataSourcePatch,
    MappingPreview,
    PipelineRunDetail,
    PipelineRunOut,
    RerunRequest,
    Schedule,
    ScheduleOut,
    SchemaMappingInput,
    SchemaMappingOut,
    TriggerRunRequest,
    UploadResult,
)
from app.services import runs, sources

router = APIRouter(prefix="/api/v1", tags=["Sources"])
runs_router = APIRouter(prefix="/api/v1", tags=["Runs"])
MAPPING_READERS = Depends(require_roles(RoleCode.DATA_ENGINEER, RoleCode.DATA_STEWARD))


@router.get("/sources", response_model=Page[DataSourceOut], summary="Danh sách nguồn dữ liệu")
def list_sources(
    q: str | None = None,
    type: SourceType | None = None,  # noqa: A002
    status: SourceStatus | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    _=SOURCE_READERS,
):
    items, total = sources.list_sources(db, q, type, status, params)
    return Page.of(items, total, params)


@router.post("/sources", response_model=DataSourceOut, status_code=201, summary="Đăng ký nguồn (US04) — trạng thái DRAFT")
def create_source(body: DataSourceInput, db=Db, principal=ENGINEER):
    return sources.create_source(db, principal, body)


@router.get("/sources/{sourceId}", response_model=DataSourceOut, summary="Chi tiết nguồn")
def get_source(sourceId: int, db=Db, _=SOURCE_READERS):  # noqa: N803
    return sources.source_out(db, sources.get_source_or_404(db, sourceId))


@router.patch("/sources/{sourceId}", response_model=DataSourceOut, summary="Cập nhật nguồn, kích hoạt/tạm dừng")
def update_source(sourceId: int, body: DataSourcePatch, db=Db, principal=ENGINEER):  # noqa: N803
    return sources.update_source(db, principal, sourceId, body)


@router.post("/sources/{sourceId}/connection-test", response_model=ConnectionTestResult, summary="Kiểm tra kết nối JDBC/API")
def test_source_connection(sourceId: int, body: ConnectionTestRequest | None = Body(None), db=Db, principal=ENGINEER):  # noqa: N803
    return sources.test_connection(db, principal, sourceId, body.secret if body else None)


@router.post("/sources/{sourceId}/uploads", response_model=UploadResult, status_code=201, summary="Upload CSV/XLSX, kiểm tra và xem trước (US05)")
async def upload_source_file(sourceId: int, file: UploadFile = File(...), db=Db, principal=ENGINEER):  # noqa: N803
    return await sources.upload_file(db, principal, sourceId, file)


@router.put("/sources/{sourceId}/schedule", response_model=ScheduleOut, summary="Lập lịch ingest (US06)")
def set_source_schedule(sourceId: int, body: Schedule, db=Db, principal=ENGINEER):  # noqa: N803
    return sources.set_schedule(db, principal, sourceId, body)


@router.get("/sources/{sourceId}/mappings", response_model=list[SchemaMappingOut], summary="Các phiên bản ánh xạ schema (US08)")
def list_mappings(sourceId: int, db=Db, _=MAPPING_READERS):  # noqa: N803
    return sources.list_mappings(db, sourceId)


@router.post("/sources/{sourceId}/mappings", response_model=SchemaMappingOut, status_code=201, summary="Lưu phiên bản mapping mới và kích hoạt")
def create_mapping_version(sourceId: int, body: SchemaMappingInput, db=Db, principal=ENGINEER):  # noqa: N803
    return sources.create_mapping(db, principal, sourceId, body)


@router.post("/sources/{sourceId}/mappings/preview", response_model=MappingPreview, summary="Xem trước kết quả mapping (AC08, AC32)")
def preview_mapping(sourceId: int, body: SchemaMappingInput, db=Db, _=ENGINEER):  # noqa: N803
    return sources.preview_mapping(db, sourceId, body)


@runs_router.post("/sources/{sourceId}/runs", response_model=PipelineRunOut, status_code=202, summary="Chạy ingest ngay")
def trigger_run(sourceId: int, body: TriggerRunRequest | None = Body(None), db=Db, principal=ENGINEER):  # noqa: N803
    return runs.trigger_run(db, principal, sourceId, body or TriggerRunRequest())


@runs_router.get("/runs", response_model=Page[PipelineRunOut], summary="Danh sách lần chạy (US07)")
def list_runs(
    sourceId: int | None = None,  # noqa: N803
    status: RunStatus | None = None,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    _=SOURCE_READERS,
):
    items, total = runs.list_runs(db, sourceId, status, from_, to, params)
    return Page.of(items, total, params)


@runs_router.get("/runs/{runId}", response_model=PipelineRunDetail, summary="Chi tiết lần chạy, các bước và kết quả DQ")
def get_run(runId: uuid.UUID, db=Db, _=SOURCE_READERS):  # noqa: N803
    return runs.get_run(db, runId)


@runs_router.get("/runs/{runId}/logs", summary="Log lần chạy theo thời gian thực (SSE)", response_class=StreamingResponse)
def stream_run_logs(runId: uuid.UUID, db=Db, _=SOURCE_READERS):  # noqa: N803
    runs.get_run(db, runId)  # 404 trước khi mở luồng
    return StreamingResponse(
        runs.stream_run_logs(runId),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@runs_router.post("/runs/{runId}/rerun", response_model=PipelineRunOut, status_code=202, summary="Chạy lại (BR14) hoặc xử lý lại quarantine")
def rerun_run(runId: uuid.UUID, body: RerunRequest | None = Body(None), db=Db, principal=DATA_OPS):  # noqa: N803
    return runs.rerun(db, principal, runId, (body or RerunRequest()).mode)
