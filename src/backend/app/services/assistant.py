"""Trợ lý hỏi-đáp trên dữ liệu được cấp quyền (US39, US40, BR16, BR20).

Luồng: kiểm tra chủ đề chặn → planner đề xuất SemanticQuery chỉ trên metric CERTIFIED người hỏi
dùng được → Semantic Service biên dịch → Trino chạy dưới danh tính người hỏi → writer diễn giải.
Mô hình không sinh SQL và không nhận dữ liệu dòng chi tiết.
"""

import re
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.assistant import guardrails
from app.assistant.llm_adapter import DimensionInfo, MetricInfo, get_planner, get_writer
from app.core.audit import audit
from app.core.config import settings
from app.core.db import get_sessionmaker
from app.core.errors import ProblemError, not_found, unprocessable
from app.core.pagination import PageParams, paginate
from app.core.rate_limit import SlidingWindowLimiter
from app.core.security import Principal
from app.domain.enums import MetricStatus, QaRole, QaStatus
from app.domain.models import OrgUnit, QaBlockedTopic, QaConversation, QaMessage, SemanticDimension, SemanticMetric, User
from app.query.gateway import LakehouseGateway
from app.schemas.assistant import (
    AssistantLogOut,
    AssistantMessageOut,
    BlockedTopicInput,
    BlockedTopicOut,
    ChartSpec,
    Clarify,
    ConversationDetail,
    ConversationOut,
)
from app.schemas.common import Filter, QueryResult, SemanticQuery, UserRef
from app.semantic import compiler
from app.services.access import DASHBOARD_ROLES, data_scope, metric_queryable
from app.services.dashboards import get_visible
from app.services.runs import sse

limiter = SlidingWindowLimiter(settings.assistant_rate_per_minute)
REFUSAL_TEXT = {
    "BLOCKED_TOPIC": "Câu hỏi thuộc chủ đề không được hỗ trợ theo quy định của nhà trường.",
    "RESTRICTED_DETAIL": "Trợ lý chỉ trả lời số liệu tổng hợp, không cung cấp định danh hay thông tin chi tiết của cá nhân.",
    "NO_METRIC": "Chưa có chỉ số đã chứng nhận phù hợp với câu hỏi. Hãy thử diễn đạt khác hoặc xem danh mục chỉ số.",
    "OUT_OF_SCOPE": "Câu hỏi vượt phạm vi dữ liệu bạn được cấp quyền.",
}


# ───────────────────────── Hội thoại ─────────────────────────
def conversation_out(c: QaConversation) -> ConversationOut:
    return ConversationOut(id=c.id, title=c.title, dashboard_id=c.dashboard_id, created_at=c.created_at)


def message_out(m: QaMessage) -> AssistantMessageOut:
    extras = m.extras or {}
    return AssistantMessageOut(
        id=m.id,
        role=m.role.value,
        content=m.content,
        status=m.status,
        ai_generated=m.role == QaRole.ASSISTANT,
        metric_codes=m.metric_codes,
        applied_filters=[Filter.model_validate(f) for f in (m.semantic_query or {}).get("filters", [])],
        data_as_of=m.data_as_of,
        result=QueryResult.model_validate(extras["result"]) if extras.get("result") else None,
        chart=ChartSpec.model_validate(extras["chart"]) if extras.get("chart") else None,
        semantic_query=SemanticQuery.model_validate(m.semantic_query) if m.semantic_query else None,
        sql=m.compiled_sql,
        refusal_reason=m.refusal_reason,
        clarify=Clarify.model_validate(extras["clarify"]) if extras.get("clarify") else None,
        feedback=m.feedback,
        created_at=m.created_at,
    )


def list_conversations(db: Session, principal: Principal) -> list[ConversationOut]:
    rows = db.scalars(
        select(QaConversation).where(QaConversation.user_id == principal.id).order_by(QaConversation.created_at.desc()).limit(200)
    ).all()
    return [conversation_out(c) for c in rows]


def create_conversation(db: Session, principal: Principal, dashboard_id: int | None) -> ConversationOut:
    if dashboard_id is not None:
        get_visible(db, principal, dashboard_id)
    conv = QaConversation(user_id=principal.id, dashboard_id=dashboard_id)
    db.add(conv)
    db.flush()
    db.commit()
    db.refresh(conv)
    return conversation_out(conv)


def _own_conversation(db: Session, principal: Principal, conversation_id: uuid.UUID) -> QaConversation:
    conv = db.get(QaConversation, conversation_id)
    if conv is None or conv.user_id != principal.id:
        raise not_found()
    return conv


def get_conversation(db: Session, principal: Principal, conversation_id: uuid.UUID) -> ConversationDetail:
    conv = _own_conversation(db, principal, conversation_id)
    messages = db.scalars(
        select(QaMessage).where(QaMessage.conversation_id == conv.id).order_by(QaMessage.created_at, QaMessage.id)
    ).all()
    return ConversationDetail(**conversation_out(conv).model_dump(), messages=[message_out(m) for m in messages])


