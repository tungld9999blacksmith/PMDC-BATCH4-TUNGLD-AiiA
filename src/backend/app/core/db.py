"""Kết nối PostgreSQL control plane (SQLAlchemy 2, driver psycopg 3)."""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def sqlalchemy_url(url: str) -> str:
    """`postgresql://…` (dạng dùng chung với psql, Dagster) → URL SQLAlchemy dùng psycopg 3."""
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


def make_engine(url: str) -> Engine:
    return create_engine(
        sqlalchemy_url(url),
        pool_pre_ping=True,
        # Mọi đối tượng control plane nằm trong schema app (xem migrations/).
        connect_args={"options": "-c search_path=app,public -c timezone=UTC"},
    )


@lru_cache
def get_engine() -> Engine:
    return make_engine(settings.database_url)


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Dependency FastAPI: một session cho mỗi request.

    Service tự gọi `commit()` trước khi trả kết quả, để lỗi ràng buộc CSDL thành response lỗi
    thay vì xảy ra sau khi response đã gửi. Phần chưa commit bị rollback khi đóng session.
    """
    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()
