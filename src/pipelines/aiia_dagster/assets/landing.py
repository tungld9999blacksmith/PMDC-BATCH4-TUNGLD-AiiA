"""Landing: dlt kéo dữ liệu từ mock source (phân trang, incremental theo updated_at) và ghi Parquet lên MinIO."""

from collections.abc import Iterator
from typing import Any

import dlt
import httpx
from dagster import AssetExecutionContext, MaterializeResult, MetadataValue, asset

from aiia_dagster.config import settings

LANDING_DATASET = "raw"


def _paged(path: str, since: str) -> Iterator[dict[str, Any]]:
    offset = 0
    with httpx.Client(base_url=settings.mock_source_url, timeout=30) as client:
        while offset is not None:
            response = client.get(path, params={"updated_since": since, "limit": 500, "offset": offset})
            response.raise_for_status()
            body = response.json()
            yield from body["items"]
            offset = body["next_offset"]


@dlt.resource(name="sis_students", write_disposition="append", primary_key="student_id")
def sis_students(
    updated_at: dlt.sources.incremental[str] = dlt.sources.incremental(
        "updated_at", initial_value="1970-01-01T00:00:00+00:00"
    ),
) -> Iterator[dict[str, Any]]:
    yield from _paged("/sis/students", updated_at.last_value)


def _pipeline() -> dlt.Pipeline:
    return dlt.pipeline(
        pipeline_name="aiia_landing",
        dataset_name=LANDING_DATASET,
        destination=dlt.destinations.filesystem(
            bucket_url=settings.landing_url,
            credentials={
                "aws_access_key_id": settings.s3_access_key,
                "aws_secret_access_key": settings.s3_secret_key,
                "endpoint_url": settings.s3_endpoint,
            },
        ),
        progress="log",
    )


@asset(group_name="landing", compute_kind="dlt")
def landing_sis_students(context: AssetExecutionContext) -> MaterializeResult:
    load_info = _pipeline().run(sis_students(), loader_file_format="parquet")
    context.log.info(str(load_info))
    return MaterializeResult(metadata={"load_info": MetadataValue.md(f"```\n{load_info}\n```")})
