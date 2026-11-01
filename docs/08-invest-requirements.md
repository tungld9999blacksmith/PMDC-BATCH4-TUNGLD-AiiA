# 08 — User stories theo INVEST

Backlog gồm **40 user story**: 30 story cơ bản (MVP) và 10 story nâng cao. Mỗi story được kiểm tra INVEST trước khi vào sprint và có tiêu chí chấp nhận tại [06-acceptance-criteria.md](06-acceptance-criteria.md).

## 1. Tiêu chí INVEST áp dụng cho AiiA

| Tiêu chí | Ý nghĩa trong dự án |
| --- | --- |
| **I**ndependent | Story giao được giá trị riêng; phụ thuộc chỉ khi bắt buộc (ví dụ cần dữ liệu Silver hoặc cần vai trò đã gán) và được ghi rõ ở cột Phụ thuộc |
| **N**egotiable | Bố cục, thuật toán khớp danh tính, mô hình LLM, công cụ BI có thể đổi, miễn giữ nguyên “đúng người, đúng mục đích, có nguồn gốc” |
| **V**aluable | Mang lại giá trị cho người dùng báo cáo (hiểu, quyết định), cho đội dữ liệu (chất lượng, vận hành) hoặc cho tuân thủ (kiểm soát, giải trình) |
| **E**stimable | Đã rõ vai trò, đầu vào, đầu ra, API, bảng dữ liệu, trường hợp lỗi và phân quyền |
| **S**mall | Một năng lực chính, chia được thành task UI / API / pipeline / test trong ≤ 1 sprint (2 tuần); story 13 SP phải tách |
| **T**estable | Có tiêu chí Given–When–Then quan sát được, gồm cả trường hợp bị khóa, vượt quyền và dữ liệu lỗi |

## 2. Nhóm story

```text
US01–US03   Tài khoản và quyền của tôi
US04–US09   Tích hợp dữ liệu (nguồn, upload, lịch, giám sát, mapping, xem trước)
US10–US16   Hồ sơ 360° (đối soát, tìm kiếm, hồ sơ SV/GV/CB, timeline, nguồn gốc)
US17–US20   Chất lượng dữ liệu
US21–US25   Quản trị dữ liệu (catalog, phân loại, cấp quyền, người dùng, audit)
US26–US30   BI và báo cáo
US31–US40   Nâng cao (lineage, phân quyền chi tiết, bất thường, semantic, báo cáo tự động, trợ lý)
```

## 3. Backlog

Ưu tiên MoSCoW: **Must** = bắt buộc của yêu cầu cơ bản; **Should** = nâng cao trọng tâm của đề bài; **Could** = nâng cao bổ trợ. Ước lượng theo story point (SP, dãy Fibonacci).

