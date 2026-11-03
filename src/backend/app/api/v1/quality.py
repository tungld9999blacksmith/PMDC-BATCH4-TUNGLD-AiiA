import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.api.v1.deps import DATA_OPS, STEWARD, Db, Gateway
from app.core.pagination import PageParams, page_params
from app.core.security import require_roles
from app.domain.enums import DqDimension, DqIssueStatus, DqRuleStatus, MatchStatus
from app.domain.enums import RoleCode as R
from app.schemas.catalog import (
    CommentInput,
    CommentOut,
    DqIssueOut,
    DqIssuePatch,
    DqRuleInput,
    DqRuleOut,
    DqRulePatch,
    DqScoreBoard,
    DryRunResult,
    MatchCandidateOut,
    MatchDecision,
    MergeEventOut,
    UnmergeRequest,
)
from app.schemas.common import Page
from app.services import dq, identity

router = APIRouter(prefix="/api/v1/dq", tags=["Data Quality"])
identity_router = APIRouter(prefix="/api/v1/identity", tags=["Identity"])


@router.get("/rules", response_model=list[DqRuleOut], summary="Danh sách quy tắc DQ")
def list_dq_rules(
    datasetId: int | None = None,  # noqa: N803
    status: DqRuleStatus | None = None,
    dimension: DqDimension | None = None,
    db=Db,
    _=DATA_OPS,
):
    return dq.list_rules(db, datasetId, status, dimension)


@router.post("/rules", response_model=DqRuleOut, status_code=201, summary="Tạo quy tắc ở trạng thái DRAFT (US17)")
def create_dq_rule(body: DqRuleInput, db=Db, principal=STEWARD):
    return dq.create_rule(db, principal, body)


@router.patch("/rules/{ruleId}", response_model=DqRuleOut, summary="Sửa quy tắc, kích hoạt hoặc tắt (AC17)")
def update_dq_rule(ruleId: int, body: DqRulePatch, db=Db, principal=STEWARD):  # noqa: N803
    return dq.update_rule(db, principal, ruleId, body)


@router.post("/rules/{ruleId}/dry-run", response_model=DryRunResult, summary="Chạy thử quy tắc trên dữ liệu")
def dry_run_dq_rule(ruleId: int, db=Db, gateway=Gateway, principal=STEWARD):  # noqa: N803
    return dq.dry_run(db, gateway, principal, ruleId)


@router.get("/scores", response_model=DqScoreBoard, summary="Điểm DQ theo dataset/nguồn và 5 chiều (US19)")
def get_dq_scores(
    groupBy: Literal["dataset", "source"] = "dataset",  # noqa: N803
    days: int = Query(30, ge=1, le=180),
    db=Db,
    _=Depends(require_roles(R.DATA_STEWARD, R.DATA_ENGINEER, R.BI_ANALYST, R.PLATFORM_ADMIN)),
):
    return dq.scores(db, groupBy, days)


@router.get("/issues", response_model=Page[DqIssueOut], summary="Danh sách issue (US20)")
def list_dq_issues(
    status: DqIssueStatus | None = None,
    datasetId: int | None = None,  # noqa: N803
    assignee: uuid.UUID | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    _=DATA_OPS,
):
    items, total = dq.list_issues(db, status, datasetId, assignee, params)
    return Page.of(items, total, params)


@router.patch("/issues/{issueId}", response_model=DqIssueOut, summary="Gán người, đổi trạng thái issue")
def update_dq_issue(issueId: int, body: DqIssuePatch, db=Db, principal=STEWARD):  # noqa: N803
    return dq.update_issue(db, principal, issueId, body)


@router.post("/issues/{issueId}/comments", response_model=CommentOut, status_code=201, summary="Thêm ghi chú")
def add_dq_issue_comment(issueId: int, body: CommentInput, db=Db, principal=DATA_OPS):  # noqa: N803
    return dq.add_comment(db, principal, issueId, body.body)


@identity_router.get("/candidates", response_model=Page[MatchCandidateOut], summary="Hàng đợi cặp nghi trùng (US10)")
def list_match_candidates(
    status: MatchStatus | None = None,
    minScore: float | None = Query(None, ge=0, le=1),  # noqa: N803
    maxScore: float | None = Query(None, ge=0, le=1),  # noqa: N803
    source: str | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    _=STEWARD,
):
    items, total = identity.list_candidates(db, status, minScore, maxScore, source, params)
    return Page.of(items, total, params)


@identity_router.post("/candidates/{candidateId}/decision", response_model=MatchCandidateOut, summary="Gộp / Không trùng / Để sau")
def decide_match_candidate(candidateId: int, body: MatchDecision, db=Db, principal=STEWARD):  # noqa: N803
    return identity.decide(db, principal, candidateId, body.decision, body.note)


@identity_router.get("/persons/{personId}/history", response_model=list[MergeEventOut], summary="Lịch sử gộp/tách của một person")
def get_merge_history(personId: uuid.UUID, db=Db, _=STEWARD):  # noqa: N803
    return identity.history(db, personId)


@identity_router.post("/merge-events/{eventId}/unmerge", response_model=MergeEventOut, summary="Tách hồ sơ đã gộp (BR05)")
def unmerge(eventId: int, body: UnmergeRequest, db=Db, principal=STEWARD):  # noqa: N803
    return identity.unmerge(db, principal, eventId, body.reason)
