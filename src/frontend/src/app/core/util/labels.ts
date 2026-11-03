/** Nhãn tiếng Việt cho các mã trong hợp đồng API. */

export const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Quản trị hệ thống',
  DATA_ENGINEER: 'Kỹ sư dữ liệu',
  DATA_STEWARD: 'Quản trị dữ liệu',
  BI_ANALYST: 'Chuyên viên phân tích',
  REPORT_VIEWER: 'Người dùng báo cáo',
};

export const SUBJECT_LABELS: Record<string, string> = {
  STUDENT: 'Sinh viên',
  LECTURER: 'Giảng viên',
  STAFF: 'Cán bộ',
};

export const FACET_LABELS: Record<string, string> = {
  OVERVIEW: 'Tổng quan',
  ACADEMIC: 'Học tập',
  FINANCE: 'Tài chính',
  CONDUCT: 'Rèn luyện',
  ACTIVITY: 'Hoạt động',
  OUTCOME: 'Đầu ra',
  TEACHING: 'Giảng dạy',
  RESEARCH: 'Nghiên cứu',
  EVALUATION: 'Đánh giá',
  HR: 'Nhân sự',
  DEVELOPMENT: 'Phát triển',
  RECOGNITION: 'Thi đua',
};

export const STATUS_LABELS: Record<string, string> = {
  // nguồn, run
  DRAFT: 'Nháp',
  ACTIVE: 'Đang hoạt động',
  PAUSED: 'Tạm dừng',
  ARCHIVED: 'Lưu trữ',
  QUEUED: 'Chờ chạy',
  RUNNING: 'Đang chạy',
  SUCCEEDED: 'Thành công',
  PARTIAL: 'Một phần',
  FAILED: 'Thất bại',
  // DQ
  DISABLED: 'Đã tắt',
  OPEN: 'Mở',
  IN_PROGRESS: 'Đang xử lý',
  RESOLVED: 'Đã xử lý',
  WONT_FIX: 'Không sửa',
  PASS: 'Đạt',
  FAIL: 'Không đạt',
  ERROR: 'Lỗi',
  // đối soát
  PENDING: 'Chờ duyệt',
  AUTO_MERGED: 'Tự gộp',
  MERGED: 'Đã gộp',
  REJECTED: 'Từ chối',
  UNMERGED: 'Đã tách',
  // quyền
  APPROVED: 'Đã duyệt',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn',
  REVOKED: 'Thu hồi',
  // dashboard, metric
  PUBLISHED: 'Đã chia sẻ',
  CERTIFIED: 'Chứng nhận',
  DEPRECATED: 'Ngừng dùng',
  // cảnh báo
  ACKNOWLEDGED: 'Đã ghi nhận',
  DISMISSED: 'Bỏ qua',
  // người dùng
  INACTIVE: 'Đã khóa',
  // trợ lý, báo cáo
  ANSWERED: 'Đã trả lời',
  CLARIFYING: 'Hỏi lại',
  REFUSED: 'Từ chối',
  SENT: 'Đã gửi',
  SKIPPED_NO_ACCESS: 'Bỏ qua (mất quyền)',
  // DQ issue severity
  BLOCKING: 'Chặn',
  WARNING: 'Cảnh báo',
  // audit
  ALLOW: 'Cho phép',
  DENY: 'Từ chối',
};

export const DIMENSION_LABELS: Record<string, string> = {
  COMPLETENESS: 'Đầy đủ',
  UNIQUENESS: 'Duy nhất',
  VALIDITY: 'Hợp lệ',
  CONSISTENCY: 'Nhất quán',
  TIMELINESS: 'Kịp thời',
};

export const TOPIC_LABELS: Record<string, string> = {
  TRAINING: 'Đào tạo',
  HR: 'Nhân sự',
  RESEARCH: 'Nghiên cứu',
  FINANCE: 'Tài chính',
  DATA_QUALITY: 'Chất lượng dữ liệu',
};

export const LAYER_LABELS: Record<string, string> = {
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
  QUARANTINE: 'Quarantine',
};

export const KIND_LABELS: Record<string, string> = {
  VOLUME: 'Khối lượng',
  FRESHNESS: 'Độ mới',
  METRIC_DRIFT: 'Biến động chỉ số',
};

export const NODE_LABELS: Record<string, string> = {
  SOURCE: 'Nguồn',
  DATASET: 'Dataset',
  COLUMN: 'Cột',
  METRIC: 'Metric',
  DASHBOARD: 'Dashboard',
};

export const REFUSAL_LABELS: Record<string, string> = {
  OUT_OF_SCOPE: 'Câu hỏi vượt phạm vi dữ liệu bạn được cấp quyền.',
  BLOCKED_TOPIC: 'Câu hỏi thuộc chủ đề hạn chế.',
  RESTRICTED_DETAIL: 'Không trả dữ liệu chi tiết mức RESTRICTED (định danh, thông tin nhạy cảm).',
  NO_METRIC: 'Chưa có chỉ số được chứng nhận phù hợp với câu hỏi.',
};

export function label(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return '—';
  return map[code] ?? code;
}
