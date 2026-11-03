"""Me: phiên, quyền của tôi, trang chủ, thông báo."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.pagination import PageParams, page_params
from app.core.security import Principal, get_principal, revoked_tokens
from app.schemas.common import Page
from app.schemas.me import AccessGrantOut, HomeSummary, Me, NotificationOut
from app.services import access_requests, home, users

router = APIRouter(prefix="/api/v1", tags=["Me"])


@router.get("/me", operation_id="getMe", response_model=Me)
def get_me(db: Session = Depends(get_db), principal: Principal = Depends(get_principal)) -> Me:
    return users.me(db, principal)


@router.get("/me/grants", operation_id="listMyGrants", response_model=list[AccessGrantOut])
def list_my_grants(db: Session = Depends(get_db), principal: Principal = Depends(get_principal)):
    return access_requests.my_grants(db, principal)


@router.get("/me/home", operation_id="getHomeSummary", response_model=HomeSummary)
def get_home(db: Session = Depends(get_db), principal: Principal = Depends(get_principal)):
    return home.summary(db, principal)


@router.post("/me/logout", operation_id="logout", status_code=204)
def logout(principal: Principal = Depends(get_principal)) -> Response:
    revoked_tokens.revoke(principal.token_key, principal.token_exp)
    return Response(status_code=204)


@router.get("/notifications", operation_id="listNotifications", response_model=Page[NotificationOut])
def list_notifications(
    unread: bool | None = Query(None),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_principal),
):
    items, total = users.list_notifications(db, principal, unread, params)
    return Page.of(items, total, params)


@router.post("/notifications/{notificationId}/read", operation_id="markNotificationRead", status_code=204)
def mark_read(notificationId: int, db: Session = Depends(get_db), principal: Principal = Depends(get_principal)) -> Response:  # noqa: N803
    users.mark_notification_read(db, principal, notificationId)
    return Response(status_code=204)
