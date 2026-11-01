"""Quyền dữ liệu hiệu lực (BR08): vai trò ∧ phạm vi đơn vị ∧ mức nhạy cảm ∧ quyền còn hạn.

Từ chối mặc định. Mọi nơi đọc dữ liệu (hồ sơ, truy vấn ngữ nghĩa, xem trước, export, trợ lý)
đi qua các hàm ở đây để quy tắc chỉ nằm một chỗ.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.core.security import Principal
from app.domain.enums import (
    SENSITIVITY_RANK,
    AccessLevel,
    DashboardStatus,
    MetricStatus,
    PrincipalType,
    ResourceType,
    RoleCode,
    Sensitivity,
)
from app.domain.models import AccessGrant, Dashboard, Dataset, OrgUnit, SemanticMetric

# Vai trò được tra cứu hồ sơ 360°, xem dashboard và hỏi trợ lý theo phạm vi (ma trận phân quyền §4).
PROFILE_ROLES = (RoleCode.REPORT_VIEWER, RoleCode.BI_ANALYST, RoleCode.DATA_STEWARD)
DASHBOARD_ROLES = tuple(RoleCode)

# Facet chứa dữ liệu CONFIDENTIAL về tài chính/nhân sự: phải có quyền PROFILE_FACET còn hạn.
FACETS_REQUIRING_GRANT = {"FINANCE", "HR"}
FACET_LABELS = {
    "OVERVIEW": "Tổng quan",
    "ACADEMIC": "Học tập",
    "FINANCE": "Tài chính",
    "CONDUCT": "Rèn luyện",
    "ACTIVITY": "Hoạt động",
    "OUTCOME": "Đầu ra",
    "TEACHING": "Giảng dạy",
    "RESEARCH": "Nghiên cứu",
    "EVALUATION": "Đánh giá",
    "HR": "Nhân sự",
    "DEVELOPMENT": "Phát triển",
    "RECOGNITION": "Thi đua",
}


def now() -> datetime:
    return datetime.now(UTC)


# ───────────────────────── Quyền có hạn ─────────────────────────
def active_grants(db: Session, principal: Principal, resource_type: ResourceType | None = None) -> list[AccessGrant]:
    stmt = select(AccessGrant).where(
        AccessGrant.user_id == principal.id,
        AccessGrant.revoked_at.is_(None),
        AccessGrant.valid_from <= func.now(),
        AccessGrant.valid_to >= func.now(),
    )
    if resource_type is not None:
        stmt = stmt.where(AccessGrant.resource_type == resource_type)
    return list(db.scalars(stmt.order_by(AccessGrant.valid_to)).all())


def find_grant(
    db: Session, principal: Principal, resource_type: ResourceType, resource_id: object, level: AccessLevel = AccessLevel.READ
) -> AccessGrant | None:
    for grant in active_grants(db, principal, resource_type):
        # Quyền EXPORT bao gồm READ.
        if grant.resource_id == str(resource_id) and (level == AccessLevel.READ or grant.access_level == AccessLevel.EXPORT):
            return grant
    return None


# ───────────────────────── Phạm vi đơn vị ─────────────────────────
def expand_org_units(db: Session, codes: set[str]) -> set[str]:
    """Mã đơn vị kèm toàn bộ đơn vị con (phạm vi khoa gồm cả bộ môn trực thuộc)."""
    if not codes:
        return set()
    rows = db.execute(
        text(
            """
            WITH RECURSIVE tree AS (
              SELECT id, code FROM app.org_units WHERE code = ANY(:codes)
              UNION
              SELECT o.id, o.code FROM app.org_units o JOIN tree t ON o.parent_id = t.id
            )
            SELECT code FROM tree
            """
        ),
        {"codes": list(codes)},
    ).scalars()
    return set(rows)


def data_scope(db: Session, principal: Principal, roles: tuple[RoleCode, ...] = PROFILE_ROLES) -> set[str] | None:
    """Phạm vi đơn vị áp lên dữ liệu: None = toàn trường, tập rỗng = không thấy gì."""
    codes = principal.scope_codes(*roles)
    return None if codes is None else expand_org_units(db, codes)


def in_scope(scope: set[str] | None, org_unit_code: str | None) -> bool:
    return scope is None or (org_unit_code is not None and org_unit_code in scope)


def org_unit_by_code(db: Session, code: str) -> OrgUnit | None:
    return db.scalar(select(OrgUnit).where(OrgUnit.code == code))


# ───────────────────────── Facet hồ sơ ─────────────────────────
def facet_allowed(db: Session, principal: Principal, facet: str) -> bool:
    if not principal.has_role(*PROFILE_ROLES):
        return False
    if facet not in FACETS_REQUIRING_GRANT:
        return True
    return find_grant(db, principal, ResourceType.PROFILE_FACET, facet) is not None


# ───────────────────────── Dataset ─────────────────────────
def dataset_accessible(db: Session, principal: Principal, dataset: Dataset) -> bool:
    """Người gọi được đọc dữ liệu dòng của dataset (không chỉ metadata)."""
    if principal.id in (dataset.owner_user_id, dataset.steward_user_id):
        return True
    return find_grant(db, principal, ResourceType.DATASET, dataset.id) is not None


def accessible_dataset_ids(db: Session, principal: Principal) -> set[int]:
    ids = {int(g.resource_id) for g in active_grants(db, principal, ResourceType.DATASET) if g.resource_id.isdigit()}
    owned = db.scalars(
        select(Dataset.id).where(or_(Dataset.owner_user_id == principal.id, Dataset.steward_user_id == principal.id))
    )
    return ids | set(owned)


def column_visible(sensitivity: Sensitivity, has_data_grant: bool) -> bool:
    """BR07/BR08: RESTRICTED luôn che; CONFIDENTIAL chỉ hiện khi có quyền dữ liệu còn hạn."""
    if sensitivity == Sensitivity.RESTRICTED:
        return False
    if SENSITIVITY_RANK[sensitivity] >= SENSITIVITY_RANK[Sensitivity.CONFIDENTIAL]:
        return has_data_grant
    return True


def mask_value(value: Any) -> Any:
    """Dạng che giữ ký tự đầu và 3 ký tự cuối, VD `0********234`."""
    if value is None:
        return None
    s = str(value)
    if len(s) <= 4:
        return "****"
    return s[0] + "*" * (len(s) - 4) + s[-3:]


# ───────────────────────── Metric & dashboard ─────────────────────────
def metric_queryable(principal: Principal, metric: SemanticMetric) -> bool:
    if metric.status == MetricStatus.CERTIFIED:
        return True
    # Metric nháp/ngừng dùng: chỉ người định nghĩa, Analyst (đang thiết kế) và Steward (chứng nhận).
    return metric.owner_id == principal.id or principal.has_role(RoleCode.BI_ANALYST, RoleCode.DATA_STEWARD)


def dashboard_visible(db: Session, principal: Principal, dashboard: Dashboard) -> bool:
    if dashboard.owner_id == principal.id:
        return True
    if dashboard.status != DashboardStatus.PUBLISHED:
        return False
    if find_grant(db, principal, ResourceType.DASHBOARD, dashboard.id):
        return True
    roles = {r.role.value for r in principal.roles}
    # Chia sẻ cho một đơn vị gồm cả người thuộc đơn vị con.
    my_units = _ancestors(db, principal.org_unit_code)
    for share in dashboard.shares:
        if share.principal_type == PrincipalType.USER and share.principal_id == str(principal.id):
            return True
        if share.principal_type == PrincipalType.ROLE and share.principal_id in roles:
            return True
        if share.principal_type == PrincipalType.ORG_UNIT and share.principal_id in my_units:
            return True
    return False


def _ancestors(db: Session, code: str | None) -> set[str]:
    if not code:
        return set()
    rows = db.execute(
        text(
            """
            WITH RECURSIVE up AS (
              SELECT id, code, parent_id FROM app.org_units WHERE code = :code
              UNION
              SELECT o.id, o.code, o.parent_id FROM app.org_units o JOIN up ON o.id = up.parent_id
            )
            SELECT code FROM up
            """
        ),
        {"code": code},
    ).scalars()
    return set(rows)
