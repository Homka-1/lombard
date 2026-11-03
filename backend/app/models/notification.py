from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import NotificationChannel
from app.models.base import Base, IdMixin, UTCDateTime, str_enum, utcnow

if TYPE_CHECKING:
    from app.models.user import User


class Notification(IdMixin, Base):
    """In-app notification; SMS/EMAIL rows are the log of the mock senders."""

    __tablename__ = "notifications"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[int | None] = mapped_column(
        ForeignKey("applications.id", ondelete="SET NULL")
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        str_enum(NotificationChannel), default=NotificationChannel.IN_APP
    )
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="notifications")
