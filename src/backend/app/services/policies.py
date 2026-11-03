"""Chính sách phân quyền dòng/cột có phiên bản (US33, BR19) và mô phỏng "xem như người dùng X" (AC33)."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.errors import conflict, not_found, unprocessable
from app.core.security import Principal, load_principal
from app.domain.models import AccessPolicy, AccessPolicyVersion, Dataset, User
from app.policy.engine import compile_policy, validate_rules
from app.query.gateway import LakehouseGateway, require, table_ref
from app.schemas.assistant import (
    ColumnRule,
    PolicyCreate,
    PolicyOut,
    PolicyRules,
    PolicySimulateRequest,
    PolicySimulation,
    PolicyVersionCreate,
    PolicyVersionOut,
)
from app.schemas.common import UserRef
from app.services.access import data_scope, dataset_accessible
from app.services.catalog import masked_rows

SIMULATION_ROWS = 50


def version_out(v: AccessPolicyVersion) -> PolicyVersionOut:
    return PolicyVersionOut(
        version=v.version,
        row_filter=v.row_filter,
        column_rules=[ColumnRule.model_validate(r) for r in v.column_rules],
        change_note=v.change_note,
        created_by=UserRef.of(v.creator),
        created_at=v.created_at,
    )


def policy_out(db: Session, p: AccessPolicy) -> PolicyOut:
    current = db.get(AccessPolicyVersion, (p.id, p.current_version))
    return PolicyOut(
        id=p.id,
        name=p.name,
        dataset_id=p.dataset_id,
        role_code=p.role_code,
        current_version=version_out(current) if current else None,
        active=p.is_active,
    )


def list_policies(db: Session) -> list[PolicyOut]:
    return [policy_out(db, p) for p in db.scalars(select(AccessPolicy).order_by(AccessPolicy.name)).all()]


def _check_rules(db: Session, dataset_id: int, rules: PolicyRules) -> Dataset:
    dataset = db.get(Dataset, dataset_id)
    if dataset is None:
        raise unprocessable("Dataset không tồn tại", [{"field": "datasetId", "message": "Không tồn tại"}])
    errors = validate_rules(dataset, rules.row_filter, [r.model_dump() for r in rules.column_rules])
    if errors:
        raise unprocessable("Chính sách không hợp lệ", [{"field": "rowFilter", "message": e} for e in errors], type_="invalid-policy")
    return dataset


def create_policy(db: Session, principal: Principal, body: PolicyCreate) -> PolicyOut:
    if db.scalar(select(AccessPolicy.id).where(AccessPolicy.name == body.name)):
        raise conflict("Tên chính sách đã tồn tại", type_="duplicate")
    _check_rules(db, body.dataset_id, body)
    policy = AccessPolicy(name=body.name, dataset_id=body.dataset_id, role_code=body.role_code, current_version=1, created_by=principal.id)
    db.add(policy)
    db.flush()
    db.add(
        AccessPolicyVersion(
            policy_id=policy.id,
            version=1,
            row_filter=body.row_filter,
            column_rules=[r.model_dump() for r in body.column_rules],
            change_note="Tạo chính sách",
            created_by=principal.id,
        )
    )
    audit(db, principal, "POLICY_CREATE", "POLICY", policy.id, {"datasetId": body.dataset_id, "role": body.role_code.value})
    db.commit()
    db.refresh(policy)
    return policy_out(db, policy)


def _get_policy(db: Session, policy_id: int) -> AccessPolicy:
    policy = db.get(AccessPolicy, policy_id)
    if policy is None:
        raise not_found()
    return policy


def list_versions(db: Session, policy_id: int) -> list[PolicyVersionOut]:
    policy = _get_policy(db, policy_id)
    rows = db.scalars(
        select(AccessPolicyVersion).where(AccessPolicyVersion.policy_id == policy.id).order_by(AccessPolicyVersion.version.desc())
    ).all()
    return [version_out(v) for v in rows]


def create_version(db: Session, principal: Principal, policy_id: int, body: PolicyVersionCreate) -> PolicyVersionOut:
    policy = db.scalar(select(AccessPolicy).where(AccessPolicy.id == policy_id).with_for_update())
    if policy is None:
        raise not_found()
    _check_rules(db, policy.dataset_id, body)
    # BR19: khôi phục = gửi lại nội dung phiên bản cũ, luôn tạo phiên bản mới để giữ lịch sử.
    version = (db.scalar(select(func.max(AccessPolicyVersion.version)).where(AccessPolicyVersion.policy_id == policy.id)) or 0) + 1
    row = AccessPolicyVersion(
        policy_id=policy.id,
        version=version,
        row_filter=body.row_filter,
        column_rules=[r.model_dump() for r in body.column_rules],
        change_note=body.change_note,
        created_by=principal.id,
    )
    db.add(row)
    policy.current_version = version
    db.flush()
    audit(db, principal, "POLICY_VERSION", "POLICY", policy.id, {"version": version, "note": body.change_note})
    db.commit()
    db.refresh(row)
    return version_out(row)


def simulate(db: Session, gateway: LakehouseGateway | None, principal: Principal, body: PolicySimulateRequest) -> PolicySimulation:
    gateway = require(gateway)
    dataset = _check_rules(db, body.dataset_id, body)
    user = db.get(User, body.as_user_id)
    if user is None:
        raise unprocessable("Người dùng mô phỏng không tồn tại", [{"field": "asUserId", "message": "Không tồn tại"}])
    target = load_principal(db, user, token_key="simulate")
    # Mô phỏng: phạm vi và quyền của người dùng X, cộng chính sách đang soạn (chưa lưu).
    policy = compile_policy(
        dataset,
        target,
        data_scope(db, target, tuple(r.role for r in target.roles)),
        [(body.row_filter, [r.model_dump() for r in body.column_rules])],
    )
    result, _ = masked_rows(
        db, gateway, target, dataset,
        limit=SIMULATION_ROWS, has_grant=dataset_accessible(db, target, dataset), policy=policy,
        as_user=principal.email,
    )  # fmt: skip
    table = table_ref(dataset.schema_name, dataset.table_name)
    total = gateway.execute(f"SELECT count(*) FROM {table}", [], principal.email).rows[0][0]
    where = " AND ".join(policy.where)
    visible = gateway.execute(f"SELECT count(*) FROM {table}" + (f" WHERE {where}" if where else ""), policy.params, principal.email).rows[0][0]
    audit(db, principal, "POLICY_SIMULATE", "DATASET", dataset.id, {"asUserId": str(user.id)})
    db.commit()
    return PolicySimulation(columns=result.columns, rows=result.rows, visible_row_count=int(visible), total_row_count=int(total))
