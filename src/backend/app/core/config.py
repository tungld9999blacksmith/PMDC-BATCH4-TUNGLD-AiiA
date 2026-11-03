"""Cấu hình ứng dụng, đọc từ biến môi trường (tiền tố AIIA_, trừ REDIS_URL)."""

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AIIA_", extra="ignore")

    database_url: str = "postgresql://aiia:aiia_dev_password@localhost:5432/aiia"
    redis_url: str = Field(
        default="redis://localhost:6379/0", validation_alias=AliasChoices("REDIS_URL", "AIIA_REDIS_URL")
    )

    # Xác thực. OIDC (Keycloak): kiểm chữ ký JWT bằng JWKS của issuer.
    oidc_issuer: str | None = None
    oidc_audience: str | None = None
    oidc_jwks_url: str | None = None
    # Chỉ dùng khi phát triển: chấp nhận token `demo:<userId>` (khớp chế độ demo của Web App).
    auth_dev_tokens: bool = False

    # Lakehouse (Trino). Không cấu hình → các API đọc dữ liệu trả 503.
    trino_host: str | None = None
    trino_port: int = 8080
    trino_catalog: str = "iceberg"

    # Object storage (MinIO/S3) cho file upload và file export.
    s3_endpoint: str | None = None
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_secure: bool = False
    s3_upload_bucket: str = "landing"
    s3_export_bucket: str = "exports"
    # Không có S3 → lưu file vào thư mục cục bộ (dev, test); link tải ký HMAC bằng signing_key.
    local_storage_dir: str = ".data"
    signing_key: str = "dev-only-change-me"

    # Secret store cho mật khẩu/token nguồn: secret không bao giờ lưu trong CSDL.
    secret_store_dir: str = ".secrets"

    # Dagster: kích hoạt run ingest. Không cấu hình → run nằm ở QUEUED chờ orchestrator nhận.
    dagster_url: str | None = None

    internal_email_domains: list[str] = ["uni.edu.vn", "aiia.local"]
    upload_max_bytes: int = 50 * 1024 * 1024
    export_link_ttl_minutes: int = 15
    suppression_threshold: int = 5
    assistant_rate_per_minute: int = 20


settings = Settings()