# ───────────────────────── Hỏi ─────────────────────────
def start_question(db: Session, principal: Principal, conversation_id: uuid.UUID, message: str) -> None:
    conv = _own_conversation(db, principal, conversation_id)
    limiter.check(str(principal.id))
    db.add(QaMessage(conversation_id=conv.id, role=QaRole.USER, content=message.strip()))
    if conv.title is None:
        conv.title = message.strip()[:80]
    db.commit()


def _guard(principal: Principal, question: str) -> str | None:
    with get_sessionmaker()() as db:
        patterns = list(db.scalars(select(QaBlockedTopic.pattern)).all())
    if guardrails.blocked_topic(question, patterns):
        return "BLOCKED_TOPIC"
    if guardrails.asks_restricted_detail(question):
        return "RESTRICTED_DETAIL"
    return None


def _plan(principal: Principal, question: str, clarification: dict | None):  # noqa: ANN202
    with get_sessionmaker()() as db:
        metrics = [
            m
            for m in db.scalars(select(SemanticMetric).where(SemanticMetric.status == MetricStatus.CERTIFIED)).all()
            if metric_queryable(principal, m)
        ]
        infos = [MetricInfo(m.code, m.name, m.definition, m.unit, list(m.allowed_dimensions)) for m in metrics]
        dims = [DimensionInfo(d.code, d.name) for d in db.scalars(select(SemanticDimension)).all()]
        units = {u.code: u.name for u in db.scalars(select(OrgUnit)).all()}
    planner = get_planner()
    return planner.plan(question, infos, dims, units, clarification), infos, planner.model_name


def _run(principal: Principal, query: SemanticQuery, gateway: LakehouseGateway | None) -> tuple[QueryResult, str]:
    with get_sessionmaker()() as db:
        scope = data_scope(db, principal, DASHBOARD_ROLES)
        compiled = compiler.compile_query(db, principal, query, scope, require_certified=True)
        return compiler.execute(gateway, principal, compiled), compiled.sql


def _save(principal: Principal, conversation_id: uuid.UUID, question: str, fields: dict[str, Any]) -> AssistantMessageOut:
    with get_sessionmaker()() as db:
        message = QaMessage(conversation_id=conversation_id, role=QaRole.ASSISTANT, **fields)
        db.add(message)
        db.flush()
        audit(
            db, principal, "ASSISTANT_ASK", "CONVERSATION", conversation_id,
            {"question": question, "status": fields["status"].value, "metrics": fields.get("metric_codes", []),
             "refusalReason": fields.get("refusal_reason")},
        )  # fmt: skip
        db.commit()
        db.refresh(message)
        return message_out(message)


def _chunks(text: str, size: int = 60) -> list[str]:
    parts = re.findall(rf".{{1,{size}}}(?:\s|$)|.{{1,{size}}}", text, flags=re.S)
    return [p for p in parts if p]


async def answer_stream(
    principal: Principal,
    conversation_id: uuid.UUID,
    question: str,
    clarification: dict | None,
    gateway: LakehouseGateway | None,
) -> AsyncIterator[str]:
    started = time.perf_counter()

    def elapsed() -> int:
        return int((time.perf_counter() - started) * 1000)

    yield sse("status", {"stage": "CHECKING"})
    refusal = await run_in_threadpool(_guard, principal, question)
    if refusal:
        final = await run_in_threadpool(
            _save, principal, conversation_id, question,
            {"content": REFUSAL_TEXT[refusal], "status": QaStatus.REFUSED, "refusal_reason": refusal, "latency_ms": elapsed()},
        )  # fmt: skip
        yield sse("final", final.model_dump(mode="json", by_alias=True))
        return

    yield sse("status", {"stage": "PLANNING"})
    plan, infos, model = await run_in_threadpool(_plan, principal, question, clarification)
    if plan.kind == "NO_METRIC":
        final = await run_in_threadpool(
            _save, principal, conversation_id, question,
            {"content": REFUSAL_TEXT["NO_METRIC"], "status": QaStatus.REFUSED, "refusal_reason": "NO_METRIC", "model": model, "latency_ms": elapsed()},
        )  # fmt: skip
        yield sse("final", final.model_dump(mode="json", by_alias=True))
        return
    if plan.kind == "CLARIFY":
        yield sse("clarify", plan.clarify.model_dump(mode="json", by_alias=True))
        final = await run_in_threadpool(
            _save, principal, conversation_id, question,
            {"content": plan.clarify.question, "status": QaStatus.CLARIFYING, "model": model, "latency_ms": elapsed(),
             "extras": {"clarify": plan.clarify.model_dump(mode="json", by_alias=True)}},
        )  # fmt: skip
        yield sse("final", final.model_dump(mode="json", by_alias=True))
        return

    yield sse("status", {"stage": "QUERYING"})
    query = plan.query
    try:
        result, sql = await run_in_threadpool(_run, principal, query, gateway)
    except ProblemError as exc:
        status, reason = (QaStatus.REFUSED, "OUT_OF_SCOPE") if exc.status == 403 else (QaStatus.FAILED, None)
        content = REFUSAL_TEXT["OUT_OF_SCOPE"] if reason else f"Không truy vấn được dữ liệu lúc này: {exc.detail or exc.title}"
        final = await run_in_threadpool(
            _save, principal, conversation_id, question,
            {"content": content, "status": status, "refusal_reason": reason, "model": model, "latency_ms": elapsed(),
             "semantic_query": query.model_dump(mode="json", by_alias=True), "metric_codes": list(query.metrics)},
        )  # fmt: skip
        yield sse("final", final.model_dump(mode="json", by_alias=True))
        return

    yield sse("status", {"stage": "WRITING"})
    # BR16: luôn kèm thời điểm dữ liệu; dataset chưa ghi thời điểm cập nhật thì dùng thời điểm truy vấn.
    data_as_of = result.data_as_of or datetime.now(UTC)
    text, chart = get_writer().write(infos, query, result, data_as_of)
    for chunk in _chunks(text):
        yield sse("token", {"text": chunk})
    final = await run_in_threadpool(
        _save, principal, conversation_id, question,
        {
            "content": text, "status": QaStatus.ANSWERED, "metric_codes": list(query.metrics), "data_as_of": data_as_of,
            "semantic_query": query.model_dump(mode="json", by_alias=True), "compiled_sql": sql, "model": model,
            "latency_ms": elapsed(),
            "extras": {"result": result.model_dump(mode="json", by_alias=True), "chart": chart.model_dump(mode="json", by_alias=True) if chart else None},
        },
    )  # fmt: skip
    yield sse("final", final.model_dump(mode="json", by_alias=True))


