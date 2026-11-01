# 06 — Tiêu chí chấp nhận (Given – When – Then)

Mỗi tiêu chí có mã `ACxx.y`, chi tiết hóa tiêu chí `ACxx` trong [README §2.3.5](../README.md#235-acceptance-criteria-ac--tiêu-chí-chấp-nhận) và ánh xạ tới user story `USxx` trong [08-invest-requirements.md](08-invest-requirements.md). Truy vết đầy đủ: [07-traceability.md](07-traceability.md).

## Tài khoản và quyền

**US01 — Đăng nhập SSO**
- AC01.1 *Given* tài khoản `ACTIVE` có ít nhất một vai trò, *when* tôi đăng nhập qua SSO, *then* hệ thống tạo phiên và đưa tôi về trang đang mở trước đó, hoặc P02 nếu không có.
- AC01.2 *Given* tài khoản `INACTIVE` hoặc chưa có vai trò, *when* tôi đăng nhập, *then* tôi thấy thông báo lý do ở P01 và không có phiên nào được tạo.

**US02 — Đăng xuất**
- AC02.1 *When* tôi đăng xuất, *then* phiên bị thu hồi và mọi trang bảo vệ chuyển về P01.

**US03 — Quyền của tôi**
- AC03.1 *Given* tôi có quyền dataset còn hạn, *when* mở P03, *then* tôi thấy vai trò, đơn vị, danh sách quyền kèm ngày hết hạn và người duyệt.
- AC03.2 Quyền đã hết hạn hoặc bị thu hồi không xuất hiện; tôi không sửa được vai trò của mình.

## Tích hợp dữ liệu

**US04 — Đăng ký nguồn**
- AC04.1 *Given* form thiếu mục đích hoặc căn cứ cho phép, *when* tôi lưu, *then* nhận 422 chỉ đúng trường thiếu.
- AC04.2 *Given* nguồn JDBC/API, *when* kiểm tra kết nối thất bại, *then* nguồn giữ `DRAFT`; chỉ chuyển `ACTIVE` sau khi kiểm tra thành công.

**US05 — Upload file**
- AC05.1 *Given* file XLSX 60 MB, *when* upload, *then* nhận 413 và không tạo batch.
- AC05.2 *Given* header thiếu cột bắt buộc, *then* nhận 422 liệt kê cột thiếu.
- AC05.3 *Given* file hợp lệ, *then* thấy 20 dòng xem trước; *given* checksum đã từng ingest, *then* thấy cảnh báo trùng và chỉ ingest khi xác nhận.

**US06 — Lập lịch**
- AC06.1 *When* lưu cron hợp lệ, *then* thấy thời điểm chạy kế tiếp; cron sai cú pháp bị từ chối.
- AC06.2 *When* tạm dừng lịch, *then* không có run `SCHEDULE` mới cho tới khi tiếp tục.

**US07 — Giám sát và chạy lại**
- AC07.1 Mỗi run hiển thị trạng thái, số dòng đọc/ghi/cách ly, thời lượng; log cập nhật trực tiếp khi run đang chạy.
- AC07.2 *Given* run `FAILED`, *when* chạy lại hai lần, *then* số dòng Silver không đổi so với một lần chạy thành công (BR14).

**US08 — Ánh xạ schema**
- AC08.1 *Given* trường bắt buộc của mô hình chuẩn chưa được ánh xạ, *then* không lưu được mapping.
- AC08.2 *When* lưu mapping, *then* tạo phiên bản mới, phiên bản cũ vẫn xem được; chỉ một phiên bản đang dùng.

**US09 — Xem trước dữ liệu**
- AC09.1 Xem trước tối đa 100 dòng; cột `RESTRICTED` hiển thị dạng che với người không có quyền.
- AC09.2 Mỗi lần xem trước tạo một bản ghi audit.

## Hồ sơ 360°

**US10 — Đối soát danh tính**
- AC10.1 *Given* cặp điểm 0,88, *then* cặp nằm trong hàng đợi; trường CCCD chỉ hiển thị “khớp” hoặc “không khớp”.
- AC10.2 *When* Gộp, *then* hai bản ghi về một `person_id`; *when* Tách, *then* trở lại hai hồ sơ ban đầu.
- AC10.3 *Given* cặp điểm 0,97, *then* gộp tự động và vẫn có lịch sử để tách.

**US11 — Tìm kiếm hồ sơ**
- AC11.1 *When* gõ “nguyen van an” (không dấu), *then* kết quả có “Nguyễn Văn An” trong phạm vi quyền.
- AC11.2 *Given* hồ sơ thuộc khoa ngoài phạm vi, *when* tìm đúng mã, *then* thấy “Không tìm thấy” giống hệt hồ sơ không tồn tại.

**US12–US14 — Hồ sơ SV, GV, CB**
- AC12.1 Hồ sơ SV có đủ 6 tab; mỗi tab hiển thị nguồn và thời điểm cập nhật.
- AC12.2 *Given* tôi không có quyền tab Tài chính, *then* tab hiển thị 🔒 và nút “Yêu cầu quyền”, không có số liệu.
- AC13.1 Hồ sơ GV có 4 tab Tổng quan, Giảng dạy, Nghiên cứu, Đánh giá; điểm đánh giá của học phần có < 5 phản hồi hiển thị “< 5”.
- AC14.1 *Given* người vừa là cán bộ vừa là sinh viên, *then* có bộ chuyển vai trò, hai vai trò cùng một `person_id`.
- AC14.2 Mỗi lần mở hồ sơ tạo audit `PROFILE_VIEW`.

**US15 — Dòng thời gian**
- AC15.1 Sự kiện sắp xếp mới nhất trước, lọc được theo loại và nguồn, tải thêm theo trang.
- AC15.2 Sự kiện thuộc facet tôi không có quyền không xuất hiện.

**US16 — Nguồn gốc thuộc tính**
- AC16.1 *When* nhấn biểu tượng nguồn cạnh email, *then* drawer hiển thị hệ thống nguồn thắng, thời điểm, quy tắc ưu tiên.
- AC16.2 *Given* các nguồn mâu thuẫn và tôi đủ quyền, *then* thấy giá trị từ từng nguồn.

## Chất lượng dữ liệu

**US17 — Quy tắc DQ**
- AC17.1 *Given* quy tắc chưa chạy thử ở phiên bản hiện tại, *when* kích hoạt, *then* nhận 409.
- AC17.2 *When* chạy thử, *then* thấy số bản ghi được đánh giá, số vi phạm và mẫu vi phạm (đã che theo quyền).

**US18 — Kiểm tra tự động và cách ly**
- AC18.1 *Given* quy tắc `BLOCKING` “GPA trong [0, 4]” và 3 bản ghi GPA = 5, *when* run hoàn tất, *then* run `PARTIAL`, 3 bản ghi ở quarantine, không có trong Silver/Gold.
- AC18.2 Vi phạm `WARNING` vẫn vào Silver và tạo hoặc cập nhật một issue.

**US19 — Điểm DQ**
- AC19.1 Điểm = tỉ lệ bản ghi đạt, hiển thị theo 5 chiều và xu hướng 30 ngày; nhấn vào điểm mở danh sách quy tắc liên quan.

**US20 — Xử lý issue**
- AC20.1 Issue chuyển `OPEN → IN_PROGRESS → RESOLVED`; `resolved_at` có giá trị khi và chỉ khi issue đã đóng.
- AC20.2 *When* xử lý lại quarantine sau khi sửa, *then* bản ghi đạt được đưa vào Silver và issue đóng.

## Quản trị dữ liệu

**US21 — Catalog**
- AC21.1 Dataset chưa có quyền vẫn hiện mô tả, schema, owner kèm nút “Yêu cầu quyền”, không có dữ liệu.

**US22 — Phân loại và glossary**
- AC22.1 *When* Steward đổi cột `email` thành `CONFIDENTIAL`, *then* truy vấn kế tiếp của người không đủ quyền nhận giá trị che.
- AC22.2 Cột mới chưa phân loại mặc định `CONFIDENTIAL` (BR07).

**US23 — Yêu cầu và duyệt quyền**
- AC23.1 *Given* thời hạn 200 ngày, *then* nhận 422.
- AC23.2 *Given* Steward là người yêu cầu, *when* duyệt, *then* bị chặn.
- AC23.3 *When* được duyệt, *then* người yêu cầu nhận thông báo và dữ liệu mở khóa ở lần tải sau.
- AC23.4 *Given* quyền quá `valid_to`, *when* job hết hạn chạy, *then* yêu cầu `EXPIRED` và dữ liệu khóa lại.

**US24 — Người dùng và vai trò**
- AC24.1 *When* gỡ `PLATFORM_ADMIN` của Admin cuối cùng, *then* nhận 409.
- AC24.2 *When* khóa tài khoản, *then* lần gọi API kế tiếp của người đó nhận 401.

**US25 — Audit log**
- AC25.1 Lọc được theo người, hành động, đối tượng, thời gian; không có thao tác sửa/xóa.
- AC25.2 *Given* lệnh `UPDATE audit_logs` trực tiếp trong CSDL, *then* bị trigger từ chối.

## BI và báo cáo

**US26 — Thư viện dashboard**
- AC26.1 Chỉ liệt kê dashboard đã chia sẻ cho tôi (theo vai trò, đơn vị hoặc cá nhân) và dashboard nháp của chính tôi.

**US27 — Lọc và drill-down**
- AC27.1 *Given* hai người xem cùng dashboard, một ở khoa CNTT và một ở toàn trường, *then* số liệu khác nhau theo phạm vi (BR11).
- AC27.2 *When* nhấn cột “Khoa CNTT”, *then* biểu đồ chuyển sang cấp ngành và breadcrumb cập nhật; trạng thái lọc nằm trên URL.
- AC27.3 Ô có nhóm < 5 người hiển thị “< 5”.

**US28 — Thiết kế dashboard**
- AC28.1 Dashboard nháp không xuất hiện với người khác; rời trang khi chưa lưu có cảnh báo.
- AC28.2 *Given* phiên khác đã lưu trước, *when* tôi lưu, *then* nhận 412 và không ghi đè.

**US29 — Export**
- AC29.1 Tệp xuất có watermark người xuất và thời điểm; cột `RESTRICTED` bị loại và liệt kê trong `excludedColumns`.
- AC29.2 Mỗi lần export tạo audit `EXPORT`.

**US30 — Publish và chia sẻ**
- AC30.1 *When* publish, *then* trạng thái `PUBLISHED` và `published_at` có giá trị; người được chia sẻ thấy trong thư viện.

## Nâng cao

**US31 — Lineage**
- AC31.1 *Given* dataset `dim_student`, *then* đồ thị hiển thị nguồn SIS → Bronze → Silver → `dim_student` → metric → dashboard.

**US32 — Phân tích tác động**
- AC32.1 *Given* mapping SIS sắp đổi, *when* xem trước, *then* thấy danh sách dataset, metric, dashboard phía sau và phải xác nhận trước khi lưu.

**US33 — Chính sách dòng/cột**
- AC33.1 *When* mô phỏng “xem như” trưởng khoa KT, *then* chỉ thấy dòng khoa KT và số dòng hiển thị khác tổng.
- AC33.2 Mỗi lần lưu tạo phiên bản mới; khôi phục bằng cách lưu lại nội dung phiên bản cũ.

**US34 — Phát hiện bất thường**
- AC34.1 *Given* 4 lần chạy gần nhất trung bình 2.000 dòng, *when* lần chạy mới có 900 dòng, *then* tạo cảnh báo `VOLUME` kèm giá trị kỳ vọng và thực tế.

**US35 — Xử lý cảnh báo**
- AC35.1 *When* xác nhận, *then* ghi người và thời điểm; chuyển `RESOLVED` hoặc `DISMISSED` phải có `closed_at`.
- AC35.2 Chuyển trạng thái không hợp lệ (ví dụ `RESOLVED → OPEN`) nhận 409.

**US36 — Semantic model**
- AC36.1 Công thức sai cú pháp bị từ chối ở bước kiểm tra; sửa metric `CERTIFIED` đưa nó về `DRAFT`.

**US37 — Đăng ký báo cáo**
- AC37.1 Chỉ chọn được người nhận nội bộ; tạm dừng thì không có lần gửi mới.

**US38 — Báo cáo tự động**
- AC38.1 *Given* người nhận đã mất quyền dashboard, *then* lần gửi ghi `SKIPPED_NO_ACCESS` và không gửi email.
- AC38.2 Tóm tắt có nhãn “Do AI tạo”; khi sinh tóm tắt lỗi, báo cáo vẫn được gửi không kèm tóm tắt.

**US39 — Trợ lý hỏi-đáp**
- AC39.1 *Given* câu hỏi trong quyền, *then* câu trả lời có `metricCodes`, bộ lọc, `dataAsOf` và nút “Xem truy vấn”.
- AC39.2 *Given* bộ câu hỏi vượt quyền trong benchmark, *then* 100% được từ chối với `OUT_OF_SCOPE` và không lộ số liệu.
- AC39.3 *Given* “Liệt kê CCCD sinh viên khoa CNTT”, *then* từ chối với `RESTRICTED_DETAIL` hoặc `BLOCKED_TOPIC`.
- AC39.4 Prompt gửi tới LLM chỉ gồm danh mục metric và kết quả tổng hợp, không có dữ liệu dòng (kiểm tra bằng log trong CI).

**US40 — Nhật ký và chủ đề chặn**
- AC40.1 *When* Admin thêm chủ đề “bệnh án”, *then* câu hỏi chứa “bệnh án” bị từ chối `BLOCKED_TOPIC` ngay lượt kế tiếp.
- AC40.2 Nhật ký hiển thị câu hỏi, truy vấn sinh ra, kết quả và phản hồi; lọc được theo trạng thái và người hỏi.
