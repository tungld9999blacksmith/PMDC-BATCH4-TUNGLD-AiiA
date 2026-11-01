"""Cảnh báo bất thường (US35, BR17): chỉ cảnh báo, không sửa dữ liệu; OPEN → ACKNOWLEDGED → RESOLVED / DISMISSED."""

from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.errors import conflict, not_found
from app.core.pagination import PageParams, paginate
from app.core.security import Principal
from app.domain.enums import AlertSeverity, AlertStatus, DetectorKind, MetricStatus, RoleCode
from app.domain.models import AnomalyAlert, AnomalyDetector, SemanticMetric
from app.schemas.bi import AlertDetail, AlertOut, AlertPoint, AlertTarget
from app.schemas.common import UserRef
from app.services.access import accessible_dataset_ids

TRANSITIONS = {
    AlertStatus.OPEN: {AlertStatus.ACKNOWLEDGED, AlertStatus.RESOLVED, AlertStatus.DISMISSED},
    AlertStatus.ACKNOWLEDGED: {AlertStatus.RESOLVED, AlertStatus.DISMISSED},
    AlertStatus.RESOLVED: set(),
    AlertStatus.DISMISSED: set(),
}


def _num(value) -> float | None:  # noqa: ANN001
    return float(value) if value is not None else None


def alert_out(a: AnomalyAlert) -> AlertOut:
    d = a.detector
    if d.metric is not None:
        target = AlertTarget(type="METRIC", id=d.metric.code, name=d.metric.name)
    else:
        target = AlertTarget(type="DATASET", id=str(d.dataset_id), name=d.dataset.display_name if d.dataset else str(d.dataset_id))
    return AlertOut(
        id=a.id,
        kind=d.kind,
        target=target,
        observed_value=float(a.observed_value),
        expected_low=_num(a.expected_low),
        expected_high=_num(a.expected_high),
        severity=a.severity,
        status=a.status,
        detected_at=a.detected_at,
        acknowledged_by=UserRef.of(a.acknowledger),
        note=a.note,
    )


def _visibility(db: Session, principal: Principal):  # noqa: ANN202
    """Steward/Engineer thấy mọi cảnh báo; Viewer chỉ thấy cảnh báo trên metric đã chứng nhận và dataset được cấp quyền."""
    if principal.has_role(RoleCode.DATA_STEWARD, RoleCode.DATA_ENGINEER):
        return None
    certified = select(SemanticMetric.id).where(SemanticMetric.status == MetricStatus.CERTIFIED)
    datasets = accessible_dataset_ids(db, principal) or {-1}
    return or_(AnomalyDetector.metric_id.in_(certified), AnomalyDetector.dataset_id.in_(datasets))


def list_alerts(
    db: Session, principal: Principal, kind: DetectorKind | None, severity: AlertSeverity | None, status: AlertStatus | None, params: PageParams
):
    stmt = select(AnomalyAlert).join(AnomalyDetector, AnomalyDetector.id == AnomalyAlert.detector_id)
    if (cond := _visibility(db, principal)) is not None:
        stmt = stmt.where(cond)
    if kind:
        stmt = stmt.where(AnomalyDetector.kind == kind)
    if severity:
        stmt = stmt.where(AnomalyAlert.severity == severity)
    if status:
        stmt = stmt.where(AnomalyAlert.status == status)
    items, total = paginate(db, stmt.order_by(AnomalyAlert.detected_at.desc()), params)
    return [alert_out(a) for a in items], total


def _get_visible(db: Session, principal: Principal, alert_id: int, lock: bool = False) -> AnomalyAlert:
    stmt = select(AnomalyAlert).join(AnomalyDetector, AnomalyDetector.id == AnomalyAlert.detector_id).where(AnomalyAlert.id == alert_id)
    if (cond := _visibility(db, principal)) is not None:
        stmt = stmt.where(cond)
    if lock:
        stmt = stmt.with_for_update(of=AnomalyAlert)
    alert = db.scalar(stmt)
    if alert is None:
        raise not_found()
    return alert


def get_alert(db: Session, principal: Principal, alert_id: int) -> AlertDetail:
    alert = _get_visible(db, principal, alert_id)
    points: dict[datetime, AlertPoint] = {}
    # Chuỗi quan sát do detector ghi trong params.history; cảnh báo cùng detector là các điểm bất thường.
    for h in (alert.detector.params or {}).get("history", []):
        try:
            at = datetime.fromisoformat(h["at"])
        except (KeyError, TypeError, ValueError):
            continue
        points[at] = AlertPoint(at=at, value=float(h.get("value", 0)), low=_num(h.get("low")), high=_num(h.get("high")), anomalous=False)
    siblings = db.scalars(
        select(AnomalyAlert).where(AnomalyAlert.detector_id == alert.detector_id).order_by(AnomalyAlert.detected_at.desc()).limit(60)
    ).all()
    for s in siblings:
        points[s.detected_at] = AlertPoint(
            at=s.detected_at, value=float(s.observed_value), low=_num(s.expected_low), high=_num(s.expected_high), anomalous=True
        )
    return AlertDetail(**alert_out(alert).model_dump(), series=sorted(points.values(), key=lambda p: p.at), run_id=alert.run_id)


def transition(db: Session, principal: Principal, alert_id: int, to: str, note: str | None) -> AlertOut:
    alert = _get_visible(db, principal, alert_id, lock=True)
    target = AlertStatus(to)
    if target not in TRANSITIONS[alert.status]:
        raise conflict(f"Không chuyển được cảnh báo từ {alert.status.value} sang {to}", type_="invalid-transition")
    now = datetime.now(UTC)
    if target in (AlertStatus.ACKNOWLEDGED, AlertStatus.RESOLVED) and alert.acknowledged_by is None:
        alert.acknowledged_by, alert.acknowledged_at = principal.id, now
    if target in (AlertStatus.RESOLVED, AlertStatus.DISMISSED):
        alert.closed_at = now
    alert.status = target
    if note:
        alert.note = f"{alert.note}\n{note}" if alert.note else note
    audit(db, principal, "ALERT_" + target.value, "ALERT", alert.id, {"note": note})
    db.commit()
    db.refresh(alert)
    return alert_out(alert)
