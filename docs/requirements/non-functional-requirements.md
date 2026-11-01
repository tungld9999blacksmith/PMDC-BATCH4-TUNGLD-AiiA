# Yêu cầu phi chức năng (NFR)

Các chỉ số đo trên môi trường demo (Docker Compose, dữ liệu giả lập ~50.000 người, 8 nguồn) trừ khi ghi khác. Quy tắc nghiệp vụ (BR01–BR20) ở [README §2.3.4](../../README.md#234-quy-tắc-nghiệp-vụ-business-rules).

| ID | Nhóm | Yêu cầu | Đo lường / mục tiêu MVP |
| --- | --- | --- | --- |
| NFR01 | Hiệu năng | Truy vấn widget dashboard qua `POST /semantic/query` | p95 < 3 s; mart Gold có sẵn tổng hợp |
| NFR02 | Hiệu năng | API metadata (catalog, nguồn, issue, quyền) | p95 < 500 ms |
| NFR03 | Hiệu năng | Mở hồ sơ 360° (header + tab đầu) | p95 < 2 s |
| NFR04 | Hiệu năng | Trợ lý hỏi-đáp | Sự kiện SSE đầu tiên < 1 s; câu trả lời hoàn chỉnh p95 < 15 s |
| NFR05 | Hiệu năng | Ingest file 100.000 dòng (Bronze → DQ → Silver → Gold) | < 5 phút |
| NFR06 | Độ mới dữ liệu | Nguồn hằng ngày sẵn sàng ở Gold | Trước 06:00; vượt SLA hiển thị nhãn “Dữ liệu cũ” (BR15) |
| NFR07 | Chất lượng dữ liệu | Dataset Gold có quy tắc DQ | 100%; 0 bản ghi vi phạm `BLOCKING` trong Gold |
| NFR08 | Chất lượng dữ liệu | Độ chính xác đối soát danh tính trên bộ mẫu có nhãn | Precision ≥ 99% (gộp nhầm), recall ≥ 95% |
| NFR09 | Bảo mật | Xác thực OIDC qua SSO của trường; access token 15 phút, refresh token xoay vòng | Bắt buộc |
| NFR10 | Bảo mật | MFA cho `PLATFORM_ADMIN` và `DATA_STEWARD` | Bắt buộc (cấu hình ở IdP) |
| NFR11 | Bảo mật | Phân quyền kiểm tra ở backend; truy vấn dữ liệu chạy dưới danh tính người dùng, Trino + OPA áp row filter/column mask | 0 rò rỉ trong bộ kiểm thử phân quyền |
| NFR12 | Bảo mật | HTTPS (TLS ≥ 1.2); mã hóa khi lưu (MinIO SSE, đĩa PostgreSQL); bí mật kết nối trong secret store | Bắt buộc |
| NFR13 | Bảo mật | OWASP ASVS Level 2 cho API (xử lý dữ liệu cá nhân) | Bắt buộc trước khi đưa vào sử dụng thật |
| NFR14 | Riêng tư | CCCD chỉ lưu dạng băm có salt; log ứng dụng không chứa dữ liệu cá nhân | Bắt buộc |
| NFR15 | Riêng tư | Ẩn ô tổng hợp có nhóm < 5 trên dashboard, export, hỏi-đáp | k = 5 (BR12) |
| NFR16 | Riêng tư | Môi trường phát triển và demo chỉ dùng dữ liệu giả lập | Bắt buộc |
| NFR17 | Riêng tư | Đánh giá tác động xử lý dữ liệu cá nhân trước khi kết nối nguồn thật | Bắt buộc, do DPO/pháp chế thực hiện |
| NFR18 | Kiểm toán | Audit log bất biến, lưu giữ | ≥ 24 tháng; truy vấn theo người/đối tượng < 2 s |
| NFR19 | Chất lượng AI | Bộ benchmark hỏi-đáp ≥ 60 câu (trong quyền, mơ hồ, vượt quyền, chủ đề chặn, prompt injection) | Chọn đúng metric ≥ 90%; từ chối đúng 100% với câu vượt quyền; 0 lộ dữ liệu ngoài quyền |
| NFR20 | Chất lượng AI | LLM chỉ nhận schema metric và kết quả tổng hợp đã áp quyền; không nhận dữ liệu dòng `RESTRICTED` | Kiểm tra bằng log prompt trong CI |
| NFR21 | Chất lượng AI | Benchmark chạy trong CI khi đổi prompt, mô hình, semantic model | Bắt buộc |
| NFR22 | Khả dụng | Uptime giờ hành chính | ≥ 99,5% / tháng |
| NFR23 | Sao lưu & phục hồi | PostgreSQL sao lưu hằng ngày + WAL; Iceberg giữ snapshot 30 ngày; MinIO bật versioning | RPO ≤ 24 giờ, RTO ≤ 4 giờ |
| NFR24 | Mở rộng | Quy mô mục tiêu giai đoạn 1 | 50.000 người, 20 nguồn, 100 người xem đồng thời |
| NFR25 | Quan sát | Log có cấu trúc (JSON) kèm `traceId`; tracing OpenTelemetry API → Trino → LLM; metric Prometheus; cảnh báo khi run `FAILED` | Bắt buộc |
| NFR26 | Bảo trì | Kiểm thử dbt (schema + DQ) và kiểm thử hợp đồng OpenAPI trong CI | Bắt buộc; độ phủ unit test tầng service ≥ 70% |
| NFR27 | Khả chuyển | Định dạng mở (Parquet/Iceberg), thành phần mã nguồn mở; LLM sau adapter | Đổi nhà cung cấp LLM không sửa tầng nghiệp vụ |
| NFR28 | Khả năng truy cập | WCAG 2.1 AA; biểu đồ có bảng dữ liệu thay thế; điều hướng bàn phím | Bắt buộc |
| NFR29 | Đáp ứng | Report Viewer dùng được dashboard, hồ sơ, hỏi-đáp ở chiều rộng ≥ 360 px (chỉ xem) | Bắt buộc |
| NFR30 | Ngôn ngữ | Giao diện tiếng Việt; tìm kiếm hồ sơ không phân biệt dấu | Bắt buộc |
