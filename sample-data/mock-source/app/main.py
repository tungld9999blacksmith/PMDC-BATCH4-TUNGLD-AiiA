"""Mock source: một server cung cấp API và CSDL giả lập cho các hệ thống nguồn của trường.

Hệ thống nguồn                 Bảng Postgres        Endpoint
SIS (quản lý đào tạo)          sis_students         GET /api/v1/sis/students
                               sis_enrollments      GET /api/v1/sis/enrollments
HRM (nhân sự)                  hrm_staff            GET /api/v1/hrm/staff
FIN (tài chính, học phí)       fin_tuition          GET /api/v1/fin/tuition
LMS (học tập trực tuyến)       lms_activity         GET /api/v1/lms/activity

Mọi endpoint hỗ trợ updated_since (ISO 8601), limit (1–500), offset.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel

from app import db
from app.config import settings
from app.generator import generate
from app.repository import PgRepository, Repository

ROUTES: dict[tuple[str, str], str] = {
    ("sis", "students"): "sis_students",
    ("sis", "enrollments"): "sis_enrollments",
    ("hrm", "staff"): "hrm_staff",
    ("fin", "tuition"): "fin_tuition",
    ("lms", "activity"): "lms_activity",
}

_state: dict[str, Repository] = {}


class Page(BaseModel):
    items: list[dict[str, Any]]
    total: int
    next_offset: int | None


def _wait_for_database(url: str, attempts: int = 30) -> None:
    import time

    for _ in range(attempts):
        try:
            psycopg.connect(url, connect_timeout=2).close()
            return
        except psycopg.OperationalError:
            time.sleep(1)
    raise RuntimeError("Không kết nối được CSDL nguồn giả lập")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.database_url:
        _wait_for_database(settings.database_url)
        with psycopg.connect(settings.database_url) as conn:
            db.init_schema(conn)
            if db.is_empty(conn):
                db.seed(conn, generate(settings.seed, settings.students, settings.staff))
        _state["repo"] = PgRepository(settings.database_url)
    yield


app = FastAPI(
    title="AiiA Mock Source",
    version="0.1.0",
    description="Nguồn dữ liệu giả lập (dữ liệu tổng hợp) cho AiiA.",
    lifespan=lifespan,
)


def get_repo() -> Repository:
    repo = _state.get("repo")
    if repo is None:
        raise HTTPException(status_code=503, detail="CSDL nguồn chưa sẵn sàng")
    return repo


@app.get("/api/v1/health", tags=["Health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/{domain}/{entity}", response_model=Page, tags=["Source"])
def list_entity(
    domain: str,
    entity: str,
    updated_since: str | None = None,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    table = ROUTES.get((domain, entity))
    if table is None:
        raise HTTPException(status_code=404, detail="Không có bảng nguồn này")
    if updated_since:
        try:
            datetime.fromisoformat(updated_since)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="updated_since phải là ISO 8601") from exc
    rows, total = repo.page(table, updated_since, limit, offset)
    next_offset = offset + limit if offset + limit < total else None
    return {"items": rows, "total": total, "next_offset": next_offset}
