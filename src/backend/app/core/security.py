"""Xác thực (OIDC/JWT hoặc token demo khi phát triển) và phân quyền theo vai trò.

Phân quyền ở đây chỉ là lớp vai trò. Phạm vi đơn vị, mức nhạy cảm và quyền còn hạn (BR08)
được áp trong app.services.access khi đọc dữ liệu.
"""

import hashlib
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import httpx
import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import ProblemError, forbidden, unauthorized
from app.domain.enums import RoleCode, UserStatus
from app.domain.models import User

log = logging.getLogger("aiia.security")
DEMO_PREFIX = "demo:"
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class RoleScope:
    role: RoleCode
    scope_org_unit: str | None  # mã đơn vị; None = toàn trường


@dataclass
class Principal:
    id: uuid.UUID
    email: str
    full_name: str
    org_unit_code: str | None
    roles: list[RoleScope]
    token_key: str
    token_exp: float | None = None
    ip: str | None = None
    _role_set: set[RoleCode] = field(default_factory=set, repr=False)

    def __post_init__(self) -> None:
        self._role_set = {r.role for r in self.roles}

    def has_role(self, *roles: RoleCode) -> bool:
        return any(r in self._role_set for r in roles)

    def scope_codes(self, *roles: RoleCode) -> set[str] | None:
        """Mã đơn vị trong phạm vi của các vai trò cho trước; None = toàn trường; rỗng = không có."""
        relevant = [r for r in self.roles if not roles or r.role in roles]
        if any(r.scope_org_unit is None for r in relevant):
            return None
        return {r.scope_org_unit for r in relevant if r.scope_org_unit}


# ───────────────────────── Thu hồi phiên (đăng xuất) ─────────────────────────
class _RevokedTokens:
    """Danh sách token đã đăng xuất. Dùng Redis khi có; không có thì giữ trong bộ nhớ tiến trình."""

    def __init__(self) -> None:
        self._mem: dict[str, float] = {}
        self._lock = threading.Lock()
        self._redis = None
        self._redis_checked = False

    def _client(self):  # noqa: ANN202
        if not self._redis_checked:
            self._redis_checked = True
            try:
                import redis

                client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.5, socket_timeout=0.5)
                client.ping()
                self._redis = client
            except Exception:  # noqa: BLE001 — Redis là tùy chọn
                log.info("Không kết nối được Redis; danh sách token thu hồi giữ trong bộ nhớ")
        return self._redis

    def revoke(self, key: str, exp: float | None) -> None:
        ttl = max(int((exp or time.time() + 12 * 3600) - time.time()), 1)
        client = self._client()
        if client is not None:
            client.setex(f"aiia:revoked:{key}", ttl, 1)
            return
        with self._lock:
            self._mem[key] = time.time() + ttl

    def is_revoked(self, key: str) -> bool:
        client = self._client()
        if client is not None:
            return bool(client.exists(f"aiia:revoked:{key}"))
        with self._lock:
            until = self._mem.get(key)
            return until is not None and until > time.time()


revoked_tokens = _RevokedTokens()


# ───────────────────────── OIDC ─────────────────────────
@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    url = settings.oidc_jwks_url
    if not url:
        discovery = httpx.get(f"{settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration", timeout=5)
        discovery.raise_for_status()
        url = discovery.json()["jwks_uri"]
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)


def _decode_oidc(token: str) -> dict:
    if not settings.oidc_issuer:
        raise unauthorized("SSO chưa được cấu hình (AIIA_OIDC_ISSUER)")
    try:
        key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            key.key,
            algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"],
            issuer=settings.oidc_issuer,
            audience=settings.oidc_audience,
            options={"verify_aud": settings.oidc_audience is not None, "require": ["exp", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise unauthorized("Token không hợp lệ hoặc đã hết hạn") from exc
    except httpx.HTTPError as exc:
        log.warning("Không tải được JWKS của SSO: %s", exc)
        raise ProblemError(503, "SSO không phản hồi", "Không xác minh được token lúc này") from exc


def _resolve_oidc_user(db: Session, claims: dict) -> User:
    user = db.scalar(select(User).where(User.sso_subject == claims["sub"]))
    if user is None and claims.get("email"):
        # Admin tạo tài khoản trước lần đăng nhập SSO đầu tiên (sso_subject = "pending:<email>").
        user = db.scalar(select(User).where(User.email == claims["email"], User.sso_subject.like("pending:%")))
        if user is not None:
            user.sso_subject = claims["sub"]
    if user is None:
        raise forbidden("Tài khoản SSO chưa được cấp quyền truy cập AiiA. Liên hệ quản trị hệ thống.")
    return user


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def load_principal(db: Session, user: User, token_key: str, exp: float | None = None, ip: str | None = None) -> Principal:
    if user.status != UserStatus.ACTIVE:
        raise forbidden("Tài khoản đã bị khóa")
    roles = [RoleScope(r.role_code, r.scope_org_unit.code if r.scope_org_unit else None) for r in user.roles]
    return Principal(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        org_unit_code=user.org_unit.code if user.org_unit else None,
        roles=roles,
        token_key=token_key,
        token_exp=exp,
        ip=ip,
    )


def get_principal(
    request: Request,
    db: Session = Depends(get_db),
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Principal:
    if creds is None or not creds.credentials:
        raise unauthorized()
    token = creds.credentials
    key = _token_key(token)
    if revoked_tokens.is_revoked(key):
        raise unauthorized("Phiên đã đăng xuất")

    exp: float | None = None
    if token.startswith(DEMO_PREFIX):
        if not settings.auth_dev_tokens:
            raise unauthorized("Token demo chỉ dùng ở môi trường phát triển")
        try:
            user = db.get(User, uuid.UUID(token.removeprefix(DEMO_PREFIX)))
        except ValueError:
            user = None
        if user is None:
            raise unauthorized("Token demo không hợp lệ")
    else:
        claims = _decode_oidc(token)
        exp = float(claims["exp"])
        user = _resolve_oidc_user(db, claims)

    now = datetime.now(UTC)
    if user.last_login_at is None or now - user.last_login_at > timedelta(minutes=15):
        user.last_login_at = now
        db.commit()
    ip = request.client.host if request.client else None
    return load_principal(db, user, key, exp, ip)


def require_roles(*roles: RoleCode):  # noqa: ANN201
    """Dependency: người gọi phải có ít nhất một vai trò trong danh sách (x-roles của openapi.yaml)."""

    def _check(principal: Principal = Depends(get_principal)) -> Principal:
        if not principal.has_role(*roles):
            raise forbidden()
        return principal

    return _check


CurrentUser = Depends(get_principal)
