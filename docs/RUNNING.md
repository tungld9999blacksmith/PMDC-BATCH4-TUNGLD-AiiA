# Chạy AiiA cục bộ

## 1. Chuẩn bị

```bash
cp .env.example .env          # chỉnh mật khẩu nếu cần
```

Python dùng **uv** (mỗi project có `pyproject.toml` và `uv.lock`):

| Project | Đường dẫn | Dùng để |
| --- | --- | --- |
| Backend | `src/backend` | Platform API, Celery worker |
| Mock source | `sample-data/mock-source` | Nguồn giả lập: API + CSDL |
| Pipelines | `src/pipelines` | Dagster, dlt, PyIceberg, Soda, dbt |

```bash
cd src/backend && uv sync && uv run pytest        # 2 test
cd sample-data/mock-source && uv sync && uv run pytest   # 9 test
cd src/pipelines && uv sync && uv run dagster dev -m aiia_dagster.definitions
```

Cập nhật dependency: sửa `pyproject.toml` rồi chạy `uv lock` (không sửa tay `uv.lock`).

Frontend: xem [§3](#3-frontend).

## 2. Chạy bằng Docker Compose

Một `compose.yaml` chia nhóm bằng **profiles**. Service không gắn profile (`postgres`, `minio`) luôn chạy.

| Profile | Service | Vai trò |
| --- | --- | --- |
| _(luôn chạy)_ | `postgres` (18), `minio`, `minio-init` | CSDL dùng chung (aiia, iceberg_catalog, mock_source, metabase, dagster); Lakehouse storage |
| `source` | `mock-source` | Nguồn giả lập (API + CSDL `mock_source`) |
| `lakehouse` | `trino`, `dagster` | Query engine và điều phối pipeline |
| `app` | `api`, `worker`, `redis`, `web` | Platform API, Celery, cache, giao diện |
| `bi` | `metabase` | BI |
| `obs` | `prometheus`, `loki`, `promtail`, `tempo`, `grafana` | Giám sát |
| `cdc` | `kafka`, `debezium` | CDC từ `mock_source` |

Khuyến nghị: không bật tất cả cùng lúc. Bắt đầu với luồng ingest:

```bash
docker compose --profile source --profile lakehouse up -d --build
```

Ước lượng bộ nhớ (theo kinh nghiệm, máy phát triển 16 GB):

| Gói | Profile | Ghi chú |
| --- | --- | --- |
| Tối thiểu | _(không profile)_ | Postgres + MinIO |
| Ingest + Lakehouse | `source` `lakehouse` | Trino giới hạn heap 2 GB |
| Ứng dụng | `+ app` | API, worker, web |
| Giám sát | `+ obs` | Nhẹ |
| CDC | `+ cdc` | Kafka nặng nhất trong nhóm |

Kiểm tra cấu hình mà không cần khởi động:

```bash
docker compose --profile source --profile lakehouse --profile app --profile bi --profile obs --profile cdc config --quiet
```

## 3. Frontend

```bash
cd src/frontend
npm install
npm start          # http://localhost:4200
npm test           # unit test + smoke test mọi route (Karma, trình duyệt headless)
npx ng build       # build production vào dist/aiia-web
npm run gen:api    # sinh lại src/app/core/api/schema.d.ts khi openapi.yaml đổi
```

Giao diện mặc định chạy với **mock API trong trình duyệt** (`useMockApi: true` trong `src/environments/`), nên không cần backend hay Docker để dùng thử. Dữ liệu là bộ tổng hợp sinh cố định khi tải trang; tải lại trang sẽ đặt lại mọi thay đổi. Riêng `/health` luôn gọi backend thật (trang chủ hiển thị trạng thái API).

Đăng nhập ở `/login` bằng một tài khoản demo:

| Tài khoản | Vai trò (phạm vi) | Nên thử |
| --- | --- | --- |
| TS. Hoàng Minh | Người dùng báo cáo (CNTT) | Hồ sơ 360° khoa CNTT, tab Tài chính bị khóa → yêu cầu quyền, dashboard, trợ lý |
| Nguyễn Thu Hà | Chuyên viên phân tích + báo cáo (toàn trường) | Thiết kế dashboard, semantic model, báo cáo tự động |
| Trần Quốc Bảo | Quản trị dữ liệu | Duyệt yêu cầu truy cập, quy tắc chất lượng, issue, đối soát danh tính, độ nhạy cột |
| Phạm Đức Anh | Kỹ sư dữ liệu | Đăng ký nguồn, upload file, mapping, giám sát pipeline, explorer |
| Lê Thanh Tùng | Quản trị hệ thống | Người dùng & vai trò, chính sách (mô phỏng), nhật ký kiểm toán, chủ đề chặn |
| Võ Ngọc Yến | Người dùng báo cáo (KT) | So sánh phạm vi dữ liệu với khoa CNTT |

Để gọi Platform API thật, đặt `useMockApi: false`. `npm start` proxy `/api` tới `http://localhost:8000` (`proxy.conf.json`); backend chấp nhận token demo dạng `demo:<userId>` trong môi trường phát triển.

## 4. Dockerfile

Tất cả image Python dùng chung một khuôn (xem `dockerfiles/Dockerfile.backend`):

- **Builder** dùng image `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`. Dependency được cài bằng `uv sync --frozen --no-dev` từ `pyproject.toml` và `uv.lock` đặt qua bind mount, nên lớp này chỉ build lại khi dependency đổi.
- Cache của uv được giữ qua `--mount=type=cache`.
- **Runtime** dùng `python:3.12-slim-bookworm`, không có uv hay công cụ build, chạy user không phải root (uid 1000), có `HEALTHCHECK`.
- Ngữ cảnh build là thư mục gốc repo, file `.dockerignore` loại trừ `.env`, `.git`, `node_modules`.

```bash
docker build -f dockerfiles/Dockerfile.backend -t aiia-backend .
docker build -f dockerfiles/Dockerfile.mock-source -t aiia-mock-source .
docker build -f dockerfiles/Dockerfile.pipelines -t aiia-pipelines .
docker build -f dockerfiles/Dockerfile.web -t aiia-web .
```

`dockerfiles/Dockerfile.pipelines` chạy `dagster dev` (chế độ phát triển). Production nên tách webserver và daemon.

## 5. Kiểm tra nhanh

| Thành phần | Địa chỉ | Kỳ vọng |
| --- | --- | --- |
| Mock source | `http://localhost:8100/api/v1/sis/students?limit=2` | JSON `items`, `total`, `next_offset` |
| Trino | `http://localhost:8080/ui` | UI Trino |
| Dagster | `http://localhost:3000` | Asset `sis_ingest_job` |
| MinIO | `http://localhost:9001` | Bucket `lakehouse`, `landing` |
| Platform API | `http://localhost:8000/api/v1/health` | `{"status":"ok"}` |

Nạp dữ liệu: mở Dagster, chạy job `sis_ingest_job`. Chuỗi asset: `landing_sis_students` (dlt) → `bronze_sis_students` (PyIceberg) → `dq_bronze_sis_students` (Soda) → `lakehouse_dbt_build` (dbt silver/gold).

Demo CDC: sau khi bật profile `cdc`, đăng ký connector:

```bash
curl -X POST -H "Content-Type: application/json" --data @infra/debezium/sis-source.json http://localhost:8083/connectors
```

## 6. Chưa có hoặc chưa kiểm chứng

- **Airbyte** không nằm trong compose: bản OSS chạy qua `abctl` trên Kubernetes (kind). Đường ingest hiện tại là dlt. Airbyte có thể bổ sung sau, trỏ vào `mock-source`.
- **Tiêu thụ CDC** từ Kafka vào Lakehouse chưa được viết: cần sensor hoặc consumer riêng.
- **Chưa chạy end-to-end** trên Docker: máy phát triển không có Docker daemon khi làm việc này. Đã kiểm chứng: `docker compose config`, `docker buildx build --check` cho bốn Dockerfile, `uv lock`, test backend và mock-source, Dagster load được definitions, `dbt parse`, build Angular production cùng unit test và smoke test giao diện, và PyIceberg SQL catalog trên SQLite cục bộ.
- **Tag image** (Trino 470, MinIO, Metabase, Kafka, Debezium) cần kiểm tra trên Docker Hub ở lần pull đầu.
- **Metabase** cần cài driver Trino riêng; bản chính thức không đi kèm.
