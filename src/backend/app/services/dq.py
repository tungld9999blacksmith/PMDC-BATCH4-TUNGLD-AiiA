"""Chất lượng dữ liệu: quy tắc (US17, AC17), chạy thử, điểm theo 5 chiều (US19), issue (US20)."""

import re
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.errors import conflict, not_found, unprocessable
from app.core.pagination import PageParams, paginate
from app.core.security import Principal
from app.domain.enums import DqDimension, DqIssueStatus, DqRuleStatus, DqRuleType, RoleCode, UserStatus
from app.domain.models import DataSource, Dataset, DatasetColumn, DqIssue, DqIssueComment, DqRule, DqRuleResult, User
from app.policy.engine import compile_policy
from app.query.gateway import LakehouseGateway, quote_ident, require, table_ref
from app.schemas.catalog import (
    CommentOut,
    DqIssueOut,
    DqIssuePatch,
    DqRuleInput,
    DqRuleOut,
    DqRulePatch,
    DqScoreBoard,
    DqScoreRow,
    DqTrendPoint,
    DryRunResult,
)
from app.schemas.common import TabularResult, UserRef
from app.semantic.validator import validate_expression
from app.services.catalog import masked_rows
from app.services.users import notify

ISSUE_TRANSITIONS: dict[DqIssueStatus, set[DqIssueStatus]] = {
    DqIssueStatus.OPEN: {DqIssueStatus.IN_PROGRESS, DqIssueStatus.WONT_FIX},
    DqIssueStatus.IN_PROGRESS: {DqIssueStatus.OPEN, DqIssueStatus.RESOLVED, DqIssueStatus.WONT_FIX},
    DqIssueStatus.RESOLVED: set(),
    DqIssueStatus.WONT_FIX: {DqIssueStatus.OPEN},
}
DEFINITION_FIELDS = ("dataset_id", "column_id", "rule_type", "dimension", "severity", "params", "description")


def _pass_rates(db: Session, rule_ids: list[int]) -> dict[int, float]:
    if not rule_ids:
        return {}
    rows = db.execute(
        select(DqRuleResult.rule_id, DqRuleResult.evaluated_count, DqRuleResult.failed_count)
        .where(DqRuleResult.rule_id.in_(rule_ids))
        .order_by(DqRuleResult.rule_id, DqRuleResult.evaluated_at.desc())
        .distinct(DqRuleResult.rule_id)
    ).all()
    return {r: (1 - f / e) if e else 1.0 for r, e, f in rows}


def rule_out(rule: DqRule, pass_rate: float | None = None) -> DqRuleOut:
    return DqRuleOut(
        id=rule.id,
        dataset_id=rule.dataset_id,
        column_id=rule.column_id,
        rule_type=rule.rule_type,
        dimension=rule.dimension,
        severity=rule.severity,
        params=rule.params,
        description=rule.description,
        status=rule.status,
        version=rule.version,
        last_pass_rate=round(pass_rate, 4) if pass_rate is not None else None,
        last_dry_run_version=rule.last_dry_run_version,
    )


def list_rules(db: Session, dataset_id: int | None, status: DqRuleStatus | None, dimension: DqDimension | None) -> list[DqRuleOut]:
    stmt = select(DqRule)
    if dataset_id:
        stmt = stmt.where(DqRule.dataset_id == dataset_id)
    if status:
        stmt = stmt.where(DqRule.status == status)
    if dimension:
        stmt = stmt.where(DqRule.dimension == dimension)
    rules = db.scalars(stmt.order_by(DqRule.dataset_id, DqRule.id)).all()
    rates = _pass_rates(db, [r.id for r in rules])
    return [rule_out(r, rates.get(r.id)) for r in rules]


