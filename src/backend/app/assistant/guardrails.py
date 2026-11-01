"""Kiểm tra câu hỏi trước khi lập kế hoạch truy vấn (BR16): chủ đề bị chặn, yêu cầu dữ liệu dòng RESTRICTED."""

import re

from app.assistant.text import fold

# Câu hỏi đòi định danh/chi tiết cá nhân nhạy cảm — trợ lý chỉ trả số liệu tổng hợp.
RESTRICTED_PATTERNS = [
    r"\b(cccd|cmnd|can cuoc|so dinh danh|ho chieu)\b",
    r"\b(so dien thoai|sdt|dia chi nha|ngay sinh)\b.*\b(cua|sinh vien|giang vien|can bo)\b",
    r"\bdanh sach\b.*\b(ho ten|ten|ma sinh vien|ma sv|email)\b",
    r"\b(luong|thu nhap)\b.*\b(cua|ong|ba|anh|chi)\b",
]


def blocked_topic(question: str, patterns: list[str]) -> str | None:
    """Trả về mẫu chủ đề bị chặn khớp với câu hỏi (so khớp không phân biệt hoa thường và dấu)."""
    text = fold(question)
    for pattern in patterns:
        try:
            if re.search(fold(pattern), text):
                return pattern
        except re.error:
            if fold(pattern) in text:
                return pattern
    return None


def asks_restricted_detail(question: str) -> bool:
    text = fold(question)
    return any(re.search(p, text) for p in RESTRICTED_PATTERNS)
