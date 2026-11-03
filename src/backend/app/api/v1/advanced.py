"""Reports, Alerts, Lineage, Assistant (phạm vi nâng cao — ADV)."""

import uuid

from fastapi import APIRouter, Body, Depends, Query, Response
from fastapi.responses import StreamingResponse

from app.api.v1.deps import Db, Gateway
from app.core.pagination import PageParams, page_params
from app.core.security import require_roles
from app.domain.enums import AlertSeverity, AlertStatus, DetectorKind, LineageNodeType, RoleCode
from app.schemas.assistant import AskRequest, ConversationCreate, ConversationDetail, ConversationOut, FeedbackRequest
from app.schemas.bi import (
    AlertDetail,
    AlertOut,
    AlertTransition,
    DeliveryOut,
    LineageGraph,
    LineageNode,
    SubscriptionInput,
    SubscriptionOut,
)
from app.schemas.common import Page
from app.services import alerts, assistant, lineage, reports

R = RoleCode
router = APIRouter(prefix="/api/v1")
READERS = Depends(require_roles(R.REPORT_VIEWER, R.BI_ANALYST, R.DATA_STEWARD))
ALERT_USERS = Depends(require_roles(R.DATA_STEWARD, R.DATA_ENGINEER, R.REPORT_VIEWER))
LINEAGE_USERS = Depends(require_roles(R.PLATFORM_ADMIN, R.DATA_ENGINEER, R.DATA_STEWARD, R.BI_ANALYST))


# ───────────────────────── Reports ─────────────────────────
@router.get("/subscriptions", tags=["Reports"], response_model=list[SubscriptionOut])
def list_subscriptions(db=Db, principal=READERS):
    return reports.list_subscriptions(db, principal)


@router.post("/subscriptions", tags=["Reports"], response_model=SubscriptionOut, status_code=201)
def create_subscription(body: SubscriptionInput, db=Db, principal=READERS):
    return reports.create_subscription(db, principal, body)


@router.patch("/subscriptions/{subscriptionId}", tags=["Reports"], response_model=SubscriptionOut)
def update_subscription(subscriptionId: int, body: SubscriptionInput, db=Db, principal=READERS):  # noqa: N803
    return reports.update_subscription(db, principal, subscriptionId, body)


@router.delete("/subscriptions/{subscriptionId}", tags=["Reports"], status_code=204)
def delete_subscription(subscriptionId: int, db=Db, principal=READERS):  # noqa: N803
    reports.delete_subscription(db, principal, subscriptionId)
    return Response(status_code=204)


@router.get("/subscriptions/{subscriptionId}/deliveries", tags=["Reports"], response_model=list[DeliveryOut])
def list_deliveries(subscriptionId: int, db=Db, principal=READERS):  # noqa: N803
    return reports.list_deliveries(db, principal, subscriptionId)


# ───────────────────────── Alerts ─────────────────────────
@router.get("/alerts", tags=["Alerts"], response_model=Page[AlertOut])
def list_alerts(
    kind: DetectorKind | None = None,
    severity: AlertSeverity | None = None,
    status: AlertStatus | None = None,
    params: PageParams = Depends(page_params),
    db=Db,
    principal=ALERT_USERS,
):
    items, total = alerts.list_alerts(db, principal, kind, severity, status, params)
    return Page.of(items, total, params)


@router.get("/alerts/{alertId}", tags=["Alerts"], response_model=AlertDetail)
def get_alert(alertId: int, db=Db, principal=ALERT_USERS):  # noqa: N803
    return alerts.get_alert(db, principal, alertId)


@router.post("/alerts/{alertId}/transition", tags=["Alerts"], response_model=AlertOut)
def transition_alert(alertId: int, body: AlertTransition, db=Db, principal=ALERT_USERS):  # noqa: N803
    return alerts.transition(db, principal, alertId, body.to, body.note)


# ───────────────────────── Lineage ─────────────────────────
@router.get("/lineage", tags=["Lineage"], response_model=LineageGraph, response_model_by_alias=True)
def get_lineage(
    nodeType: LineageNodeType,  # noqa: N803
    refId: str,  # noqa: N803
    direction: str = Query("BOTH", pattern="^(UPSTREAM|DOWNSTREAM|BOTH)$"),
    depth: int = Query(2, ge=1, le=6),
    columnLevel: bool = False,  # noqa: N803
    db=Db,
    _=LINEAGE_USERS,
):
    return lineage.get_lineage(db, nodeType, refId, direction, depth, columnLevel)


@router.get("/lineage/impact", tags=["Lineage"], response_model=list[LineageNode])
def get_impact(nodeType: LineageNodeType, refId: str, db=Db, _=LINEAGE_USERS):  # noqa: N803
    return lineage.get_impact(db, nodeType, refId)


# ───────────────────────── Assistant ─────────────────────────
@router.get("/assistant/conversations", tags=["Assistant"], response_model=list[ConversationOut])
def list_conversations(db=Db, principal=READERS):
    return assistant.list_conversations(db, principal)


@router.post("/assistant/conversations", tags=["Assistant"], response_model=ConversationOut, status_code=201)
def create_conversation(body: ConversationCreate | None = Body(None), db=Db, principal=READERS):
    return assistant.create_conversation(db, principal, body.dashboard_id if body else None)


@router.get("/assistant/conversations/{conversationId}", tags=["Assistant"], response_model=ConversationDetail)
def get_conversation(conversationId: uuid.UUID, db=Db, principal=READERS):  # noqa: N803
    return assistant.get_conversation(db, principal, conversationId)


@router.post(
    "/assistant/conversations/{conversationId}/messages",
    tags=["Assistant"],
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
def ask_assistant(conversationId: uuid.UUID, body: AskRequest, db=Db, gateway=Gateway, principal=READERS):  # noqa: N803
    # Kiểm tra quyền sở hữu hội thoại và giới hạn tần suất trước khi mở luồng (404/429 trả bình thường).
    assistant.start_question(db, principal, conversationId, body.message)
    return StreamingResponse(
        assistant.answer_stream(principal, conversationId, body.message, body.clarification, gateway),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/assistant/messages/{messageId}/feedback", tags=["Assistant"], status_code=204)
def rate_assistant_message(messageId: int, body: FeedbackRequest, db=Db, principal=READERS):  # noqa: N803
    assistant.rate_message(db, principal, messageId, body.rating, body.comment)
    return Response(status_code=204)
