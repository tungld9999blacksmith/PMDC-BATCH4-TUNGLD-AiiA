"""Tên hiển thị của tài nguyên được cấp quyền (dataset, dashboard, facet, metric)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import ResourceType
from app.domain.models import Dashboard, Dataset, SemanticMetric
from app.services.access import FACET_LABELS


def resource_exists(db: Session, resource_type: ResourceType, resource_id: str) -> bool:
    return resource_name(db, resource_type, resource_id, default=None) is not None


def resource_name(db: Session, resource_type: ResourceType, resource_id: str, default: str | None = "") -> str | None:
    if resource_type == ResourceType.PROFILE_FACET:
        label = FACET_LABELS.get(resource_id)
        return f"Tab {label} – hồ sơ 360°" if label else default
    if resource_type == ResourceType.METRIC:
        name = db.scalar(select(SemanticMetric.name).where(SemanticMetric.code == resource_id))
        return name or default
    if not resource_id.isdigit():
        return default
    if resource_type == ResourceType.DATASET:
        dataset = db.get(Dataset, int(resource_id))
        return dataset.display_name if dataset else default
    if resource_type == ResourceType.DASHBOARD:
        dashboard = db.get(Dashboard, int(resource_id))
        return dashboard.title if dashboard else default
    return default
