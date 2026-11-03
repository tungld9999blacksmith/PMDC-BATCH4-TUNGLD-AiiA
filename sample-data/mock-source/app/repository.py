"""Truy vấn phân trang theo updated_at. Có hai cài đặt: Postgres và bộ nhớ (dùng trong test)."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Any, Protocol

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from app.generator import SourceData


class Repository(Protocol):
    def page(
        self, table: str, updated_since: str | None, limit: int, offset: int
    ) -> tuple[list[dict[str, Any]], int]: ...


class PgRepository:
    def __init__(self, url: str) -> None:
        self._url = url

    def page(
        self, table: str, updated_since: str | None, limit: int, offset: int
    ) -> tuple[list[dict[str, Any]], int]:
        where = sql.SQL("")
        params: list[Any] = []
        if updated_since:
            where = sql.SQL("WHERE updated_at > %s")
            params.append(updated_since)
        with psycopg.connect(self._url, row_factory=dict_row) as conn:
            total = conn.execute(
                sql.SQL("SELECT count(*) AS n FROM {} {}").format(sql.Identifier(table), where), params
            ).fetchone()["n"]
            rows = conn.execute(
                sql.SQL("SELECT * FROM {} {} ORDER BY updated_at, 1 LIMIT %s OFFSET %s").format(
                    sql.Identifier(table), where
                ),
                [*params, limit, offset],
            ).fetchall()
        return rows, total


class InMemoryRepository:
    """Cài đặt bộ nhớ, dùng cho test và chạy thử không cần Postgres."""

    def __init__(self, data: SourceData) -> None:
        self._tables = asdict(data)

    def page(
        self, table: str, updated_since: str | None, limit: int, offset: int
    ) -> tuple[list[dict[str, Any]], int]:
        rows = self._tables[table]
        if updated_since:
            since = datetime.fromisoformat(updated_since)
            rows = [r for r in rows if datetime.fromisoformat(r["updated_at"]) > since]
        first_key = next(iter(self._tables[table][0]))
        rows = sorted(rows, key=lambda r: (r["updated_at"], r[first_key]))
        return rows[offset : offset + limit], len(rows)
