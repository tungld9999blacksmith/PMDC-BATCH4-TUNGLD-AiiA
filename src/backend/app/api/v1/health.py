"""Endpoint kiểm tra sức khỏe. Đường dẫn khớp openapi.yaml (prefix /api/v1)."""

import psycopg
from fastapi import APIRouter, HTTPException

from app.core.config import settings

router = APIRouter(prefix="/api/v1", tags=["Me"])


@router.get("/health", summary="Kiểm tra API còn sống (liveness)")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/db", summary="Kiểm tra kết nối CSDL (readiness)")
def health_db() -> dict[str, str]:
    try:
        with psycopg.connect(settings.database_url, connect_timeout=2) as conn:
            conn.execute("SELECT 1")
    except psycopg.Error as exc:
        raise HTTPException(status_code=503, detail="Không kết nối được CSDL") from exc
    return {"status": "ok"}
