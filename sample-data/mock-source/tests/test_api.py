from fastapi.testclient import TestClient

from app.generator import generate
from app.main import app, get_repo
from app.repository import InMemoryRepository

DATA = generate(seed=1, students=60, staff=20)
client = TestClient(app)
app.dependency_overrides[get_repo] = lambda: InMemoryRepository(DATA)


def test_health() -> None:
    assert client.get("/api/v1/health").json() == {"status": "ok"}


def test_unknown_source_returns_404() -> None:
    assert client.get("/api/v1/xyz/abc").status_code == 404


def test_invalid_updated_since_returns_422() -> None:
    assert client.get("/api/v1/sis/students", params={"updated_since": "không phải ngày"}).status_code == 422


def test_pagination_returns_every_row_once() -> None:
    collected: list[str] = []
    offset: int | None = 0
    while offset is not None:
        body = client.get("/api/v1/sis/students", params={"limit": 25, "offset": offset}).json()
        collected += [r["student_id"] for r in body["items"]]
        offset = body["next_offset"]
    assert len(collected) == body["total"] == len(DATA.sis_students)
    assert len(set(collected)) == len(collected)


def test_incremental_filter_returns_only_newer_rows() -> None:
    cutoff = "2026-09-15T00:00:00+00:00"
    body = client.get("/api/v1/hrm/staff", params={"updated_since": cutoff, "limit": 500}).json()
    assert body["total"] < len(DATA.hrm_staff)
    assert all(r["updated_at"] > cutoff for r in body["items"])
