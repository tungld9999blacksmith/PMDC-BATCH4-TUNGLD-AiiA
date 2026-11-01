"""Báo cáo tự động (US37, BR18): đăng ký dashboard định kỳ, quyền tính theo người nhận lúc gửi, chỉ email nội bộ."""

import logging
from datetime import UTC, datetime

from croniter import croniter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.config import settings
from app.core.errors import not_found, unprocessable
from app.core.security import Principal, load_principal
from app.domain.enums import DeliveryStatus, ExportFormat, SubscriptionStatus, UserStatus
from app.domain.models import Dashboard, ExportJob, ReportDelivery, ReportSubscription, SubscriptionRecipient, User
from app.query.gateway import LakehouseGateway
from app.schemas.bi import DeliveryOut, SubscriptionInput, SubscriptionOut
from app.schemas.common import Filter, UserRef
from app.services import exports
from app.services.access import dashboard_visible
from app.services.dashboards import get_visible
from app.services.users import notify

log = logging.getLogger("aiia.reports")


def delivery_out(d: ReportDelivery) -> DeliveryOut:
    return DeliveryOut(
        id=d.id,
        recipient=UserRef.of(d.recipient),
        status=d.status,
        ai_summary=d.ai_summary,
        artifact_url=d.artifact_uri if d.artifact_uri and d.artifact_uri.startswith("http") else None,
        sent_at=d.sent_at,
    )


def subscription_out(db: Session, s: ReportSubscription) -> SubscriptionOut:
    last = db.scalar(
        select(ReportDelivery).where(ReportDelivery.subscription_id == s.id).order_by(ReportDelivery.sent_at.desc()).limit(1)
    )
    return SubscriptionOut(
        id=s.id,
        dashboard_id=s.dashboard_id,
        cron=s.cron,
        format=s.format,
        filters=[Filter.model_validate(f) for f in (s.filters if isinstance(s.filters, list) else [])],
        include_ai_summary=s.include_ai_summary,
        recipient_ids=[r.user_id for r in s.recipients],
        status=s.status,
        next_run_at=s.next_run_at,
        last_delivery=delivery_out(last) if last else None,
    )


def _next_run(cron: str, status: SubscriptionStatus) -> datetime | None:
    return croniter(cron, datetime.now(UTC)).get_next(datetime) if status == SubscriptionStatus.ACTIVE else None


def _validate(db: Session, principal: Principal, body: SubscriptionInput) -> list[User]:
    get_visible(db, principal, body.dashboard_id)
    if not croniter.is_valid(body.cron) or len(body.cron.split()) != 5:
        raise unprocessable("Biểu thức cron không hợp lệ", [{"field": "cron", "message": "Sai cú pháp cron (5 trường)"}])
    recipients = []
    for i, uid in enumerate(dict.fromkeys(body.recipient_ids or [principal.id])):
        user = db.get(User, uid)
        domain = user.email.rsplit("@", 1)[-1].lower() if user else ""
        # BR18: chỉ gửi tới người dùng nội bộ còn hoạt động.
        if user is None or user.status != UserStatus.ACTIVE or domain not in settings.internal_email_domains:
            raise unprocessable("Người nhận phải là người dùng nội bộ đang hoạt động", [{"field": f"recipientIds[{i}]", "message": "Không hợp lệ"}])
        recipients.append(user)
    return recipients


def list_subscriptions(db: Session, principal: Principal) -> list[SubscriptionOut]:
    subs = db.scalars(select(ReportSubscription).where(ReportSubscription.owner_id == principal.id).order_by(ReportSubscription.id)).all()
    return [subscription_out(db, s) for s in subs]


def create_subscription(db: Session, principal: Principal, body: SubscriptionInput) -> SubscriptionOut:
    recipients = _validate(db, principal, body)
    status = body.status or SubscriptionStatus.ACTIVE
    sub = ReportSubscription(
        dashboard_id=body.dashboard_id,
        owner_id=principal.id,
        cron=body.cron,
        format=body.format,
        filters=[f.model_dump(by_alias=True) for f in body.filters],
        include_ai_summary=body.include_ai_summary,
        status=status,
        next_run_at=_next_run(body.cron, status),
    )
    sub.recipients = [SubscriptionRecipient(user_id=u.id) for u in recipients]
    db.add(sub)
    db.flush()
    audit(db, principal, "SUBSCRIPTION_CREATE", "DASHBOARD", body.dashboard_id, {"subscriptionId": sub.id, "cron": body.cron})
    db.commit()
    db.refresh(sub)
    return subscription_out(db, sub)


