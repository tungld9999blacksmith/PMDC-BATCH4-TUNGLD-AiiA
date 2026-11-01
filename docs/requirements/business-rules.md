# Quy tắc nghiệp vụ (Business Rules)

| ID | Quy tắc | Áp dụng tại |
| --- | --- | --- |
| BR01 | Chỉ ingest từ nguồn đã đăng ký có owner nghiệp vụ, mục đích, căn cứ cho phép và ở trạng thái `ACTIVE`. | Sources, Dagster, `chk_source_legal_basis` |
| BR02 | Bronze bất biến (append-only), lưu nguyên trạng kèm `batch_id`, `source_id`, `ingested_at`, `checksum`. | Bronze, `ingestion_batches` |
| BR03 | Bản ghi vi phạm quy tắc `BLOCKING` vào quarantine, không vào Silver/Gold; vi phạm `WARNING` đi tiếp nhưng tạo issue. | DQ Runner (Soda, dbt tests) |
| BR04 | Gold và hồ sơ 360° chỉ dựng từ Silver; mỗi thuộc tính của golden record lưu nguồn, thời điểm và quy tắc ưu tiên. | dbt, `person_attribute_provenance` |
| BR05 | Đối soát danh tính: điểm ≥ 0,95 gộp tự động; 0,75–0,95 chờ Steward duyệt; < 0,75 là khác người. Mọi thao tác gộp có thể tách lại. | Identity, `match_candidates` |
| BR06 | Một người thật chỉ có một `person_id`, có thể gắn nhiều hồ sơ vai trò cùng lúc. | `dim_person`, hồ sơ 360° |
| BR07 | Mọi cột phân loại 4 mức `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`; chưa phân loại xử lý như `CONFIDENTIAL`; `RESTRICTED` mặc định bị che. | Catalog, `dataset_columns` |
| BR08 | Từ chối mặc định. Quyền hiệu lực = vai trò ∧ phạm vi đơn vị ∧ mức nhạy cảm ∧ quyền dataset/dashboard còn hạn. Admin hệ thống không mặc định đọc dữ liệu `RESTRICTED`. | Platform API, Trino |
| BR09 | Yêu cầu truy cập có mục đích, phạm vi, thời hạn ≤ 180 ngày; chỉ Steward phụ trách duyệt; không tự duyệt; quyền tự thu hồi khi hết hạn. | Access, `expire_access()` |
| BR10 | Truy cập hồ sơ cá nhân, dữ liệu `CONFIDENTIAL`/`RESTRICTED`, export, thay đổi quyền/chính sách và câu hỏi gửi trợ lý đều ghi audit bất biến. | `audit_logs`, `trg_audit_immutable` |
| BR11 | Dashboard truy vấn dưới danh tính người xem, không theo quyền người tạo. | Semantic Service, Query Gateway |
| BR12 | Ô tổng hợp có nhóm < 5 người bị ẩn, hiển thị “< 5” trên dashboard, export và trợ lý. | Query Gateway |
| BR13 | Export chỉ gồm dữ liệu được phép, có watermark người xuất và thời điểm; cột `RESTRICTED` không bao giờ được export. | Export, App Worker |
| BR14 | Mỗi lần chạy pipeline idempotent: chạy lại cùng batch không tạo bản ghi trùng ở Silver/Gold. | dlt state, dbt MERGE |
| BR15 | Mỗi dataset Gold có SLA độ mới; vượt SLA hiển thị nhãn “Dữ liệu cũ” ở mọi nơi dùng dataset đó. | `v_stale_datasets`, UI |
| BR16 | Trợ lý chỉ sinh truy vấn trên metric `CERTIFIED`, chạy dưới danh tính người hỏi, luôn trả kèm metric, bộ lọc, thời điểm dữ liệu và truy vấn; không trả dữ liệu dòng `RESTRICTED`; từ chối khi vượt quyền hoặc chủ đề chặn. | Assistant |
| BR17 | Cảnh báo bất thường chỉ cảnh báo, không tự sửa dữ liệu; vòng đời `OPEN → ACKNOWLEDGED → RESOLVED / DISMISSED`. | Anomaly Detector |
| BR18 | Báo cáo tự động tính quyền theo người nhận tại thời điểm gửi; chỉ gửi tới email nội bộ. | App Worker |
| BR19 | Chính sách phân quyền và metric có phiên bản, xem lại và khôi phục được. | `access_policy_versions`, `semantic_metric_versions` |
| BR20 | Nội dung do AI sinh luôn gắn nhãn “Do AI tạo” và liên kết tới số liệu gốc. | Assistant, báo cáo tự động |
