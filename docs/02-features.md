# 02 — Danh mục tính năng và chức năng

Mỗi chức năng có mã `Fx.y`, được truy vết tới user story (US), use case (UC), trang (P) và API trong [07-traceability.md](07-traceability.md).

## F1 — Tài khoản và quyền của tôi *(MVP)*

| Mã | Chức năng | Ghi chú |
| --- | --- | --- |
| F1.1 | Đăng nhập SSO (OIDC) | US01 · tài khoản `INACTIVE` bị từ chối |
| F1.2 | Đăng xuất, thu hồi phiên | US02 · `POST /me/logout` |
| F1.3 | Xem vai trò, phạm vi đơn vị, quyền còn hạn | US03 · `GET /me`, `GET /me/grants` |
| F1.4 | Trang chủ theo vai trò | P02 · `GET /me/home` |
| F1.5 | Thông báo: run lỗi, quyền được duyệt, cảnh báo mới | `GET /notifications` |

## F2 — Tích hợp dữ liệu *(MVP)*

| Mã | Chức năng | Ghi chú |
| --- | --- | --- |
| F2.1 | Đăng ký nguồn kèm mục đích, căn cứ cho phép, owner, mức nhạy cảm | US04 · BR01 |
| F2.2 | Upload CSV/XLSX ≤ 50 MB, kiểm tra header theo template, xem trước 20 dòng, cảnh báo trùng checksum | US05 |
| F2.3 | Connector API và CSDL | dlt (mặc định), Airbyte (tùy chọn) |
| F2.4 | CDC từ CSDL nguồn | Debezium + Kafka · tùy chọn, profile `cdc` |
| F2.5 | Lập lịch ingest theo cron, tạm dừng/tiếp tục | US06 · Dagster schedule |
| F2.6 | Giám sát run: trạng thái, số dòng, log trực tiếp, chạy lại idempotent | US07 · BR14 · SSE |
| F2.7 | Ánh xạ schema nguồn → Silver, có phiên bản, xem trước biến đổi | US08 |
| F2.8 | Xem trước Bronze/Silver/Gold, cột nhạy cảm bị che | US09 · time-travel Iceberg |

## F3 — Hồ sơ 360° *(MVP)*

| Mã | Chức năng | Ghi chú |
| --- | --- | --- |
| F3.1 | Đối soát danh tính: khớp tự động, hàng đợi vùng xám, gộp, tách | US10 · BR05 |
| F3.2 | Golden record với quy tắc ưu tiên nguồn (survivorship) | BR04 · `person_attribute_provenance` |
| F3.3 | Tìm kiếm hồ sơ theo mã, tên (không dấu), email, đơn vị trong phạm vi quyền | US11 · AC11 không rò rỉ |
| F3.4 | Hồ sơ sinh viên: Tổng quan, Học tập, Tài chính, Rèn luyện, Hoạt động, Đầu ra | US12 |
| F3.5 | Hồ sơ giảng viên: Tổng quan, Giảng dạy, Nghiên cứu, Đánh giá | US13 |
| F3.6 | Hồ sơ cán bộ: Tổng quan, Nhân sự, Phát triển, Thi đua | US14 |
| F3.7 | Một người nhiều vai trò: bộ chuyển vai trò trên cùng hồ sơ | BR06 |
| F3.8 | Dòng thời gian sự kiện hợp nhất, lọc theo loại và nguồn | US15 |
| F3.9 | Nguồn gốc từng thuộc tính: nguồn, thời điểm, quy tắc ưu tiên | US16 |
| F3.10 | Trường hoặc tab bị khóa kèm nút “Yêu cầu quyền” | BR08 · nối sang F5.3 |

## F4 — Chất lượng dữ liệu *(MVP)*

| Mã | Chức năng | Ghi chú |
| --- | --- | --- |
| F4.1 | Định nghĩa quy tắc 5 chiều (đầy đủ, duy nhất, hợp lệ, nhất quán, kịp thời), mức `BLOCKING`/`WARNING` | US17 |
| F4.2 | Chạy thử quy tắc trước khi kích hoạt | US17 |
| F4.3 | Kiểm tra tự động sau mỗi ingest; bản ghi vi phạm `BLOCKING` vào quarantine | US18 · BR03 · Soda Core + dbt tests |
| F4.4 | Điểm DQ theo dataset, nguồn, chiều; xu hướng 30 ngày | US19 |
| F4.5 | Issue: gán người, ghi chú, đổi trạng thái, xử lý lại quarantine | US20 |

## F5 — Quản trị dữ liệu *(MVP)*

| Mã | Chức năng | Ghi chú |
| --- | --- | --- |
| F5.1 | Data catalog: tìm theo tên, tag, owner, lớp; xem metadata kể cả khi chưa có quyền dữ liệu | US21 |
| F5.2 | Phân loại nhạy cảm 4 mức cho từng cột; business glossary | US22 · BR07 |
| F5.3 | Yêu cầu truy cập có mục đích, thời hạn ≤ 180 ngày; Steward phê duyệt; tự thu hồi khi hết hạn | US23 · BR09 |
| F5.4 | Quản lý người dùng, vai trò, phạm vi đơn vị; không gỡ được Admin cuối cùng | US24 |
| F5.5 | Audit log bất biến, lọc theo người, đối tượng, hành động | US25 · BR10 |

