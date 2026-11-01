"""Điểm vào của Dagster: `dagster dev -m aiia_dagster.definitions`."""

from dagster import AssetSelection, Definitions, ScheduleDefinition, define_asset_job

from aiia_dagster.assets.bronze import bronze_sis_students
from aiia_dagster.assets.landing import landing_sis_students
from aiia_dagster.assets.quality import dq_bronze_sis_students
from aiia_dagster.assets.transform import lakehouse_dbt_build

sis_ingest_job = define_asset_job(
    "sis_ingest_job",
    selection=AssetSelection.assets(
        landing_sis_students, bronze_sis_students, dq_bronze_sis_students, lakehouse_dbt_build
    ),
    description="Ingest SIS: landing → bronze → DQ → silver/gold",
)

defs = Definitions(
    assets=[landing_sis_students, bronze_sis_students, dq_bronze_sis_students, lakehouse_dbt_build],
    jobs=[sis_ingest_job],
    schedules=[ScheduleDefinition(job=sis_ingest_job, cron_schedule="0 2 * * *")],
)
