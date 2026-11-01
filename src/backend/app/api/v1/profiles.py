"""Profiles: hồ sơ 360° sinh viên, giảng viên, cán bộ."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.pagination import PageParams, page_params
from app.core.security import Principal, require_roles
from app.domain.enums import SubjectType
from app.query.gateway import LakehouseGateway, get_gateway
from app.schemas.assistant import AttributeProvenance, FacetCode, FacetData, Profile360, ProfileSummary, TimelinePage
from app.schemas.common import Page
from app.services import profiles
from app.services.access import PROFILE_ROLES

router = APIRouter(prefix="/api/v1/profiles", tags=["Profiles"])
viewer = require_roles(*PROFILE_ROLES)


def _csv_list(value: str | None) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()] if value else []


@router.get("", operation_id="searchProfiles", response_model=Page[ProfileSummary])
def search_profiles(
    q: str | None = Query(None),
    type: SubjectType | None = Query(None),  # noqa: A002
    orgUnit: str | None = Query(None),  # noqa: N803
    cohort: str | None = Query(None),
    status: str | None = Query(None),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    gateway: LakehouseGateway | None = Depends(get_gateway),
    principal: Principal = Depends(viewer),
):
    items, total = profiles.search(
        db, gateway, principal, q=q, type_=type, org_unit=orgUnit, cohort=cohort, status=status, params=params
    )
    return Page.of(items, total, params)


@router.get("/{personId}", operation_id="getProfile", response_model=Profile360)
def get_profile(
    personId: uuid.UUID,  # noqa: N803
    role: SubjectType | None = Query(None),
    db: Session = Depends(get_db),
    gateway: LakehouseGateway | None = Depends(get_gateway),
    principal: Principal = Depends(viewer),
):
    return profiles.get_profile(db, gateway, principal, personId, role)


@router.get("/{personId}/facets/{facet}", operation_id="getProfileFacet", response_model=FacetData)
def get_profile_facet(
    personId: uuid.UUID,  # noqa: N803
    facet: FacetCode,
    db: Session = Depends(get_db),
    gateway: LakehouseGateway | None = Depends(get_gateway),
    principal: Principal = Depends(viewer),
):
    return profiles.get_facet(db, gateway, principal, personId, facet)


@router.get("/{personId}/timeline", operation_id="getProfileTimeline", response_model=TimelinePage)
def get_profile_timeline(
    personId: uuid.UUID,  # noqa: N803
    eventType: str | None = Query(None, description="Danh sách phân tách bằng dấu phẩy"),  # noqa: N803
    source: str | None = Query(None, description="Danh sách phân tách bằng dấu phẩy"),
    before: datetime | None = Query(None),
    pageSize: int = Query(20, ge=1, le=100),  # noqa: N803
    db: Session = Depends(get_db),
    gateway: LakehouseGateway | None = Depends(get_gateway),
    principal: Principal = Depends(viewer),
):
    return profiles.timeline(db, gateway, principal, personId, _csv_list(eventType), _csv_list(source), before, pageSize)


@router.get("/{personId}/attributes/{attribute}/provenance", operation_id="getAttributeProvenance", response_model=AttributeProvenance)
def get_attribute_provenance(
    personId: uuid.UUID,  # noqa: N803
    attribute: str,
    db: Session = Depends(get_db),
    gateway: LakehouseGateway | None = Depends(get_gateway),
    principal: Principal = Depends(viewer),
):
    return profiles.provenance(db, gateway, principal, personId, attribute)
