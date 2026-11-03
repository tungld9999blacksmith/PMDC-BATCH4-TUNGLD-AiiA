"""Đối soát danh tính (US10, BR05): hàng đợi cặp nghi trùng, gộp/không trùng, lịch sử, tách hồ sơ.

Pipeline (Splink) ghi `match_candidates.feature_scores` theo dạng
`{"fields": {"<trường>": {"left": ..., "right": ..., "score": 0..1, "sensitivity": "..."}}}`
hoặc dạng rút gọn `{"<trường>": 0..1}`. Trường RESTRICTED chỉ có điểm, không có giá trị.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.errors import conflict, not_found
from app.core.pagination import PageParams, paginate
from app.core.security import Principal
from app.domain.enums import MatchStatus, MergeEventAction, Sensitivity
from app.domain.models import MatchCandidate, PersonMergeEvent
from app.schemas.catalog import MatchCandidateOut, MatchRecord, MergeEventOut
from app.schemas.common import MaskableValue, UserRef
from app.services.access import column_visible, mask_value


def _comparison(value: Any) -> str:
    if isinstance(value, str) and value in {"MATCH", "PARTIAL", "DIFFERENT", "MISSING"}:
        return value
    if value is None:
        return "MISSING"
    score = float(value)
    return "MATCH" if score >= 0.95 else "PARTIAL" if score >= 0.6 else "DIFFERENT"


def candidate_out(c: MatchCandidate) -> MatchCandidateOut:
    features = c.feature_scores or {}
    detailed: dict[str, Any] = features.get("fields") if isinstance(features.get("fields"), dict) else {}
    left_fields: dict[str, MaskableValue] = {}
    right_fields: dict[str, MaskableValue] = {}
    comparison: dict[str, str] = {}
    if detailed:
        for name, info in detailed.items():
            sensitivity = Sensitivity(info.get("sensitivity", "INTERNAL"))
            # Steward duyệt đối soát thấy giá trị tới mức CONFIDENTIAL; RESTRICTED luôn che.
            visible = column_visible(sensitivity, has_data_grant=True)
            for side, target in (("left", left_fields), ("right", right_fields)):
                raw = info.get(side)
                target[name] = MaskableValue(
                    value=raw if visible else mask_value(raw), masked=not visible and raw is not None, sensitivity=sensitivity
                )
            comparison[name] = _comparison(info.get("score") if "score" in info else info.get("result"))
    else:
        comparison = {k: _comparison(v) for k, v in features.items()}
    return MatchCandidateOut(
        id=c.id,
        score=float(c.score),
        status=c.status,
        left=MatchRecord(source_code=c.left_source_code, source_key=c.left_source_key, person_id=c.left_person_id, fields=left_fields),
        right=MatchRecord(source_code=c.right_source_code, source_key=c.right_source_key, person_id=c.right_person_id, fields=right_fields),
        comparison=comparison,
        created_at=c.created_at,
    )


def list_candidates(
    db: Session,
    status: MatchStatus | None,
    min_score: float | None,
    max_score: float | None,
    source: str | None,
    params: PageParams,
):
    stmt = select(MatchCandidate).where(MatchCandidate.status == (status or MatchStatus.PENDING))
    if min_score is not None:
        stmt = stmt.where(MatchCandidate.score >= Decimal(str(min_score)))
    if max_score is not None:
        stmt = stmt.where(MatchCandidate.score <= Decimal(str(max_score)))
    if source:
        stmt = stmt.where(or_(MatchCandidate.left_source_code == source, MatchCandidate.right_source_code == source))
    items, total = paginate(db, stmt.order_by(MatchCandidate.score.desc(), MatchCandidate.id), params)
    return [candidate_out(c) for c in items], total


def decide(db: Session, principal: Principal, candidate_id: int, decision: str, note: str | None) -> MatchCandidateOut:
    candidate = db.scalar(select(MatchCandidate).where(MatchCandidate.id == candidate_id).with_for_update())
    if candidate is None:
        raise not_found()
    if decision == "SKIP":
        return candidate_out(candidate)
    if candidate.status != MatchStatus.PENDING:
        raise conflict("Cặp này đã được xử lý bởi thao tác khác — tải lại", type_="stale-candidate")
    now = datetime.now(UTC)
    candidate.decided_by, candidate.decided_at = principal.id, now
    if decision == "MERGE":
        candidate.status = MatchStatus.MERGED
        db.add(
            PersonMergeEvent(
                action=MergeEventAction.MERGE,
                survivor_person_id=candidate.left_person_id,
                merged_person_id=candidate.right_person_id,
                candidate_id=candidate.id,
                actor_id=principal.id,
                snapshot={
                    "left": {"source": candidate.left_source_code, "key": candidate.left_source_key},
                    "right": {"source": candidate.right_source_code, "key": candidate.right_source_key},
                    "score": float(candidate.score),
                    "note": note,
                },
            )
        )
    else:
        candidate.status = MatchStatus.REJECTED
    audit(
        db, principal, "IDENTITY_" + ("MERGE" if decision == "MERGE" else "REJECT"), "MATCH_CANDIDATE", candidate.id,
        {"score": float(candidate.score), "note": note},
    )  # fmt: skip
    db.commit()
    db.refresh(candidate)
    return candidate_out(candidate)


def event_out(e: PersonMergeEvent, candidate_status: MatchStatus | None = None) -> MergeEventOut:
    return MergeEventOut(
        id=e.id,
        action=e.action.value,
        survivor_person_id=e.survivor_person_id,
        merged_person_id=e.merged_person_id,
        actor=UserRef.of(e.actor),
        automatic=e.actor_id is None or candidate_status == MatchStatus.AUTO_MERGED,
        created_at=e.created_at,
    )


def history(db: Session, person_id: uuid.UUID) -> list[MergeEventOut]:
    rows = db.execute(
        select(PersonMergeEvent, MatchCandidate.status)
        .outerjoin(MatchCandidate, MatchCandidate.id == PersonMergeEvent.candidate_id)
        .where(or_(PersonMergeEvent.survivor_person_id == person_id, PersonMergeEvent.merged_person_id == person_id))
        .order_by(PersonMergeEvent.created_at.desc(), PersonMergeEvent.id.desc())
    ).all()
    if not rows:
        known = db.scalar(
            select(MatchCandidate.id)
            .where(or_(MatchCandidate.left_person_id == person_id, MatchCandidate.right_person_id == person_id))
            .limit(1)
        )
        if known is None:
            raise not_found()
    return [event_out(e, status) for e, status in rows]


def unmerge(db: Session, principal: Principal, event_id: int, reason: str) -> MergeEventOut:
    event = db.scalar(select(PersonMergeEvent).where(PersonMergeEvent.id == event_id).with_for_update())
    if event is None:
        raise not_found()
    if event.action != MergeEventAction.MERGE:
        raise conflict("Chỉ tách được sự kiện gộp", type_="not-a-merge")
    undone = db.scalar(
        select(PersonMergeEvent.id).where(
            PersonMergeEvent.action == MergeEventAction.UNMERGE,
            PersonMergeEvent.survivor_person_id == event.survivor_person_id,
            PersonMergeEvent.merged_person_id == event.merged_person_id,
            PersonMergeEvent.created_at >= event.created_at,
            PersonMergeEvent.id > event.id,
        )
    )
    if undone:
        raise conflict("Sự kiện gộp này đã được tách", type_="already-unmerged")
    reverse = PersonMergeEvent(
        action=MergeEventAction.UNMERGE,
        survivor_person_id=event.survivor_person_id,
        merged_person_id=event.merged_person_id,
        candidate_id=event.candidate_id,
        actor_id=principal.id,
        snapshot={"mergeEventId": event.id, "reason": reason, "restored": event.snapshot},
    )
    db.add(reverse)
    if event.candidate_id:
        candidate = db.get(MatchCandidate, event.candidate_id)
        candidate.status = MatchStatus.UNMERGED
    db.flush()
    audit(db, principal, "IDENTITY_UNMERGE", "PERSON", event.survivor_person_id, {"mergeEventId": event.id, "reason": reason})
    db.commit()
    db.refresh(reverse)
    return event_out(reverse)
