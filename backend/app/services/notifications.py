"""In-app notifications. SMS/e-mail senders are mocks added in stage 8."""

from sqlalchemy.orm import Session

from app.domain.enums import NotificationChannel
from app.models import Application, Notification


def notify(
    session: Session,
    user_id: int,
    title: str,
    body: str,
    *,
    application: Application | None = None,
) -> Notification:
    """Queue an in-app notification (committed together with the caller's transaction)."""
    note = Notification(
        user_id=user_id,
        application_id=application.id if application is not None else None,
        channel=NotificationChannel.IN_APP,
        title=title,
        body=body,
    )
    session.add(note)
    return note
