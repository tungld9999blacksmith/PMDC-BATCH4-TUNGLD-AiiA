"""Query Gateway tới Lakehouse (Trino).

Mọi truy vấn chạy với `user` = email người gọi (BR11) để Trino/OPA áp chính sách theo đúng người.
API vẫn tự thêm bộ lọc phạm vi và che cột (app.policy.engine) như lớp phòng thủ thứ hai.
"""

import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

from app.core.config import settings
from app.core.errors import ProblemError, service_unavailable

log = logging.getLogger("aiia.query")
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class TableMissing(Exception):
    """Bảng/schema chưa có trong Lakehouse (VD bảng Gold chưa được dbt dựng)."""


@dataclass
class QueryOutput:
    columns: list[str]
    types: list[str]
    rows: list[list[Any]]


class LakehouseGateway(Protocol):
    def execute(self, sql: str, params: list[Any], user: str) -> QueryOutput: ...


def quote_ident(name: str) -> str:
    if not _IDENT.match(name):
        raise ValueError(f"Tên định danh không hợp lệ: {name!r}")
    return f'"{name}"'


def table_ref(schema: str, table: str) -> str:
    return f"{quote_ident(settings.trino_catalog)}.{quote_ident(schema)}.{quote_ident(table)}"


class TrinoGateway:
    def execute(self, sql: str, params: list[Any], user: str) -> QueryOutput:
        import trino

        try:
            conn = trino.dbapi.connect(
                host=settings.trino_host,
                port=settings.trino_port,
                user=user,
                catalog=settings.trino_catalog,
                http_scheme="http",
                request_timeout=60,
            )
            try:
                cur = conn.cursor()
                cur.execute(sql, params or None)
                rows = [list(r) for r in cur.fetchall()]
                desc = cur.description or []
                return QueryOutput([d[0] for d in desc], [str(d[1]) for d in desc], rows)
            finally:
                conn.close()
        except trino.exceptions.TrinoUserError as exc:
            if exc.error_name in {"TABLE_NOT_FOUND", "SCHEMA_NOT_FOUND", "CATALOG_NOT_FOUND"}:
                raise TableMissing(exc.message) from exc
            log.warning("Trino từ chối truy vấn: %s", exc.message)
            if exc.error_name in {"PERMISSION_DENIED", "ACCESS_DENIED"}:
                raise ProblemError(403, "Không có quyền", "Lakehouse từ chối truy vấn theo chính sách", type_="forbidden") from exc
            raise ProblemError(422, "Truy vấn không hợp lệ", exc.message, type_="query-error") from exc
        except (trino.exceptions.TrinoConnectionError, trino.exceptions.HttpError, OSError) as exc:
            log.warning("Không kết nối được Trino: %s", exc)
            raise service_unavailable("Lakehouse (Trino) không phản hồi", type_="lakehouse-unavailable") from exc


@lru_cache
def _trino() -> TrinoGateway:
    return TrinoGateway()


def get_gateway() -> LakehouseGateway | None:
    """Dependency FastAPI; test thay bằng gateway giả qua app.dependency_overrides."""
    return _trino() if settings.trino_host else None


def require(gateway: LakehouseGateway | None) -> LakehouseGateway:
    if gateway is None:
        raise service_unavailable(
            "Lakehouse chưa được cấu hình (AIIA_TRINO_HOST). Bật profile lakehouse trong Docker Compose.",
            type_="lakehouse-unavailable",
        )
    return gateway
