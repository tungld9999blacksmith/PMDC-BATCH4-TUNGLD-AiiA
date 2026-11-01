"""Môi trường Alembic cho schema control plane `app`."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool, text

from app.core.config import settings
from app.core.db import sqlalchemy_url
from app.domain import models

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = models.Base.metadata
SCHEMA = models.SCHEMA

# Đối tượng do migration quản lý bằng SQL thuần, autogenerate bỏ qua:
# partition của audit_logs (tạo theo tháng) và các view.
_IGNORED_TABLE_PREFIXES = ("audit_logs_",)


def include_object(obj, name, type_, reflected, compare_to):  # noqa: ANN001
    if type_ == "table" and (name in models.VIEWS or name.startswith(_IGNORED_TABLE_PREFIXES)):
        return False
    return True


def include_name(name, type_, parent_names):  # noqa: ANN001
    # Chỉ so sánh schema app; bảng version của Alembic cũng nằm ở đây.
    if type_ == "schema":
        return name == SCHEMA
    return True


def _database_url() -> str:
    # `alembic -x url=...` cho phép trỏ tới CSDL khác (VD CSDL kiểm thử).
    return context.get_x_argument(as_dictionary=True).get("url") or settings.database_url


def _configure(**kwargs) -> None:  # noqa: ANN003
    context.configure(
        target_metadata=target_metadata,
        version_table_schema=SCHEMA,
        include_schemas=True,
        include_name=include_name,
        include_object=include_object,
        compare_type=True,
        **kwargs,
    )


def run_migrations_offline() -> None:
    _configure(url=sqlalchemy_url(_database_url()), literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
        context.run_migrations()


def run_migrations_online() -> None:
    # Không đặt search_path=app như engine của ứng dụng: Alembic coi schema mặc định là
    # "không tên", khi đó bảng app.* phản chiếu ra sẽ lệch tên schema với model.
    engine = create_engine(sqlalchemy_url(_database_url()), poolclass=pool.NullPool)
    with engine.connect() as connection:
        # Bảng alembic_version nằm trong schema app nên schema phải có trước.
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        connection.commit()
        _configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
