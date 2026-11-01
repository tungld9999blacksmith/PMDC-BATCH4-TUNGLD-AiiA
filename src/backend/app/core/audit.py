"""Ghi audit log bất biến (BR10).

Bản ghi audit đi chung transaction với thao tác nghiệp vụ. Với sự kiện bị từ chối (DENY),
gọi `audit_denied` để commit audit trước khi trả lỗi.
"""

from typing import Any

from sqlalchemy.orm import Session

from app.core.security import Principal
from app.domain.enums import AuditOutcome
from app.domain.models import AuditLog


def audit(
    db: Session,
    principal: Principal | None,
    action: str,
    object_type: str,
    object_id: object | None = None,
    details: dict[str, Any] | None = None,
    outcome: AuditOutcome = AuditOutcome.ALLOW,
) -> None:
    db.add(
        AuditLog(
            actor_id=principal.id if principal else None,
            action=action,
            object_type=object_type,
            object_id=None if object_id is None else str(object_id),
            outcome=outcome,
            ip=principal.ip if principal else None,
            details=details or {},
        )
    )


def audit_denied(db: Session, principal: Principal, action: str, object_type: str, object_id: object, **details: Any) -> None:
    db.rollback()
    audit(db, principal, action, object_type, object_id, details, AuditOutcome.DENY)
    db.commit()