| ID | User story | Ưu tiên | SP | Phụ thuộc |
| --- | --- | --- | --- | --- |
| US01 | Là **người dùng nội bộ**, tôi muốn **đăng nhập bằng SSO của trường** để dùng các chức năng được cấp quyền. | Must | 3 | — |
| US02 | Là **người đã đăng nhập**, tôi muốn **đăng xuất** để kết thúc phiên trên thiết bị. | Must | 1 | US01 |
| US03 | Là **người đã đăng nhập**, tôi muốn **xem vai trò, phạm vi đơn vị và quyền còn hạn** để biết mình được xem dữ liệu nào. | Must | 3 | US01, US24 |
| US04 | Là **kỹ sư dữ liệu**, tôi muốn **đăng ký nguồn kèm mục đích và căn cứ cho phép** để chỉ dữ liệu hợp lệ vào nền tảng. | Must | 5 | — |
| US05 | Là **kỹ sư dữ liệu**, tôi muốn **upload CSV/Excel theo mẫu** để ingest nhanh từ hệ thống chưa có kết nối. | Must | 5 | US04 |
| US06 | Là **kỹ sư dữ liệu**, tôi muốn **lập lịch ingest định kỳ** để dữ liệu tự cập nhật. | Must | 3 | US04 |
| US07 | Là **kỹ sư dữ liệu**, tôi muốn **theo dõi và chạy lại các lần ingest** để khắc phục lỗi kịp thời. | Must | 5 | US04 |
| US08 | Là **kỹ sư dữ liệu**, tôi muốn **ánh xạ cột nguồn vào mô hình chuẩn** để dữ liệu nhiều nguồn có cùng cấu trúc. | Must | 8 | US05 |
| US09 | Là **kỹ sư dữ liệu**, tôi muốn **xem trước dữ liệu theo lớp Bronze/Silver/Gold** để kiểm tra kết quả biến đổi. | Should | 3 | US08 |
| US10 | Là **chuyên viên quản trị dữ liệu**, tôi muốn **duyệt cặp bản ghi nghi trùng** để mỗi người thật chỉ có một hồ sơ. | Must | 8 | US08 |
| US11 | Là **người dùng báo cáo**, tôi muốn **tìm hồ sơ theo mã, tên không dấu, email, đơn vị** để tra cứu nhanh một người. | Must | 5 | US10, US24 |
| US12 | Là **người dùng báo cáo**, tôi muốn **xem hồ sơ 360° sinh viên** để nắm tình hình học tập, tài chính, rèn luyện, hoạt động. | Must | 8 | US11 |
| US13 | Là **người dùng báo cáo**, tôi muốn **xem hồ sơ 360° giảng viên** để đánh giá giảng dạy và nghiên cứu. | Must | 5 | US11 |
| US14 | Là **người dùng báo cáo**, tôi muốn **xem hồ sơ 360° cán bộ** để nắm thông tin nhân sự và quá trình phát triển. | Must | 5 | US11 |
| US15 | Là **người dùng báo cáo**, tôi muốn **xem dòng thời gian sự kiện của hồ sơ** để hiểu diễn biến theo thời gian. | Should | 3 | US12 |
| US16 | Là **người dùng báo cáo**, tôi muốn **biết mỗi thông tin đến từ nguồn nào, cập nhật khi nào** để đánh giá độ tin cậy. | Must | 5 | US10 |
| US17 | Là **chuyên viên quản trị dữ liệu**, tôi muốn **định nghĩa quy tắc chất lượng cho dataset** để phát hiện dữ liệu sai, thiếu, trùng. | Must | 5 | US21 |
| US18 | Là **hệ thống**, tôi muốn **kiểm tra chất lượng sau mỗi ingest và cách ly bản ghi lỗi** để dữ liệu sai không vào lớp phân tích. | Must | 8 | US07, US17 |
| US19 | Là **chuyên viên quản trị dữ liệu**, tôi muốn **xem điểm chất lượng theo dataset, nguồn, chiều** để ưu tiên khắc phục. | Should | 5 | US18 |
| US20 | Là **chuyên viên quản trị dữ liệu**, tôi muốn **xử lý issue chất lượng tới khi đóng** để theo dõi việc khắc phục. | Must | 5 | US18 |
| US21 | Là **người dùng**, tôi muốn **tìm dataset trong catalog** để biết dữ liệu nào đang có, ai sở hữu, ý nghĩa ra sao. | Must | 5 | US08 |
| US22 | Là **chuyên viên quản trị dữ liệu**, tôi muốn **gắn mức nhạy cảm cho cột và định nghĩa thuật ngữ** để dữ liệu được bảo vệ và hiểu thống nhất. | Must | 5 | US21 |
| US23 | Là **người dùng báo cáo**, tôi muốn **yêu cầu quyền có mục đích và thời hạn, được Steward duyệt** để truy cập có kiểm soát. | Must | 8 | US22, US24 |
| US24 | Là **quản trị hệ thống**, tôi muốn **quản lý người dùng, vai trò và phạm vi đơn vị** để kiểm soát ai dùng nền tảng. | Must | 5 | US01 |
| US25 | Là **quản trị hệ thống**, tôi muốn **xem nhật ký kiểm toán truy cập dữ liệu nhạy cảm** để giải trình khi có sự cố. | Must | 3 | US01 |
| US26 | Là **người dùng báo cáo**, tôi muốn **xem danh sách dashboard được chia sẻ cho mình** để chọn báo cáo cần dùng. | Must | 2 | US30 |
| US27 | Là **người dùng báo cáo**, tôi muốn **lọc và drill-down trên dashboard** để phân tích theo năm học, khoa, ngành. | Must | 8 | US26 |
| US28 | Là **chuyên viên phân tích**, tôi muốn **tạo và sửa dashboard từ dataset Gold** để phục vụ nhu cầu báo cáo mới. | Must | 13 | US21 |
| US29 | Là **người dùng báo cáo**, tôi muốn **xuất dashboard ra PDF/CSV** để dùng trong cuộc họp. | Should | 5 | US27 |
| US30 | Là **chuyên viên phân tích**, tôi muốn **publish và chia sẻ dashboard theo vai trò, đơn vị** để người cần dùng truy cập được. | Must | 3 | US28 |
| US31 | Là **chuyên viên quản trị dữ liệu**, tôi muốn **xem lineage từ nguồn tới dashboard** để biết số liệu được tạo ra thế nào. | Should | 8 | US08, US21 |
| US32 | Là **kỹ sư dữ liệu**, tôi muốn **xem thành phần phía sau bị ảnh hưởng trước khi đổi mapping** để không làm hỏng báo cáo. | Could | 5 | US31 |
| US33 | Là **quản trị hệ thống**, tôi muốn **cấu hình chính sách theo dòng và cột** để mỗi người chỉ thấy đúng phần dữ liệu được phép. | Should | 13 | US22, US24 |
| US34 | Là **hệ thống**, tôi muốn **phát hiện bất thường về khối lượng, độ mới, chỉ số** để cảnh báo sớm sự cố. | Should | 8 | US07 |
| US35 | Là **chuyên viên quản trị dữ liệu**, tôi muốn **xác nhận và đóng cảnh báo** để biết sự cố đã được xử lý. | Should | 3 | US34 |
| US36 | Là **chuyên viên phân tích**, tôi muốn **định nghĩa metric và dimension chuẩn** để mọi báo cáo dùng một định nghĩa. | Should | 8 | US21 |
| US37 | Là **người dùng báo cáo**, tôi muốn **đăng ký nhận báo cáo định kỳ qua email** để không phải vào hệ thống mỗi tuần. | Could | 5 | US30 |
| US38 | Là **hệ thống**, tôi muốn **gửi báo cáo định kỳ kèm tóm tắt tiếng Việt** để người đọc nắm nhanh điểm chính. | Could | 5 | US37 |
| US39 | Là **người dùng báo cáo**, tôi muốn **hỏi bằng tiếng Việt và nhận câu trả lời kèm biểu đồ, chỉ số, nguồn trên dữ liệu được cấp quyền** để có câu trả lời nhanh mà không cần biết SQL. | Should | 13 | US33, US36 |
| US40 | Là **quản trị hệ thống**, tôi muốn **xem nhật ký hỏi-đáp và cấu hình chủ đề bị chặn** để trợ lý không bị lạm dụng. | Should | 3 | US39 |

