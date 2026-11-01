"""Catalog, Data Quality, Identity."""

import uuid

from fastapi import APIRouter, Depends, Query

from app.api.v1.deps import DATA_OPS, AnyUser, Db, Gateway, STEWARD
from app.core.pagination import PageParams, page_params
from app.core.security import require_roles
from app.domain.enums import DataLayer, DqDimension, DqIssueStatus, DqRuleStatus, MatchStatus, RoleCode, Sensitivity
from app.schemas.catalog import (
    CommentInput,
    CommentOut,
    DatasetColumnOut,
    DatasetColumnPatch,
    DatasetDetail,
    DatasetOut,
    DqIssueOut,
    DqIssuePatch,
    DqRuleInput,
    DqRuleOut,
    DqRulePatch,
    DqScoreBoard,
    DryRunResult,
    GlossaryTermInput,
    GlossaryTermOut,
    MatchCandidateOut,
    MatchDecision,
    MergeEventOut,
    UnmergeRequest,
)
from app.schemas.common import Page, TabularResult
from app.services import catalog, dq, identity

R = RoleCode
router = APIRouter(prefix="/api/v1")


# ───────────────────────── Catalog ─────────────────────────
@router.get("/datasets", tags=["Catalog"], response_model=Page[DatasetOut])
def search_datasets(
    q: str | None = None,
    layer: DataLayer | None = None,
    sourceId: int | None = None,  # noqa: N803
    tag: str | None = None,
    sensitivity: Sensitivity | None = None,
    accessible: bool | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    principal=AnyUser,
):
    items, total = catalog.search_datasets(
        db, principal, q=q, layer=layer, source_id=sourceId, tag=tag, sensitivity=sensitivity, accessible=accessible, params=params
    )
    return Page.of(items, total, params)


@router.get("/datasets/{datasetId}", tags=["Catalog"], response_model=DatasetDetail)
def get_dataset(datasetId: int, db=Db, principal=AnyUser):  # noqa: N803
    return catalog.get_dataset(db, principal, datasetId)


@router.patch("/datasets/{datasetId}/columns/{columnId}", tags=["Catalog"], response_model=DatasetColumnOut)
def update_dataset_column(datasetId: int, columnId: int, body: DatasetColumnPatch, db=Db, principal=STEWARD):  # noqa: N803
    return catalog.update_column(db, principal, datasetId, columnId, body)


@router.get("/datasets/{datasetId}/preview", tags=["Catalog"], response_model=TabularResult)
def preview_dataset(
    datasetId: int,  # noqa: N803
    limit: int = Query(20, ge=1, le=100),
    snapshotId: str | None = None,  # noqa: N803
    batchId: int | None = None,  # noqa: N803
    db=Db,
    gateway=Gateway,
    principal=DATA_OPS,
):
    return catalog.preview_dataset(db, gateway, principal, datasetId, limit, snapshotId, batchId)


@router.get("/glossary", tags=["Catalog"], response_model=list[GlossaryTermOut])
def list_glossary_terms(q: str | None = None, db=Db, _=AnyUser):
    return catalog.list_terms(db, q)


@router.post("/glossary", tags=["Catalog"], response_model=GlossaryTermOut, status_code=201)
def create_glossary_term(body: GlossaryTermInput, db=Db, principal=STEWARD):
    return catalog.create_term(db, principal, body)


@router.put("/glossary/{termId}", tags=["Catalog"], response_model=GlossaryTermOut)
def update_glossary_term(termId: int, body: GlossaryTermInput, db=Db, principal=STEWARD):  # noqa: N803
    return catalog.update_term(db, principal, termId, body)


# ───────────────────────── Data Quality ─────────────────────────
@router.get("/dq/rules", tags=["Data Quality"], response_model=list[DqRuleOut])
def list_dq_rules(
    datasetId: int | None = None,  # noqa: N803
    status: DqRuleStatus | None = None,
    dimension: DqDimension | None = None,
    db=Db,
    _=DATA_OPS,
):
    return dq.list_rules(db, datasetId, status, dimension)


@router.post("/dq/rules", tags=["Data Quality"], response_model=DqRuleOut, status_code=201)
def create_dq_rule(body: DqRuleInput, db=Db, principal=STEWARD):
    return dq.create_rule(db, principal, body)


@router.patch("/dq/rules/{ruleId}", tags=["Data Quality"], response_model=DqRuleOut)
def update_dq_rule(ruleId: int, body: DqRulePatch, db=Db, principal=STEWARD):  # noqa: N803
    return dq.update_rule(db, principal, ruleId, body)


@router.post("/dq/rules/{ruleId}/dry-run", tags=["Data Quality"], response_model=DryRunResult)
def dry_run_dq_rule(ruleId: int, db=Db, gateway=Gateway, principal=STEWARD):  # noqa: N803
    return dq.dry_run(db, gateway, principal, ruleId)


@router.get("/dq/scores", tags=["Data Quality"], response_model=DqScoreBoard)
def get_dq_scores(
    groupBy: str = Query("dataset", pattern="^(dataset|source)$"),  # noqa: N803
    days: int = Query(30, ge=1, le=180),
    db=Db,
    _=Depends(require_roles(R.DATA_STEWARD, R.DATA_ENGINEER, R.BI_ANALYST, R.PLATFORM_ADMIN)),
):
    return dq.scores(db, groupBy, days)


@router.get("/dq/issues", tags=["Data Quality"], response_model=Page[DqIssueOut])
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


@router.patch("/dq/issues/{issueId}", tags=["Data Quality"], response_model=DqIssueOut)
def update_dq_issue(issueId: int, body: DqIssuePatch, db=Db, principal=STEWARD):  # noqa: N803
    return dq.update_issue(db, principal, issueId, body)


@router.post("/dq/issues/{issueId}/comments", tags=["Data Quality"], response_model=CommentOut, status_code=201)
def add_dq_issue_comment(issueId: int, body: CommentInput, db=Db, principal=DATA_OPS):  # noqa: N803
    return dq.add_comment(db, principal, issueId, body.body)


# ───────────────────────── Identity ─────────────────────────
@router.get("/identity/candidates", tags=["Identity"], response_model=Page[MatchCandidateOut])
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


@router.post("/identity/candidates/{candidateId}/decision", tags=["Identity"], response_model=MatchCandidateOut)
def decide_match_candidate(candidateId: int, body: MatchDecision, db=Db, principal=STEWARD):  # noqa: N803
    return identity.decide(db, principal, candidateId, body.decision, body.note)


@router.get("/identity/persons/{personId}/history", tags=["Identity"], response_model=list[MergeEventOut])
def get_merge_history(personId: uuid.UUID, db=Db, _=STEWARD):  # noqa: N803
    return identity.history(db, personId)


@router.post("/identity/merge-events/{eventId}/unmerge", tags=["Identity"], response_model=MergeEventOut)
def unmerge(eventId: int, body: UnmergeRequest, db=Db, principal=STEWARD):  # noqa: N803
    return identity.unmerge(db, principal, eventId, body.reason)
