"""Bronze: nạp file Parquet từ landing vào bảng Iceberg bronze.sis_students (append-only, có batch id)."""

from datetime import datetime, timezone
from uuid import uuid4

import fsspec
import pyarrow as pa
import pyarrow.parquet as pq
from dagster import AssetExecutionContext, MaterializeResult, asset
from pyiceberg.catalog import Catalog, load_catalog
from pyiceberg.exceptions import NamespaceAlreadyExistsError, NoSuchTableError

from aiia_dagster.assets.landing import LANDING_DATASET, landing_sis_students
from aiia_dagster.config import settings

BRONZE_NAMESPACE = "bronze"
BRONZE_TABLE = f"{BRONZE_NAMESPACE}.sis_students"


def _catalog() -> Catalog:
    # Cùng schema JDBC catalog mà Trino đọc (catalog-name "aiia"), nên bảng xuất hiện ngay trên Trino.
    return load_catalog(
        "aiia",
        **{
            "type": "sql",
            "uri": settings.iceberg_uri,
            "warehouse": settings.warehouse,
            "s3.endpoint": settings.s3_endpoint,
            "s3.access-key-id": settings.s3_access_key,
            "s3.secret-access-key": settings.s3_secret_key,
            "s3.path-style-access": "true",
            "s3.region": "us-east-1",
        },
    )


def _filesystem() -> fsspec.AbstractFileSystem:
    return fsspec.filesystem(
        "s3",
        key=settings.s3_access_key,
        secret=settings.s3_secret_key,
        client_kwargs={"endpoint_url": settings.s3_endpoint},
    )


@asset(group_name="bronze", compute_kind="pyiceberg", deps=[landing_sis_students])
def bronze_sis_students(context: AssetExecutionContext) -> MaterializeResult:
    fs = _filesystem()
    files = fs.glob(f"{settings.landing_url.removeprefix('s3://')}/{LANDING_DATASET}/sis_students/*.parquet")
    if not files:
        context.log.info("Không có file landing mới")
        return MaterializeResult(metadata={"rows": 0})

    with fs.open(files[0], "rb") as handle:
        tables = [pq.read_table(handle)]
    for path in files[1:]:
        with fs.open(path, "rb") as handle:
            tables.append(pq.read_table(handle))
    table = pa.concat_tables(tables, promote_options="default")

    now = datetime.now(timezone.utc)
    table = table.append_column("_ingested_at", pa.array([now] * table.num_rows, pa.timestamp("us", tz="UTC")))
    table = table.append_column("_batch_id", pa.array([str(uuid4())] * table.num_rows, pa.string()))

    catalog = _catalog()
    try:
        catalog.create_namespace(BRONZE_NAMESPACE)
    except NamespaceAlreadyExistsError:
        pass
    try:
        iceberg_table = catalog.load_table(BRONZE_TABLE)
    except NoSuchTableError:
        iceberg_table = catalog.create_table(BRONZE_TABLE, schema=table.schema)

    iceberg_table.append(table)
    # Chỉ xóa file landing sau khi append thành công, để chạy lại không mất dữ liệu.
    for path in files:
        fs.rm(path)
    context.log.info(f"Đã nạp {table.num_rows} dòng vào {BRONZE_TABLE}")
    return MaterializeResult(metadata={"rows": table.num_rows})
