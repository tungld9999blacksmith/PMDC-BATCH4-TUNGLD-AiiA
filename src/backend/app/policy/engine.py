"""Áp chính sách dòng/cột (US33, BR08) và phạm vi đơn vị lên truy vấn Lakehouse.

- Bộ lọc dòng: điều kiện SQL trên cột của dataset, có thể dùng `current_user_attr('<thuộc tính>')`;
  hàm này được thay bằng giá trị của người xem trước khi ghép vào SQL.
- Quy tắc cột: MASK_PARTIAL (che một phần), HASH (băm), DENY (bỏ cột) — áp sau khi đọc dữ liệu.
- Phạm vi đơn vị: dataset có cột mã đơn vị thì chỉ trả dòng trong phạm vi vai trò.
"""

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import Principal
from app.domain.models import AccessPolicy, AccessPolicyVersion, Dataset
from app.semantic.validator import validate_expression
from app.services.access import mask_value

ORG_SCOPE_COLUMNS = ("faculty_code", "org_unit_code", "primary_org_unit_code")
_ATTR = re.compile(r"current_user_attr\(\s*'([a-z_]+)'\s*\)", re.IGNORECASE)


@dataclass
class CompiledPolicy:
    where: list[str] = field(default_factory=list)
    params: list[Any] = field(default_factory=list)
    column_actions: dict[str, str] = field(default_factory=dict)


def user_attrs(principal: Principal) -> dict[str, str]:
    return {
        "email": principal.email,
        "user_id": str(principal.id),
        "org_unit_code": principal.org_unit_code or "",
        "faculty_code": principal.org_unit_code or "",
    }


def validate_rules(dataset: Dataset, row_filter: str | None, column_rules: list[dict[str, Any]]) -> list[str]:
    columns = {c.name for c in dataset.columns}
    errors: list[str] = []
    if row_filter:
        stripped = _ATTR.sub("''", row_filter)
        errors += validate_expression(stripped, columns, allow_aggregates=False)
        unknown = {m.group(1) for m in _ATTR.finditer(row_filter)} - set(user_attrs_keys())
        errors += [f"Thuộc tính người dùng không hỗ trợ: {a}" for a in sorted(unknown)]
    for rule in column_rules:
        if rule["column"] not in columns:
            errors.append(f"Cột không tồn tại trong dataset: {rule['column']}")
    return errors


def user_attrs_keys() -> tuple[str, ...]:
    return ("email", "user_id", "org_unit_code", "faculty_code")


def render_row_filter(row_filter: str, attrs: dict[str, str]) -> tuple[str, list[Any]]:
    """Thay current_user_attr(...) bằng tham số `?` để không ghép chuỗi giá trị vào SQL."""
    params: list[Any] = []

    def repl(match: re.Match[str]) -> str:
        params.append(attrs.get(match.group(1).lower(), ""))
        return "?"

    return _ATTR.sub(repl, row_filter), params


def active_rules(db: Session, dataset_id: int, principal: Principal) -> list[AccessPolicyVersion]:
    roles = [r.role for r in principal.roles]
    rows = db.execute(
        select(AccessPolicyVersion)
        .join(AccessPolicy, AccessPolicy.id == AccessPolicyVersion.policy_id)
        .where(
            AccessPolicy.dataset_id == dataset_id,
            AccessPolicy.is_active,
            AccessPolicy.role_code.in_(roles),
            AccessPolicyVersion.version == AccessPolicy.current_version,
        )
    ).scalars()
    return list(rows)


def compile_policy(
    dataset: Dataset,
    principal: Principal,
    scope: set[str] | None,
    versions: list[tuple[str | None, list[dict[str, Any]]]],
    alias: str | None = None,
) -> CompiledPolicy:
    compiled = CompiledPolicy()
    attrs = user_attrs(principal)
    columns = {c.name for c in dataset.columns}
    prefix = f"{alias}." if alias else ""
    if scope is not None:
        scope_col = next((c for c in ORG_SCOPE_COLUMNS if c in columns), None)
        if scope_col:
            if scope:
                compiled.where.append(f"{prefix}{scope_col} IN ({', '.join('?' for _ in scope)})")
                compiled.params += sorted(scope)
            else:
                compiled.where.append("1 = 0")
    for row_filter, column_rules in versions:
        if row_filter:
            sql, params = render_row_filter(row_filter, attrs)
            compiled.where.append(f"({sql})")
            compiled.params += params
        for rule in column_rules:
            # Nhiều chính sách cùng áp: giữ hành động chặt nhất.
            current = compiled.column_actions.get(rule["column"])
            if _strictness(rule["action"]) > _strictness(current):
                compiled.column_actions[rule["column"]] = rule["action"]
    return compiled


def _strictness(action: str | None) -> int:
    return {None: 0, "MASK_PARTIAL": 1, "HASH": 2, "DENY": 3}[action]


def apply_column_action(action: str | None, value: Any) -> tuple[Any, bool]:
    if action is None or value is None:
        return value, False
    if action == "MASK_PARTIAL":
        return mask_value(value), True
    if action == "HASH":
        return hashlib.sha256(str(value).encode()).hexdigest()[:16], True
    return None, True
