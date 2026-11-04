"""Personal account notifications (in-app channel)."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, SessionDep
from app.models import Notification
from app.schemas.loan import NotificationRead, UnreadCount
from app.services import notifications as svc
from app.services.errors import NotFoundError

router = APIRouter(prefix="/notifications", tags=["notifications"])


def note_read(n: Notification) -> NotificationRead:
    return NotificationRead(
        id=n.id,
        channel=n.channel,
        title=n.title,
        body=n.body,
        is_read=n.is_read,
        application_id=n.application_id,
        created_at=n.created_at,
    )


@router.get("", response_model=list[NotificationRead], summary="Мои уведомления (новые сверху)")
def list_notifications(
    session: SessionDep,
    user: CurrentUser,
    unread: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[NotificationRead]:
    return [note_read(n) for n in svc.list_for_user(session, user, unread_only=unread, limit=limit)]


@router.get("/unread-count", response_model=UnreadCount, summary="Сколько непрочитанных")
def get_unread_count(session: SessionDep, user: CurrentUser) -> UnreadCount:
    return UnreadCount(unread=svc.unread_count(session, user))


@router.post("/read-all", response_model=UnreadCount, summary="Отметить все прочитанными")
def read_all(session: SessionDep, user: CurrentUser) -> UnreadCount:
    svc.mark_all_read(session, user)
    session.commit()
    return UnreadCount(unread=0)


@router.post("/{note_id}/read", response_model=NotificationRead, summary="Отметить прочитанным")
def read_one(note_id: int, session: SessionDep, user: CurrentUser) -> NotificationRead:
    note = svc.mark_read(session, user, note_id)
    if note is None:
        raise NotFoundError("Уведомление не найдено")
    session.commit()
    return note_read(note)