**Tổng:** 226 SP — MVP (US01–US30) 155 SP · Nâng cao (US31–US40) 71 SP. Must: 26 story · Should: 11 story · Could: 3 story.

Thứ tự triển khai gợi ý theo phụ thuộc:

```text
Sprint 1  US01 US24 US02 US03 US25 US04 US06 US07          tài khoản, nguồn, lịch, giám sát
Sprint 2  US05 US08 US21 US22 US09                          upload, mapping, catalog, phân loại
Sprint 3  US17 US18 US20 US19 US10 US16                     chất lượng, đối soát, nguồn gốc
Sprint 4  US11 US12 US13 US14 US15 US23                     hồ sơ 360°, cấp quyền
Sprint 5  US28 US30 US26 US27 US29                          BI
Sprint 6+ US31–US40                                          nâng cao
```

## 4. Kiểm tra INVEST chi tiết

| ID | I | N | V | E | S | T | Ghi chú tách nhỏ / rủi ro |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US01 | ✅ | ✅ | ✅ | ⚠ | ✅ | ✅ | Phụ thuộc câu hỏi mở IdP (OIDC trực tiếp hay Keycloak) |
| US02 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US03 | ⚠ | ✅ | ✅ | ✅ | ✅ | ✅ | Cần dữ liệu vai trò từ US24; có thể seed thủ công |
| US04 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US05 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US06 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US07 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Đã có skeleton job Dagster |
| US08 | ✅ | ✅ | ✅ | ⚠ | ✅ | ✅ | Mô hình chuẩn Silver cần chốt cho từng nguồn |
| US09 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US10 | ⚠ | ✅ | ✅ | ⚠ | ⚠ | ✅ | 8 SP — tách: (a) khớp tự động, (b) hàng đợi và quyết định, (c) tách hồ sơ. Ngưỡng cần hiệu chỉnh |
| US11 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US12 | ⚠ | ✅ | ✅ | ✅ | ⚠ | ✅ | 8 SP — tách theo tab: Tổng quan + Học tập trước, Tài chính/Rèn luyện/Hoạt động sau |
| US13 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Dùng lại khung của US12 |
| US14 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Dùng lại khung của US12 |
| US15 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US16 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US17 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US18 | ⚠ | ✅ | ✅ | ✅ | ⚠ | ✅ | 8 SP — tách: (a) chạy Soda/dbt tests, (b) quarantine và issue. Đã có skeleton Soda cho bronze |
| US19 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US20 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US21 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US22 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US23 | ⚠ | ✅ | ✅ | ✅ | ⚠ | ✅ | 8 SP — tách: (a) gửi và duyệt yêu cầu, (b) hết hạn tự động và áp quyền tại Trino |
| US24 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US25 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US26 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US27 | ✅ | ⚠ | ✅ | ⚠ | ✅ | ✅ | Phụ thuộc quyết định Metabase vs Semantic Service ([01 §8](01-scope.md#8-câu-hỏi-mở-cần-chốt)) |
| US28 | ✅ | ⚠ | ✅ | ⚠ | ❌ | ✅ | 13 SP — tách: (a) canvas và layout, (b) thuộc tính widget, (c) xem trước và lưu. Có thể thay bằng Metabase |
| US29 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US30 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US31 | ⚠ | ✅ | ✅ | ✅ | ✅ | ✅ | Lấy lineage từ dbt manifest và asset graph Dagster |
| US32 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US33 | ⚠ | ✅ | ✅ | ⚠ | ❌ | ✅ | 13 SP — tách: (a) row filter, (b) column mask, (c) mô phỏng và phiên bản |
| US34 | ✅ | ✅ | ✅ | ✅ | ⚠ | ✅ | Bắt đầu với VOLUME và FRESHNESS; METRIC_DRIFT sau |
| US35 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US36 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US37 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US38 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| US39 | ⚠ | ✅ | ✅ | ⚠ | ❌ | ✅ | 13 SP — tách: (a) guardrail và chủ đề chặn, (b) planner sinh `SemanticQuery`, (c) diễn giải và SSE. Cần benchmark ≥ 60 câu |
| US40 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |

✅ đạt · ⚠ có phụ thuộc hoặc điểm chưa chốt đã ghi rõ · ❌ phải tách trước khi vào sprint.

## 5. Story sau phạm vi hiện tại (Icebox)

| ID | Story |
| --- | --- |
| US41 | Là sinh viên, tôi muốn xem hồ sơ của chính mình và nguồn của từng thông tin, để kiểm tra và yêu cầu sửa sai. |
| US42 | Là chuyên viên quản trị dữ liệu, tôi muốn gửi yêu cầu sửa dữ liệu về hệ thống nguồn từ issue chất lượng, để sửa tận gốc. |
| US43 | Là lãnh đạo khoa, tôi muốn nhận danh sách sinh viên có nguy cơ bỏ học từ mô hình dự báo có giải thích, để can thiệp sớm. |
| US44 | Là người dùng báo cáo, tôi muốn xem dashboard trên ứng dụng di động có thông báo đẩy. |
| US45 | Là kỹ sư dữ liệu, tôi muốn dashboard vận hành cập nhật gần thời gian thực từ luồng CDC. |
