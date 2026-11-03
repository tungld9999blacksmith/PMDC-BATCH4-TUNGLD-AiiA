"""Silver và Gold bằng dbt-trino. Một asset gọi `dbt build` để chạy cả model lẫn dbt tests."""

import subprocess

from dagster import AssetExecutionContext, Failure, MaterializeResult, asset

from aiia_dagster.assets.quality import dq_bronze_sis_students
from aiia_dagster.config import DBT_DIR


@asset(group_name="transform", compute_kind="dbt", deps=[dq_bronze_sis_students])
def lakehouse_dbt_build(context: AssetExecutionContext) -> MaterializeResult:
    command = ["dbt", "build", "--project-dir", str(DBT_DIR), "--profiles-dir", str(DBT_DIR)]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    context.log.info(result.stdout)
    if result.returncode != 0:
        raise Failure(description=result.stdout[-4000:] or result.stderr[-4000:])
    return MaterializeResult(metadata={"dbt_exit_code": result.returncode})
