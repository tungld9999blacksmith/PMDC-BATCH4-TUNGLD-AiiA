"""Lỗi theo RFC 7807 (`application/problem+json`) — khớp schema Problem trong openapi.yaml."""

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import errors as pg_errors
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_BASE = "https://aiia.local/problems/"
log = logging.getLogger("aiia.errors")


class ProblemError(Exception):
    def __init__(
        self,
        status: int,
        title: str,
        detail: str | None = None,
        *,
        type_: str = "about:blank",
        errors: list[dict[str, str]] | None = None,
        requestable: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(detail or title)
        self.status = status
        self.title = title
        self.detail = detail
        self.type = type_ if type_ == "about:blank" or type_.startswith("http") else PROBLEM_BASE + type_
        self.errors = errors
        self.requestable = requestable
        self.headers = headers

    def body(self, instance: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"type": self.type, "title": self.title, "status": self.status}
        if self.detail:
            body["detail"] = self.detail
        if instance:
            body["instance"] = instance
        body["traceId"] = uuid.uuid4().hex
        if self.errors:
            body["errors"] = self.errors
        if self.requestable:
            body["requestable"] = self.requestable
        return body


def bad_request(detail: str, errors: list[dict[str, str]] | None = None) -> ProblemError:
    return ProblemError(400, "Tham số không hợp lệ", detail, type_="bad-request", errors=errors)


def unauthorized(detail: str = "Chưa đăng nhập hoặc token hết hạn") -> ProblemError:
    return ProblemError(401, "Chưa xác thực", detail, type_="unauthorized", headers={"WWW-Authenticate": "Bearer"})


def forbidden(detail: str = "Vai trò của bạn không được phép thực hiện thao tác này") -> ProblemError:
    return ProblemError(403, "Không có quyền", detail, type_="forbidden")


def not_found(detail: str = "Không tìm thấy tài nguyên") -> ProblemError:
    # AC11: tài nguyên ngoài phạm vi quyền trả cùng lỗi với tài nguyên không tồn tại.
    return ProblemError(404, "Không tìm thấy", detail, type_="not-found")


def conflict(detail: str, type_: str = "conflict") -> ProblemError:
    return ProblemError(409, "Xung đột trạng thái", detail, type_=type_)


def unprocessable(detail: str, errors: list[dict[str, str]] | None = None, type_: str = "business-rule") -> ProblemError:
    return ProblemError(422, "Vi phạm quy tắc nghiệp vụ", detail, type_=type_, errors=errors)


def service_unavailable(detail: str, type_: str = "service-unavailable") -> ProblemError:
    return ProblemError(503, "Dịch vụ chưa sẵn sàng", detail, type_=type_)


def _problem_response(problem: ProblemError, request: Request) -> JSONResponse:
    return JSONResponse(
        problem.body(request.url.path),
        status_code=problem.status,
        media_type="application/problem+json",
        headers=problem.headers,
    )


def _field_errors(exc: RequestValidationError) -> list[dict[str, str]]:
    out = []
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path", "header")]
        out.append({"field": ".".join(loc) or "body", "message": err.get("msg", "")})
    return out


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ProblemError)
    async def _problem(request: Request, exc: ProblemError) -> JSONResponse:
        return _problem_response(exc, request)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Sai kiểu tham số query/path/header → 400; body sai schema → 422.
        in_body = any(e.get("loc", ("",))[0] == "body" for e in exc.errors())
        problem = (
            unprocessable("Dữ liệu gửi lên không hợp lệ", _field_errors(exc), type_="validation")
            if in_body
            else bad_request("Tham số không hợp lệ", _field_errors(exc))
        )
        return _problem_response(problem, request)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        titles = {404: "Không tìm thấy", 405: "Phương thức không được hỗ trợ"}
        problem = ProblemError(exc.status_code, titles.get(exc.status_code, "Lỗi HTTP"), str(exc.detail))
        return _problem_response(problem, request)

    @app.exception_handler(IntegrityError)
    async def _integrity(request: Request, exc: IntegrityError) -> JSONResponse:
        # Lưới an toàn: ràng buộc CSDL là tuyến kiểm tra cuối của quy tắc nghiệp vụ.
        orig = exc.orig
        if isinstance(orig, pg_errors.UniqueViolation):
            problem = conflict("Dữ liệu đã tồn tại", type_="duplicate")
        elif isinstance(orig, (pg_errors.CheckViolation, pg_errors.ForeignKeyViolation, pg_errors.NotNullViolation)):
            constraint = getattr(getattr(orig, "diag", None), "constraint_name", None)
            problem = unprocessable(f"Dữ liệu vi phạm ràng buộc {constraint or ''}".strip())
        else:
            log.exception("Lỗi toàn vẹn dữ liệu không xác định")
            problem = ProblemError(500, "Lỗi hệ thống", "Không lưu được dữ liệu")
        return _problem_response(problem, request)
