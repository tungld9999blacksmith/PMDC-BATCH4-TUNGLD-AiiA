# 01 — Phân tích đề bài Top-down (Research)

> Bước 1 · Nguồn đầu vào: đề bài “Nền tảng dữ liệu theo kiến trúc Data Lakehouse để xây dựng hồ sơ 360° cho sinh viên, giảng viên và cán bộ” và [README §1](../README.md#1-phân-tích-đề-bài-top-down-research).
> Phương pháp: đi từ **tầm nhìn → mục tiêu → năng lực → tính năng → chức năng → dữ liệu/kỹ thuật**; mỗi tầng chỉ trả lời câu hỏi của tầng trên.

## 1. Tóm tắt đề bài

AiiA là nền tảng dữ liệu của trường đại học. Hệ thống gom dữ liệu từ các hệ thống nghiệp vụ **được phép**, hợp nhất thành **hồ sơ 360°** cho từng người, rồi phục vụ báo cáo và ra quyết định **có kiểm soát**. Sản phẩm trả lời bốn câu hỏi:

| Câu hỏi | Năng lực sản phẩm tương ứng |
| --- | --- |
| Một sinh viên, giảng viên, cán bộ **là ai và đang ở đâu** trong quá trình học tập, công tác? | Hồ sơ 360° hợp nhất từ SIS, LMS, HRM, tài chính, thư viện, KHCN |
| Số liệu **có đáng tin** không, lấy từ đâu, cập nhật khi nào? | Quy tắc chất lượng, nguồn gốc thuộc tính, độ mới, lineage |
| **Ai được xem gì**, vì mục đích gì, trong bao lâu? | Phân loại nhạy cảm, phân quyền theo vai trò, đơn vị, cột; cấp quyền có thời hạn; audit |
| **Xu hướng và bất thường** nằm ở đâu để hành động? | Dashboard BI, semantic model, cảnh báo, trợ lý hỏi-đáp |

Nguyên tắc xuyên suốt: **“Đúng người, đúng mục đích, có nguồn gốc.”**

## 2. Phân rã Top-down

### Tầng 0 — Tầm nhìn

> Giúp nhà trường hiểu đầy đủ người học và người lao động của mình, ra quyết định dựa trên số liệu đáng tin, đồng thời bảo vệ dữ liệu cá nhân ở mọi bước.

### Tầng 1 — Mục tiêu sản phẩm (Goals)

| ID | Mục tiêu | Đo bằng |
| --- | --- | --- |
| G1 | **Hợp nhất** dữ liệu phân tán thành một hồ sơ cho mỗi người | ≥ 5 nguồn mẫu ingest thành công; ≥ 95% bản ghi về đúng một `person_id` |
| G2 | Dữ liệu **đáng tin và giải trình được** | 100% dataset Gold có quy tắc DQ; 0 bản ghi vi phạm `BLOCKING` ở Gold; mọi thuộc tính có nguồn và thời điểm |
| G3 | **Ra quyết định nhanh** bằng số liệu | ≥ 4 dashboard mẫu; truy vấn widget p95 < 3 s; trợ lý chọn đúng metric ≥ 90% |
| G4 | **Kiểm soát truy cập và tuân thủ** | 0 rò rỉ trong bộ kiểm thử phân quyền; 100% truy cập dữ liệu nhạy cảm có audit |
| G5 | **Vận hành bền vững** | Toàn bộ thành phần mã nguồn mở, chạy được bằng Docker Compose; khôi phục RPO ≤ 24 giờ |

### Tầng 2 — Năng lực (Capabilities)

```text
AiiA
├── C1 Thu nạp dữ liệu (Ingest)            → G1
├── C2 Hợp nhất hồ sơ (Unify)              → G1
├── C3 Bảo đảm chất lượng (Assure)          → G2
├── C4 Quản trị và bảo vệ dữ liệu (Govern)  → G2, G4
├── C5 Phân tích và báo cáo (Analyze)       → G3
├── C6 Hỏi-đáp có kiểm soát (Ask)           → G3, G4
└── C7 Vận hành nền tảng (Operate)          → G5
```

### Tầng 3 — Tính năng (Features)

| Năng lực | Tính năng | Phạm vi |
| --- | --- | --- |
| C1 | F2 Tích hợp dữ liệu — đăng ký nguồn được phép, upload, connector, lịch, giám sát run | ✅ MVP |
| C1, C7 | F12 Nền tảng Lakehouse — landing, Bronze/Silver/Gold, catalog Iceberg, điều phối, giám sát | ✅ MVP (nền tảng) |
| C2 | F3 Hồ sơ 360° — đối soát danh tính, golden record, hồ sơ SV/GV/CB, timeline, nguồn gốc | ✅ MVP |
| C3 | F4 Chất lượng dữ liệu — quy tắc 5 chiều, cách ly, điểm DQ, issue | ✅ MVP |
| C4 | F1 Tài khoản và quyền của tôi | ✅ MVP |
| C4 | F5 Quản trị dữ liệu — catalog, phân loại, cấp quyền có thời hạn, người dùng, audit | ✅ MVP |
| C5 | F6 BI và báo cáo — thư viện, lọc, drill-down, thiết kế, export, chia sẻ | ✅ MVP |
| C4 | F7 Lineage và phân tích tác động | ⭐ Nâng cao |
| C4 | F8 Phân quyền chi tiết theo dòng và cột | ⭐ Nâng cao |
| C3 | F9 Phát hiện bất thường | ⭐ Nâng cao |
| C5 | F10 Semantic model và báo cáo tự động | ⭐ Nâng cao |
| C6 | F11 Trợ lý hỏi-đáp trên dữ liệu được cấp quyền | ⭐ Nâng cao |

### Tầng 4 — Chức năng (Functions) — xem chi tiết [02-features.md](02-features.md)

### Tầng 5 — Dữ liệu và kỹ thuật

| Chức năng cần | Dữ liệu | Kỹ thuật |
| --- | --- | --- |
| Thu nạp từ nguồn | `data_sources`, `ingestion_batches`, `pipeline_runs`, bảng Bronze | dlt (API, file), Airbyte (tùy chọn), Debezium + Kafka (CDC), MinIO |
| Lưu trữ Lakehouse | Bronze, Silver, Gold, Quarantine | Parquet + Apache Iceberg, Iceberg JDBC catalog trên PostgreSQL, Trino |
| Biến đổi | Silver, Gold (`dim_*`, `fact_*`, `mart_*`) | dbt-trino |
| Hồ sơ 360° | `dim_person`, `person_source_xref`, `person_attribute_provenance`, `fact_*` | Đối soát danh tính, survivorship, Platform API |
| Chất lượng | `dq_rules`, `dq_rule_results`, `dq_issues` | Soda Core, dbt tests |
| Quản trị và quyền | `datasets`, `dataset_columns`, `access_*`, `audit_logs` | PostgreSQL 18 control plane, RBAC ở backend, row filter và column mask tại Trino |
| BI | `dashboards`, `semantic_metrics`, mart Gold | Metabase, Semantic Service của Platform API |
| Hỏi-đáp | `qa_conversations`, `qa_messages`, `semantic_metrics` | LLM sau adapter, `SemanticQuery` có cấu trúc |
| Điều phối và giám sát | `pipeline_runs`, `anomaly_alerts` | Dagster; Prometheus, Loki, Tempo, Grafana |
| Ứng dụng | — | Python, FastAPI, Celery; Angular 19 standalone; Docker Compose |

## 3. Bối cảnh và giải pháp hiện có (research)

| Loại giải pháp | Ví dụ | Điểm mạnh | Khoảng trống AiiA lấp |
| --- | --- | --- | --- |
| Báo cáo có sẵn trong từng hệ thống | Báo cáo của phần mềm đào tạo, nhân sự | Sẵn có, đúng nghiệp vụ từng phòng | Mỗi hệ thống một góc nhìn, không ghép được thành hồ sơ một người |
| Tổng hợp thủ công | Excel gửi qua email | Linh hoạt, không cần đầu tư | Sai số, chậm, nhiều phiên bản số liệu, chia sẻ dữ liệu cá nhân không kiểm soát |
| Data warehouse truyền thống | Kho dữ liệu SQL + công cụ ETL | Mô hình chặt, quen thuộc | Khó chứa dữ liệu thô và bán cấu trúc; khó truy vết từ báo cáo về nguồn |
| Công cụ BI độc lập | Metabase, Superset, công cụ thương mại | Dashboard nhanh | Không giải quyết hợp nhất danh tính, chất lượng và cấp quyền theo mục đích |
| Chatbot tổng quát trên dữ liệu | LLM sinh SQL tự do | Hỏi bằng ngôn ngữ tự nhiên | Có thể sinh truy vấn sai, vượt quyền, không giải trình được nguồn |

**Kết luận:** giá trị khác biệt không nằm ở một công cụ riêng lẻ mà ở **chuỗi có kiểm soát**: nguồn được phép → hợp nhất danh tính → kiểm tra chất lượng → phân quyền theo mục đích → BI và hỏi-đáp chỉ trên metric đã chứng nhận.

## 4. Người dùng mục tiêu

| Persona | Vai trò hệ thống | Nhu cầu | Tính năng chính |
| --- | --- | --- | --- |
| **P1 — Lãnh đạo khoa, phòng** *(persona chính MVP)* | Report Viewer | Số liệu tổng hợp đáng tin, xu hướng, cảnh báo sớm | F6, F3, F11 |
| P2 — Chuyên viên phòng Đào tạo, Công tác SV | Report Viewer | Tra cứu hồ sơ trong phạm vi, xuất báo cáo | F3, F6 |
| P3 — Chuyên viên phân tích | BI Analyst | Dựng dashboard, định nghĩa chỉ số chuẩn | F6, F10 |
| P4 — Chuyên viên quản trị dữ liệu, DPO | Data Steward | Chất lượng, phân loại, đối soát, duyệt quyền | F3, F4, F5 |
| P5 — Kỹ sư dữ liệu | Data Engineer | Kết nối nguồn, vận hành pipeline | F2, F12 |
| P6 — Quản trị hệ thống | Platform Admin | Người dùng, chính sách, kiểm toán | F5, F8 |

**Kịch bản điển hình (P1):** TS. Minh, Phó trưởng khoa CNTT, chuẩn bị họp giao ban học kỳ. TS. Minh mở dashboard “Tổng quan đào tạo” → lọc năm học 2025–2026 → thấy tỉ lệ cảnh báo học vụ khóa K66 tăng → drill-down tới lớp → mở hồ sơ 360° một sinh viên để xem học tập và học phí → tab Tài chính bị khóa, gửi yêu cầu quyền có mục đích → hỏi trợ lý “So sánh tỉ lệ cảnh báo học vụ giữa các khóa” để đưa vào biên bản.

## 5. Phạm vi

### Trong MVP

- Nguồn mẫu do **mock source** cung cấp (API + CSDL Postgres): SIS (sinh viên, đăng ký học phần), HRM (cán bộ, giảng viên), FIN (học phí), LMS (hoạt động học tập). Dữ liệu tổng hợp, không có dữ liệu thật.
- 5 vai trò: Platform Admin, Data Engineer, Data Steward, BI Analyst, Report Viewer.
- Hồ sơ 360° cho 3 loại đối tượng; một người có thể mang nhiều vai trò.
- F1–F6 và F12.

### Nâng cao

F7 Lineage, F8 Phân quyền dòng/cột, F9 Bất thường, F10 Semantic model và báo cáo tự động, F11 Trợ lý hỏi-đáp.

### Ngoài phạm vi

Chủ thể dữ liệu (sinh viên, giảng viên) tự đăng nhập xem hồ sơ của mình; ghi ngược về hệ thống nguồn; streaming thời gian thực cho dashboard; mô hình dự báo bỏ học; ứng dụng di động riêng.

## 6. Ràng buộc và giả định

| Loại | Nội dung |
| --- | --- |
| Công nghệ | Backend Python, FastAPI, Celery; Frontend Angular 19 standalone; PostgreSQL 18; MinIO; Parquet + Iceberg (JDBC catalog trên PostgreSQL); Airbyte, dlt; Debezium + Kafka; Trino; dbt-trino; Dagster; dbt tests + Soda Core; Metabase; Loki, Grafana, Prometheus, Tempo; Docker Compose |
| Quản lý mã nguồn Python | uv, mỗi service có `pyproject.toml` và `uv.lock` |
| Hạ tầng | Một PostgreSQL dùng chung, tách database theo vai trò; một `compose.yaml` chia nhóm bằng profiles; chạy được trên máy phát triển |
| Pháp lý | Xử lý dữ liệu cá nhân theo quy định hiện hành của Việt Nam; cần pháp chế rà soát trước khi kết nối nguồn thật |
| Dữ liệu | Môi trường phát triển và demo chỉ dùng dữ liệu tổng hợp |
| Kiến trúc | Không gọi hệ thống nguồn trong luồng request của người dùng; mọi dữ liệu đi qua pipeline vào Lakehouse |
| Giả định | Mỗi nguồn có owner nghiệp vụ và văn bản cho phép chia sẻ; SSO của trường hỗ trợ OIDC |

## 7. Rủi ro chính (tóm tắt)

Gộp nhầm hai người · tái định danh qua số liệu nhóm nhỏ · trợ lý AI trả lời sai hoặc vượt quyền · quản trị viên kỹ thuật có quyền quá rộng · công cụ BI dùng tài khoản dịch vụ làm mất danh tính người xem · tải hạ tầng vượt khả năng máy phát triển. Chi tiết và cách xử lý: [README §1.9](../README.md#19-giả-định-ràng-buộc-và-rủi-ro).

## 8. Câu hỏi mở cần chốt

1. **Metabase và BR11.** Metabase kết nối Trino bằng một tài khoản dịch vụ, nên mọi người xem cùng thấy một tập dữ liệu. Đề xuất: Metabase chỉ phục vụ phân tích tổng hợp trên mart không có dữ liệu cá nhân; màn hình chứa dữ liệu cá nhân (hồ sơ, bảng chi tiết) đi qua Semantic Service của Platform API để truy vấn dưới danh tính người dùng.
2. **Ngưỡng đối soát danh tính** (0,95 tự gộp; 0,75–0,95 chờ duyệt) cần hiệu chỉnh trên bộ mẫu có nhãn.
3. **Airbyte hay chỉ dlt.** Airbyte bản mã nguồn mở chạy qua `abctl` trên Kubernetes, nặng hơn phần còn lại của stack. Đề xuất: dlt cho MVP, Airbyte cho nguồn có connector sẵn khi triển khai thật.
4. **Nhà cung cấp LLM** và chính sách dữ liệu được gửi ra ngoài (chỉ schema metric và kết quả tổng hợp).
5. **IdP:** SSO của trường đã hỗ trợ OIDC chưa, hay cần Keycloak làm trung gian.
6. **Thời hạn lưu audit log** và quy trình đáp ứng yêu cầu của chủ thể dữ liệu.
