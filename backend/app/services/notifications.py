"""Notifications: in-app messages plus SMS / e-mail mocks.

In-app notifications are rows with channel IN_APP shown in the personal account.
SMS and e-mail are not sent anywhere: `MockMessenger` writes them to the same table
(channel SMS / EMAIL) and to the log — that table is the "outbox" an admin can read
(`GET /api/admin/messages`). Replace `MockMessenger` with a real SMS / SMTP sender.
"""

import logging
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.domain.enums import NotificationChannel
from app.domain.phone import format_kz_phone
from app.models import Application, Notification, User

log = logging.getLogger("lombard.notifications")
SMS_MAX_LENGTH = 160


def notify(
    session: Session,
    user_id: int,
    title: str,
    body: str,
    *,
    application: Application | None = None,
    sms: bool = False,
    email: bool = False,
    at: datetime | None = None,
) -> Notification:
    """Queue an in-app notification (committed with the caller's transaction).

    `sms` / `email` also "send" the message through the mock messenger.
    """
    note = Notification(
        user_id=user_id,
        application_id=application.id if application is not None else None,
        channel=NotificationChannel.IN_APP,
        title=title,
        body=body,
    )
    if at is not None:
        note.created_at = at
    session.add(note)
    if sms or email:
        user = session.get(User, user_id)
        if user is not None:
            messenger = MockMessenger(session)
            if sms:
                messenger.sms(user, f"{title}. {body}", application=application, at=at)
            if email:
                messenger.email(user, title, body, application=application, at=at)
    return note


class MockMessenger:
    """Pretends to send SMS and e-mail: stores them as SMS / EMAIL notifications."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def _store(
        self,
        user: User,
        channel: NotificationChannel,
        title: str,
        body: str,
        application: Application | None,
        at: datetime | None,
    ) -> Notification:
        note = Notification(
            user_id=user.id,
            application_id=application.id if application is not None else None,
            channel=channel,
            title=title,
            body=body,
            is_read=True,  # the outbox is not shown as unread in-app messages
        )
        if at is not None:
            note.created_at = at
        self.session.add(note)
        return note

    def sms(
        self,
        user: User,
        text: str,
        *,
        application: Application | None = None,
        at: datetime | None = None,
    ) -> Notification | None:
        if not user.phone:
            return None
        text = text if len(text) <= SMS_MAX_LENGTH else text[: SMS_MAX_LENGTH - 1] + "…"
        to = format_kz_phone(user.phone)
        log.info("mock SMS to %s: %s", to, text)
        return self._store(user, NotificationChannel.SMS, to, text, application, at)

    def email(
        self,
        user: User,
        subject: str,
        body: str,
        *,
        application: Application | None = None,
        at: datetime | None = None,
    ) -> Notification:
        log.info("mock e-mail to %s: %s", user.email, subject)
        text = f"Здравствуйте, {user.full_name}!\n\n{body}\n\n— Ломбард онлайн"
        return self._store(user, NotificationChannel.EMAIL, subject, text, application, at)


# --- Reading (personal account) -----------------------------------------------------------


def list_for_user(
    session: Session, user: User, *, unread_only: bool = False, limit: int = 50
) -> list[Notification]:
    stmt = select(Notification).where(
        Notification.user_id == user.id, Notification.channel == NotificationChannel.IN_APP
    )
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)
    return list(session.scalars(stmt))


def unread_count(session: Session, user: User) -> int:
    return (
        session.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id,
                Notification.channel == NotificationChannel.IN_APP,
                Notification.is_read.is_(False),
            )
        )
        or 0
    )


def mark_read(session: Session, user: User, note_id: int) -> Notification | None:
    note = session.get(Notification, note_id)
    if note is None or note.user_id != user.id or note.channel is not NotificationChannel.IN_APP:
        return None
    note.is_read = True
    return note


def mark_all_read(session: Session, user: User) -> int:
    result = session.execute(
        update(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.channel == NotificationChannel.IN_APP,
            Notification.is_read.is_(False),
        )
        .values(is_read=True)
    )
    return result.rowcount or 0


def outbox(
    session: Session, channel: NotificationChannel | None = None, limit: int = 100
) -> list[Notification]:
    """SMS / e-mail log of the mock messenger (admin)."""
    stmt = select(Notification).where(Notification.channel != NotificationChannel.IN_APP)
    if channel is not None:
        stmt = stmt.where(Notification.channel == channel)
    stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)
    return list(session.scalars(stmt))