def rate_message(db: Session, principal: Principal, message_id: int, rating: int, comment: str | None) -> None:
    message = db.get(QaMessage, message_id)
    if message is None or message.role != QaRole.ASSISTANT:
        raise not_found()
    conv = db.get(QaConversation, message.conversation_id)
    if conv.user_id != principal.id:
        raise not_found()
    message.feedback, message.feedback_comment = rating, comment
    db.commit()


# ───────────────────────── Quản trị ─────────────────────────
def list_logs(
    db: Session, status: QaStatus | None, user_id: uuid.UUID | None, from_: datetime | None, to: datetime | None, params: PageParams
):
    asked = aliased(QaMessage)
    question = (
        select(asked.content)
        .where(asked.conversation_id == QaMessage.conversation_id, asked.role == QaRole.USER, asked.id < QaMessage.id)
        .order_by(asked.id.desc())
        .limit(1)
        .scalar_subquery()
    )
    stmt = (
        select(QaMessage, question.label("question"), User)
        .join(QaConversation, QaConversation.id == QaMessage.conversation_id)
        .join(User, User.id == QaConversation.user_id)
        .where(QaMessage.role == QaRole.ASSISTANT)
    )
    if status:
        stmt = stmt.where(QaMessage.status == status)
    if user_id:
        stmt = stmt.where(QaConversation.user_id == user_id)
    if from_:
        stmt = stmt.where(QaMessage.created_at >= from_)
    if to:
        stmt = stmt.where(QaMessage.created_at <= to)
    stmt = stmt.order_by(QaMessage.created_at.desc())
    total = len(db.execute(stmt.with_only_columns(QaMessage.id)).all())
    rows = db.execute(stmt.limit(params.page_size).offset(params.offset)).all()
    items = [
        AssistantLogOut(**message_out(m).model_dump(), question=q, user=UserRef.of(u), compiled_sql=m.compiled_sql)
        for m, q, u in rows
    ]
    return items, total


def topic_out(t: QaBlockedTopic) -> BlockedTopicOut:
    return BlockedTopicOut(id=t.id, pattern=t.pattern, description=t.description, created_by=UserRef.of(t.creator), created_at=t.created_at)


def list_topics(db: Session) -> list[BlockedTopicOut]:
    return [topic_out(t) for t in db.scalars(select(QaBlockedTopic).order_by(QaBlockedTopic.id)).all()]


def create_topic(db: Session, principal: Principal, body: BlockedTopicInput) -> BlockedTopicOut:
    try:
        re.compile(body.pattern)
    except re.error as exc:
        raise unprocessable("Mẫu chủ đề không phải biểu thức chính quy hợp lệ", [{"field": "pattern", "message": str(exc)}]) from exc
    topic = QaBlockedTopic(pattern=body.pattern, description=body.description, created_by=principal.id)
    db.add(topic)
    db.flush()
    audit(db, principal, "BLOCKED_TOPIC_CREATE", "BLOCKED_TOPIC", topic.id, {"pattern": body.pattern})
    db.commit()
    db.refresh(topic)
    return topic_out(topic)


def delete_topic(db: Session, principal: Principal, topic_id: int) -> None:
    topic = db.get(QaBlockedTopic, topic_id)
    if topic is None:
        raise not_found()
    audit(db, principal, "BLOCKED_TOPIC_DELETE", "BLOCKED_TOPIC", topic.id, {"pattern": topic.pattern})
    db.delete(topic)
    db.commit()
