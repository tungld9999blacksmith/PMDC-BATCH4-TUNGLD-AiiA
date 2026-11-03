"""Cấu hình mock source, đọc từ biến môi trường."""

import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    database_url: str | None = field(default_factory=lambda: os.getenv("MOCK_DATABASE_URL"))
    seed: int = field(default_factory=lambda: int(os.getenv("MOCK_SEED", "42")))
    students: int = field(default_factory=lambda: int(os.getenv("MOCK_STUDENTS", "2000")))
    staff: int = field(default_factory=lambda: int(os.getenv("MOCK_STAFF", "300")))


settings = Settings()
