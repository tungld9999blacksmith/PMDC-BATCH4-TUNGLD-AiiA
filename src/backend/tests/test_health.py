from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)


def test_liveness_returns_ok() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_returns_503_when_database_unreachable(monkeypatch) -> None:
    # Cổng 1 không có dịch vụ nào lắng nghe: kết nối phải thất bại nhanh.
    monkeypatch.setattr(settings, "database_url", "postgresql://aiia:x@127.0.0.1:1/aiia")
    response = client.get("/api/v1/health/db")
    assert response.status_code == 503
