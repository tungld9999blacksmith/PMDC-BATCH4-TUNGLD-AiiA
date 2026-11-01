"""Secret store cho mật khẩu/token kết nối nguồn — không bao giờ lưu trong CSDL (data_sources.secret_ref).

Bản cài đặt này ghi file quyền 0600 dưới AIIA_SECRET_STORE_DIR (volume riêng). Môi trường thật
thay bằng Vault/Secrets Manager với cùng giao diện `put`/`get`.
"""

import os
import re
from functools import lru_cache
from pathlib import Path

from app.core.config import settings


class FileSecretStore:
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()

    def _path(self, ref: str) -> Path:
        name = ref.removeprefix("file:")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise ValueError("secret_ref không hợp lệ")
        return self.root / name

    def put(self, name: str, value: str) -> str:
        self.root.mkdir(parents=True, exist_ok=True)
        ref = f"file:{name}"
        path = self._path(ref)
        path.write_text(value, encoding="utf-8")
        os.chmod(path, 0o600)
        return ref

    def get(self, ref: str) -> str | None:
        path = self._path(ref)
        return path.read_text(encoding="utf-8") if path.exists() else None


@lru_cache
def get_secret_store() -> FileSecretStore:
    return FileSecretStore(settings.secret_store_dir)
