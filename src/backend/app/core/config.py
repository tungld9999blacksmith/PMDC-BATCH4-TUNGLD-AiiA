"""Cấu hình ứng dụng, đọc từ biến môi trường."""

import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "AIIA_DATABASE_URL",
            "postgresql://aiia:aiia_dev_password@localhost:5432/aiia",
        )
    )
    redis_url: str = field(default_factory=lambda: os.getenv("REDIS_URL", "redis://localhost:6379/0"))


settings = Settings()
