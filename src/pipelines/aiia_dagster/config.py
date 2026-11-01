"""Cấu hình pipeline, đọc từ biến môi trường. Đường dẫn dự án tính từ vị trí file."""

import os
from dataclasses import dataclass, field
from pathlib import Path

PIPELINES_DIR = Path(__file__).resolve().parents[1]
DBT_DIR = PIPELINES_DIR / "dbt"
SODA_DIR = PIPELINES_DIR / "soda"


@dataclass
class Settings:
    mock_source_url: str = field(default_factory=lambda: os.getenv("MOCK_SOURCE_URL", "http://localhost:8100/api/v1"))
    landing_url: str = field(default_factory=lambda: os.getenv("AIIA_LANDING_URL", "s3://landing"))
    warehouse: str = field(default_factory=lambda: os.getenv("AIIA_WAREHOUSE", "s3://lakehouse/warehouse"))
    iceberg_uri: str = field(
        default_factory=lambda: os.getenv(
            "AIIA_ICEBERG_URI",
            "postgresql+psycopg2://aiia:aiia_dev_password@localhost:5432/iceberg_catalog",
        )
    )
    s3_endpoint: str = field(default_factory=lambda: os.getenv("S3_ENDPOINT", "http://localhost:9000"))
    s3_access_key: str = field(default_factory=lambda: os.getenv("S3_ACCESS_KEY", "minioadmin"))
    s3_secret_key: str = field(default_factory=lambda: os.getenv("S3_SECRET_KEY", "minioadmin"))
    trino_host: str = field(default_factory=lambda: os.getenv("TRINO_HOST", "localhost"))
    trino_port: str = field(default_factory=lambda: os.getenv("TRINO_PORT", "8080"))


settings = Settings()
