"""Chất lượng dữ liệu bronze bằng Soda Core (kiểm tra trên Trino)."""

from dagster import AssetExecutionContext, MaterializeResult, asset
from soda.scan import Scan

from aiia_dagster.assets.bronze import bronze_sis_students
from aiia_dagster.config import SODA_DIR


@asset(group_name="quality", compute_kind="soda", deps=[bronze_sis_students])
def dq_bronze_sis_students(context: AssetExecutionContext) -> MaterializeResult:
    scan = Scan()
    scan.set_data_source_name("lakehouse")
    scan.add_configuration_yaml_file(str(SODA_DIR / "configuration.yml"))
    scan.add_sodacl_yaml_file(str(SODA_DIR / "checks" / "bronze_sis_students.yml"))
    scan.execute()
    context.log.info(scan.get_logs_text())
    scan.assert_no_error_logs()
    scan.assert_no_checks_fail()
    return MaterializeResult(metadata={"checks": "passed"})