## F6 — BI và báo cáo *(MVP)*

| Mã | Chức năng | Ghi chú |
| --- | --- | --- |
| F6.1 | Thư viện dashboard được phép xem, yêu thích | US26 |
| F6.2 | Bộ lọc toàn cục đồng bộ URL, drill-down có breadcrumb | US27 |
| F6.3 | Ẩn ô có nhóm < 5 người | BR12 |
| F6.4 | Thiết kế dashboard kéo-thả từ dataset Gold và metric | US28 |
| F6.5 | Export PDF/CSV có watermark, loại cột `RESTRICTED` | US29 · BR13 |
| F6.6 | Publish và chia sẻ theo vai trò, đơn vị, người dùng | US30 · BR11 |
| F6.7 | Metabase cho phân tích tổng hợp trên mart không chứa dữ liệu cá nhân | Xem câu hỏi mở 1 ở [01-scope.md](01-scope.md#8-câu-hỏi-mở-cần-chốt) |

## F7 — Lineage và phân tích tác động *(Nâng cao)*

| Mã | Chức năng |
| --- | --- |
| F7.1 | Đồ thị nguồn → Bronze → Silver → Gold → metric → dashboard; mức cột cho Gold (US31) |
| F7.2 | Liệt kê thành phần phía sau bị ảnh hưởng trước khi đổi mapping hoặc schema (US32) |

## F8 — Phân quyền chi tiết *(Nâng cao)*

| Mã | Chức năng |
| --- | --- |
| F8.1 | Chính sách theo dòng: điều kiện theo đơn vị hoặc thuộc tính người dùng (US33) |
| F8.2 | Chính sách theo cột: che một phần, băm, ẩn (US33) |
| F8.3 | Mô phỏng “Xem như người dùng X” trước khi lưu |
| F8.4 | Phiên bản chính sách, khôi phục phiên bản cũ (BR19) |

## F9 — Phát hiện bất thường *(Nâng cao)*

| Mã | Chức năng |
| --- | --- |
| F9.1 | Khối lượng: số dòng lệch > 30% so với trung bình 4 lần chạy (US34) |
| F9.2 | Độ mới: dataset vượt SLA |
| F9.3 | Biến động chỉ số: lệch > 3 độ lệch chuẩn so với lịch sử |
| F9.4 | Xử lý cảnh báo: xác nhận, đã xử lý, bỏ qua (US35 · BR17) |

## F10 — Semantic model và báo cáo tự động *(Nâng cao)*

| Mã | Chức năng |
| --- | --- |
| F10.1 | Định nghĩa metric, dimension dùng chung; kiểm tra công thức; phiên bản (US36) |
| F10.2 | Chứng nhận metric (`CERTIFIED`) bởi Steward |
| F10.3 | Đăng ký nhận dashboard định kỳ qua email nội bộ (US37 · BR18) |
| F10.4 | Báo cáo tự động có tóm tắt bằng tiếng Việt, gắn nhãn “Do AI tạo” (US38 · BR20) |

## F11 — Trợ lý hỏi-đáp *(Nâng cao)*

| Mã | Chức năng |
| --- | --- |
| F11.1 | Hỏi bằng tiếng Việt, trả lời streaming (US39) |
| F11.2 | LLM chỉ chọn metric `CERTIFIED` và sinh `SemanticQuery` có cấu trúc; không sinh SQL tự do (BR16) |
| F11.3 | Truy vấn chạy dưới danh tính người hỏi, áp phân quyền và ngưỡng nhóm nhỏ |
| F11.4 | Hỏi lại để làm rõ khi câu hỏi mơ hồ |
| F11.5 | Từ chối khi vượt quyền hoặc thuộc chủ đề bị chặn, kèm nút yêu cầu quyền |
| F11.6 | Câu trả lời kèm metric, bộ lọc, thời điểm dữ liệu, truy vấn đã chạy, nút mở dashboard |
| F11.7 | Phản hồi hữu ích/không hữu ích |
| F11.8 | Nhật ký hỏi-đáp và quản lý chủ đề bị chặn (US40) |

## F12 — Nền tảng Lakehouse *(MVP, nền tảng)*

| Mã | Chức năng | Ghi chú |
| --- | --- | --- |
| F12.1 | Landing: dlt kéo dữ liệu phân trang, incremental theo `updated_at`, ghi Parquet lên MinIO | `landing_sis_students` |
| F12.2 | Bronze: nạp vào bảng Iceberg append-only kèm `_batch_id`, `_ingested_at` | `bronze_sis_students` · BR02 |
| F12.3 | Iceberg JDBC catalog trên PostgreSQL; Trino và PyIceberg dùng chung | database `iceberg_catalog` |
| F12.4 | Silver/Gold bằng dbt-trino; CCCD chỉ đi tiếp dưới dạng băm có salt | `silver_sis_students`, `dim_student` |
| F12.5 | Điều phối bằng Dagster: job `sis_ingest_job`, lịch 02:00 hằng ngày | |
| F12.6 | Giám sát: metric Prometheus, log Loki, trace Tempo, dashboard Grafana | profile `obs` |
| F12.7 | Mock source: một server cung cấp API và CSDL giả lập cho SIS, HRM, FIN, LMS | `sample-data/mock-source` |