def _validate_rule(db: Session, data: dict[str, Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    dataset = db.get(Dataset, data["dataset_id"])
    if dataset is None:
        return [{"field": "datasetId", "message": "Dataset không tồn tại"}]
    column = db.get(DatasetColumn, data["column_id"]) if data.get("column_id") else None
    if data.get("column_id") and (column is None or column.dataset_id != dataset.id):
        errors.append({"field": "columnId", "message": "Cột không thuộc dataset"})
    rule_type, params = data["rule_type"], data.get("params") or {}
    if rule_type not in (DqRuleType.CUSTOM_SQL, DqRuleType.FRESHNESS) and not data.get("column_id"):
        errors.append({"field": "columnId", "message": "Bắt buộc với loại quy tắc này"})
    if rule_type == DqRuleType.RANGE:
        if "min" not in params and "max" not in params:
            errors.append({"field": "params", "message": "RANGE cần min và/hoặc max"})
        for key in ("min", "max"):
            if key in params and not isinstance(params[key], (int, float)):
                errors.append({"field": f"params.{key}", "message": "Phải là số"})
    elif rule_type == DqRuleType.REGEX:
        try:
            re.compile(params.get("pattern", ""))
        except (re.error, TypeError):
            errors.append({"field": "params.pattern", "message": "Biểu thức chính quy không hợp lệ"})
        if "pattern" not in params:
            errors.append({"field": "params.pattern", "message": "Bắt buộc"})
    elif rule_type == DqRuleType.REFERENCE:
        if "ref_dataset" not in params or "ref_column" not in params:
            errors.append({"field": "params", "message": "REFERENCE cần ref_dataset và ref_column"})
        elif _reference_target(db, params) is None:
            errors.append({"field": "params.ref_dataset", "message": "Không tìm thấy dataset/cột tham chiếu"})
    elif rule_type == DqRuleType.FRESHNESS:
        if not isinstance(params.get("max_age_minutes"), int) or params["max_age_minutes"] <= 0:
            errors.append({"field": "params.max_age_minutes", "message": "Cần số phút > 0"})
    elif rule_type == DqRuleType.CUSTOM_SQL:
        sql = params.get("sql")
        if not isinstance(sql, str):
            errors.append({"field": "params.sql", "message": "Bắt buộc"})
        else:
            columns = {c.name for c in dataset.columns}
            errors += [{"field": "params.sql", "message": m} for m in validate_expression(sql, columns, allow_aggregates=False)]
    return errors


def _reference_target(db: Session, params: dict[str, Any]) -> tuple[Dataset, str] | None:
    ref = str(params.get("ref_dataset", ""))
    if ref.isdigit():
        dataset = db.get(Dataset, int(ref))
    elif "." in ref:
        schema, table = ref.split(".", 1)
        dataset = db.scalar(select(Dataset).where(Dataset.schema_name == schema, Dataset.table_name == table))
    else:
        dataset = None
    if dataset is None or params.get("ref_column") not in {c.name for c in dataset.columns}:
        return None
    return dataset, params["ref_column"]


def create_rule(db: Session, principal: Principal, body: DqRuleInput) -> DqRuleOut:
    data = body.model_dump()
    if errors := _validate_rule(db, data):
        raise unprocessable("Quy tắc không hợp lệ", errors, type_="invalid-rule")
    rule = DqRule(**data, status=DqRuleStatus.DRAFT, version=1, created_by=principal.id)
    db.add(rule)
    db.flush()
    audit(db, principal, "DQ_RULE_CREATE", "DATASET", rule.dataset_id, {"ruleId": rule.id})
    db.commit()
    db.refresh(rule)
    return rule_out(rule)


def _get_rule(db: Session, rule_id: int) -> DqRule:
    rule = db.get(DqRule, rule_id)
    if rule is None:
        raise not_found()
    return rule


def update_rule(db: Session, principal: Principal, rule_id: int, body: DqRulePatch) -> DqRuleOut:
    rule = _get_rule(db, rule_id)
    patch = body.model_dump(exclude_unset=True)
    new_status = patch.pop("status", None)
    changed = {k: v for k, v in patch.items() if k in DEFINITION_FIELDS and getattr(rule, k) != v}
    if changed:
        merged = {k: changed.get(k, getattr(rule, k)) for k in DEFINITION_FIELDS}
        if errors := _validate_rule(db, merged):
            raise unprocessable("Quy tắc không hợp lệ", errors, type_="invalid-rule")
        for k, v in changed.items():
            setattr(rule, k, v)
        # Sửa định nghĩa → phiên bản mới, phải chạy thử lại trước khi kích hoạt (AC17).
        rule.version += 1
        if rule.status == DqRuleStatus.ACTIVE and new_status != DqRuleStatus.DISABLED:
            rule.status = DqRuleStatus.DRAFT
    if new_status is not None and new_status != rule.status:
        if new_status == DqRuleStatus.ACTIVE and rule.last_dry_run_version != rule.version:
            raise conflict("Chưa chạy thử phiên bản hiện tại của quy tắc", type_="dry-run-required")
        rule.status = new_status
    audit(
        db, principal, "DQ_RULE_UPDATE", "DATASET", rule.dataset_id,
        {"ruleId": rule.id, "version": rule.version, "status": rule.status.value},
    )  # fmt: skip
    db.commit()
    db.refresh(rule)
    return rule_out(rule, _pass_rates(db, [rule.id]).get(rule.id))


def failure_predicate(db: Session, rule: DqRule, column: DatasetColumn | None) -> tuple[str, list[Any]]:
    """Điều kiện SQL đúng với dòng VI PHẠM quy tắc."""
    col = quote_ident(column.name) if column else None
    params = rule.params
    match rule.rule_type:
        case DqRuleType.NOT_NULL:
            return f"{col} IS NULL", []
        case DqRuleType.RANGE:
            parts, args = [], []
            if "min" in params:
                parts.append(f"{col} < ?")
                args.append(params["min"])
            if "max" in params:
                parts.append(f"{col} > ?")
                args.append(params["max"])
            return "(" + " OR ".join(parts) + ")", args
        case DqRuleType.REGEX:
            return f"NOT regexp_like(CAST({col} AS varchar), ?)", [params["pattern"]]
        case DqRuleType.REFERENCE:
            ref_dataset, ref_col = _reference_target(db, params)
            ref = table_ref(ref_dataset.schema_name, ref_dataset.table_name)
            return f"{col} IS NOT NULL AND {col} NOT IN (SELECT {quote_ident(ref_col)} FROM {ref})", []
        case DqRuleType.UNIQUE:
            return f"{col} IN (SELECT {col} FROM __TABLE__ GROUP BY {col} HAVING count(*) > 1)", []
        case DqRuleType.CUSTOM_SQL:
            return f"NOT ({params['sql']})", []
        case _:
            return "1 = 0", []


def dry_run(db: Session, gateway: LakehouseGateway | None, principal: Principal, rule_id: int) -> DryRunResult:
    rule = _get_rule(db, rule_id)
    gateway = require(gateway)
    dataset = db.get(Dataset, rule.dataset_id)
    column = db.get(DatasetColumn, rule.column_id) if rule.column_id else None
    if errors := _validate_rule(db, {k: getattr(rule, k) for k in DEFINITION_FIELDS}):
        raise unprocessable("Quy tắc không hợp lệ", errors, type_="invalid-rule")
    table = table_ref(dataset.schema_name, dataset.table_name)
    sample_limit = int(rule.params.get("sample_rows", 10)) if isinstance(rule.params.get("sample_rows"), int) else 10

    if rule.rule_type == DqRuleType.FRESHNESS:
        ts_col = quote_ident(rule.params.get("column", "_ingested_at"))
        out = gateway.execute(f"SELECT max({ts_col}) FROM {table}", [], principal.email)
        latest = out.rows[0][0] if out.rows else None
        limit = timedelta(minutes=rule.params["max_age_minutes"])
        failed = int(latest is None or (latest.replace(tzinfo=latest.tzinfo or UTC) < datetime.now(UTC) - limit))
        evaluated, sample = 1, None
    else:
        predicate, args = failure_predicate(db, rule, column)
        predicate = predicate.replace("__TABLE__", table)
        out = gateway.execute(f"SELECT count(*), count_if({predicate}) FROM {table}", args, principal.email)
        evaluated, failed = (int(out.rows[0][0]), int(out.rows[0][1])) if out.rows else (0, 0)
        sample = None
        if failed:
            # Mẫu vi phạm đọc dưới quyền người chạy thử, đã che theo mức nhạy cảm.
            policy = compile_policy(dataset, principal, None, [])
            sample, _ = masked_rows(
                db, gateway, principal, dataset, limit=sample_limit, has_grant=False, policy=policy,
                extra_where=[predicate], extra_params=args,
            )  # fmt: skip
    rule.last_dry_run_version = rule.version
    audit(db, principal, "DQ_RULE_DRY_RUN", "DATASET", dataset.id, {"ruleId": rule.id, "evaluated": evaluated, "failed": failed})
    db.commit()
    return DryRunResult(evaluated=evaluated, failed=failed, sample=sample or TabularResult())


# ───────────────────────── Điểm chất lượng ─────────────────────────
def scores(db: Session, group_by: str, days: int) -> DqScoreBoard:
    since = datetime.now(UTC) - timedelta(days=days)
    rows = db.execute(
        select(DqRuleResult, DqRule, Dataset, DataSource.code)
        .join(DqRule, DqRule.id == DqRuleResult.rule_id)
        .join(Dataset, Dataset.id == DqRule.dataset_id)
        .outerjoin(DataSource, DataSource.id == Dataset.source_id)
        .where(DqRuleResult.evaluated_at >= since)
        .order_by(DqRuleResult.evaluated_at)
    ).all()

    def rate(res: DqRuleResult) -> float:
        return 100.0 * (1 - res.failed_count / res.evaluated_count) if res.evaluated_count else 100.0

    latest: dict[int, tuple[DqRuleResult, DqRule, Dataset, str | None]] = {}
    by_day: dict[str, list[float]] = defaultdict(list)
    for res, rule, dataset, code in rows:
        latest[rule.id] = (res, rule, dataset, code)
        by_day[res.evaluated_at.date().isoformat()].append(rate(res))

    groups: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    overall_dims: dict[str, list[float]] = defaultdict(list)
    for res, rule, dataset, code in latest.values():
        key = (code or "Không rõ nguồn") if group_by == "source" else f"{dataset.schema_name}.{dataset.table_name}"
        groups[key][rule.dimension.value].append(rate(res))
        overall_dims[rule.dimension.value].append(rate(res))

    def avg(values: list[float]) -> float:
        return round(sum(values) / len(values), 1)

    score_rows = []
    for key, dims in sorted(groups.items()):
        by_dim = {d: avg(v) for d, v in dims.items()}
        score_rows.append(DqScoreRow(key=key, score=avg(list(by_dim.values())), by_dimension=by_dim))
    by_dimension = {d: avg(v) for d, v in overall_dims.items()}
    return DqScoreBoard(
        overall=avg(list(by_dimension.values())) if by_dimension else None,
        by_dimension=by_dimension,
        rows=score_rows,
        trend=[DqTrendPoint(date=d, score=avg(v)) for d, v in sorted(by_day.items())],
    )


# ───────────────────────── Issue ─────────────────────────
def issue_out(db: Session, issue: DqIssue) -> DqIssueOut:
    return DqIssueOut(
        id=issue.id,
        rule=rule_out(issue.rule, _pass_rates(db, [issue.rule_id]).get(issue.rule_id)),
        dataset_id=issue.dataset_id,
        affected_rows=issue.affected_rows,
        severity=issue.severity,
        status=issue.status,
        assignee=UserRef.of(issue.assignee),
        last_run_id=issue.last_run_id,
        created_at=issue.created_at,
        comments=[comment_out(c) for c in issue.comments],
    )


def comment_out(c: DqIssueComment) -> CommentOut:
    return CommentOut(id=c.id, author=UserRef.of(c.author), body=c.body, created_at=c.created_at)


def list_issues(db: Session, status: DqIssueStatus | None, dataset_id: int | None, assignee: uuid.UUID | None, params: PageParams):
    stmt = select(DqIssue)
    if status:
        stmt = stmt.where(DqIssue.status == status)
    if dataset_id:
        stmt = stmt.where(DqIssue.dataset_id == dataset_id)
    if assignee:
        stmt = stmt.where(DqIssue.assignee_id == assignee)
    items, total = paginate(db, stmt.order_by(DqIssue.created_at.desc()), params)
    return [issue_out(db, i) for i in items], total


def _get_issue(db: Session, issue_id: int) -> DqIssue:
    issue = db.get(DqIssue, issue_id)
    if issue is None:
        raise not_found()
    return issue


def update_issue(db: Session, principal: Principal, issue_id: int, body: DqIssuePatch) -> DqIssueOut:
    issue = _get_issue(db, issue_id)
    patch = body.model_dump(exclude_unset=True)
    if "assignee_id" in patch:
        assignee_id = patch["assignee_id"]
        if assignee_id is not None:
            assignee = db.get(User, assignee_id)
            ok_roles = {RoleCode.DATA_STEWARD, RoleCode.DATA_ENGINEER}
            if assignee is None or assignee.status != UserStatus.ACTIVE or not ok_roles & {r.role_code for r in assignee.roles}:
                raise unprocessable("Người được gán phải là Steward/Engineer đang hoạt động", [{"field": "assigneeId", "message": "Không hợp lệ"}])
            if assignee_id != issue.assignee_id:
                notify(db, assignee_id, "DQ_ISSUE_ASSIGNED", f"Bạn được gán issue DQ #{issue.id}", f"/quality/issues/{issue.id}")
            if issue.status == DqIssueStatus.OPEN and "status" not in patch:
                patch["status"] = DqIssueStatus.IN_PROGRESS
        issue.assignee_id = assignee_id
    new_status = patch.get("status")
    if new_status is not None and new_status != issue.status:
        if new_status not in ISSUE_TRANSITIONS[issue.status]:
            raise conflict(f"Không chuyển được issue từ {issue.status} sang {new_status}", type_="invalid-transition")
        issue.status = new_status
        issue.resolved_at = datetime.now(UTC) if new_status in (DqIssueStatus.RESOLVED, DqIssueStatus.WONT_FIX) else None
    audit(db, principal, "DQ_ISSUE_UPDATE", "DATASET", issue.dataset_id, {"issueId": issue.id, "status": issue.status.value})
    db.commit()
    db.refresh(issue)
    return issue_out(db, issue)


def add_comment(db: Session, principal: Principal, issue_id: int, body: str) -> CommentOut:
    issue = _get_issue(db, issue_id)
    comment = DqIssueComment(issue_id=issue.id, author_id=principal.id, body=body)
    db.add(comment)
    db.flush()
    db.commit()
    db.refresh(comment)
    return comment_out(comment)
