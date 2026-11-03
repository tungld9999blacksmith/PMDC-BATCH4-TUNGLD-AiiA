"""Chuẩn hóa văn bản tiếng Việt để so khớp (bỏ dấu, chữ thường)."""

import re
import unicodedata


def fold(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower()).replace("đ", "d")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", text).strip()


def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9_]+", fold(text)) if len(t) > 1}
