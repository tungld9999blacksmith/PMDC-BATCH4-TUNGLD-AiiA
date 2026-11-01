"""Lưu file upload và file export: MinIO/S3 khi cấu hình AIIA_S3_ENDPOINT, ngược lại thư mục cục bộ."""

import hashlib
import hmac
import io
import time
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse

from app.core.config import settings


class ObjectStorage(Protocol):
    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> str: ...
    def get(self, uri: str) -> bytes: ...
    def download_url(self, uri: str, ttl: timedelta, fallback_path: str) -> str: ...


class LocalStorage:
    """Phát triển/kiểm thử: file nằm dưới AIIA_LOCAL_STORAGE_DIR, tải qua link ký HMAC có hạn."""

    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()

    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> str:
        path = self.root / bucket / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return f"local://{bucket}/{key}"

    def _path(self, uri: str) -> Path:
        parsed = urlparse(uri)
        path = (self.root / parsed.netloc / parsed.path.lstrip("/")).resolve()
        if self.root not in path.parents:
            raise ValueError("URI nằm ngoài thư mục lưu trữ")
        return path

    def get(self, uri: str) -> bytes:
        return self._path(uri).read_bytes()

    def download_url(self, uri: str, ttl: timedelta, fallback_path: str) -> str:
        expires = int(time.time() + ttl.total_seconds())
        return f"{fallback_path}?expires={expires}&sig={sign(fallback_path, expires)}"


class S3Storage:
    def __init__(self) -> None:
        from minio import Minio

        endpoint = urlparse(settings.s3_endpoint)
        self.client = Minio(
            endpoint.netloc or endpoint.path,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            secure=settings.s3_secure or endpoint.scheme == "https",
        )

    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> str:
        if not self.client.bucket_exists(bucket):
            self.client.make_bucket(bucket)
        self.client.put_object(bucket, key, io.BytesIO(data), len(data), content_type=content_type)
        return f"s3://{bucket}/{key}"

    def get(self, uri: str) -> bytes:
        parsed = urlparse(uri)
        response = self.client.get_object(parsed.netloc, parsed.path.lstrip("/"))
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    def download_url(self, uri: str, ttl: timedelta, fallback_path: str) -> str:
        parsed = urlparse(uri)
        return self.client.presigned_get_object(parsed.netloc, parsed.path.lstrip("/"), expires=ttl)


def sign(path: str, expires: int) -> str:
    return hmac.new(settings.signing_key.encode(), f"{path}|{expires}".encode(), hashlib.sha256).hexdigest()


def verify_signature(path: str, expires: int, sig: str) -> bool:
    return expires >= time.time() and hmac.compare_digest(sign(path, expires), sig)


@lru_cache
def get_storage() -> ObjectStorage:
    return S3Storage() if settings.s3_endpoint else LocalStorage(settings.local_storage_dir)