def _owned(db: Session, principal: Principal, subscription_id: int) -> ReportSubscription:
    sub = db.get(ReportSubscription, subscription_id)
    if sub is None or sub.owner_id != principal.id:
        raise not_found()
    return sub


def update_subscription(db: Session, principal: Principal, subscription_id: int, body: SubscriptionInput) -> SubscriptionOut:
    sub = _owned(db, principal, subscription_id)
    recipients = _validate(db, principal, body)
    sub.dashboard_id, sub.cron, sub.format = body.dashboard_id, body.cron, body.format
    sub.filters = [f.model_dump(by_alias=True) for f in body.filters]
    sub.include_ai_summary = body.include_ai_summary
    sub.status = body.status or sub.status
    sub.next_run_at = _next_run(sub.cron, sub.status)
    sub.recipients.clear()
    db.flush()
    sub.recipients.extend(SubscriptionRecipient(user_id=u.id) for u in recipients)
    audit(db, principal, "SUBSCRIPTION_UPDATE", "DASHBOARD", sub.dashboard_id, {"subscriptionId": sub.id, "status": sub.status.value})
    db.commit()
    db.refresh(sub)
    return subscription_out(db, sub)


def delete_subscription(db: Session, principal: Principal, subscription_id: int) -> None:
    sub = _owned(db, principal, subscription_id)
    audit(db, principal, "SUBSCRIPTION_DELETE", "DASHBOARD", sub.dashboard_id, {"subscriptionId": sub.id})
    db.delete(sub)
    db.commit()


def list_deliveries(db: Session, principal: Principal, subscription_id: int) -> list[DeliveryOut]:
    sub = _owned(db, principal, subscription_id)
    rows = db.scalars(select(ReportDelivery).where(ReportDelivery.subscription_id == sub.id).order_by(ReportDelivery.sent_at.desc()).limit(100)).all()
    return [delivery_out(d) for d in rows]


# ───────────────────────── Worker: gửi báo cáo đến hạn ─────────────────────────
def deliver_due(db: Session, gateway: LakehouseGateway | None, at: datetime | None = None) -> int:
    at = at or datetime.now(UTC)
    due = db.scalars(
        select(ReportSubscription)
        .where(ReportSubscription.status == SubscriptionStatus.ACTIVE, ReportSubscription.next_run_at <= at)
        .with_for_update(skip_locked=True)
    ).all()
    sent = 0
    for sub in due:
        dashboard = db.get(Dashboard, sub.dashboard_id)
        for rec in sub.recipients:
            user = db.get(User, rec.user_id)
            delivery = ReportDelivery(subscription_id=sub.id, recipient_id=user.id, status=DeliveryStatus.SENT)
            try:
                principal = load_principal(db, user, token_key="report")
                # BR18: quyền tính theo người nhận tại thời điểm gửi.
                if not dashboard_visible(db, principal, dashboard):
                    delivery.status = DeliveryStatus.SKIPPED_NO_ACCESS
                else:
                    job = ExportJob(
                        dashboard_id=dashboard.id,
                        requested_by=user.id,
                        format=ExportFormat.PDF,
                        filters=sub.filters if isinstance(sub.filters, list) else [],
                        watermark=f"{user.email} · {at:%Y-%m-%d %H:%M} UTC · báo cáo định kỳ",
                    )
                    db.add(job)
                    db.flush()
                    exports.generate(db, gateway, job.id)
                    db.refresh(job)
                    if job.status.value != "READY":
                        raise RuntimeError(job.error_message or "Không tạo được báo cáo")
                    delivery.artifact_uri = job.storage_uri if sub.format.value == "PDF" else f"/dashboards/{dashboard.id}"
                    if sub.include_ai_summary:
                        # BR20: nội dung do AI sinh luôn gắn nhãn.
                        delivery.ai_summary = f"[Do AI tạo] Báo cáo định kỳ «{dashboard.title}» ngày {at:%d/%m/%Y}."
                    notify(db, user.id, "REPORT_DELIVERED", f"Báo cáo định kỳ: {dashboard.title}", f"/dashboards/{dashboard.id}")
                    sent += 1
            except Exception as exc:  # noqa: BLE001 — một người nhận lỗi không chặn người khác
                log.warning("Gửi báo cáo %s cho %s lỗi: %s", sub.id, user.email, exc)
                delivery.status, delivery.error_message = DeliveryStatus.FAILED, str(exc)[:500]
            db.add(delivery)
        sub.next_run_at = _next_run(sub.cron, sub.status)
        db.commit()
    return sent
