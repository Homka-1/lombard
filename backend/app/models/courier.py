from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import CourierTaskKind, CourierTaskStatus
from app.models.base import Base, IdMixin, TimestampMixin, UTCDateTime, str_enum

if TYPE_CHECKING:
    from app.models.application import Application
    from app.models.user import User


class CourierTask(IdMixin, TimestampMixin, Base):
    """Courier trip: pick the item up from the client or return it after repayment."""

    __tablename__ = "courier_tasks"
    __table_args__ = (CheckConstraint("slot_end > slot_start", name="slot_order"),)

    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    courier_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[CourierTaskKind] = mapped_column(str_enum(CourierTaskKind))
    status: Mapped[CourierTaskStatus] = mapped_column(
        str_enum(CourierTaskStatus), default=CourierTaskStatus.SCHEDULED, index=True
    )
    city: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(500))
    contact_phone: Mapped[str] = mapped_column(String(32))
    slot_start: Mapped[datetime] = mapped_column(UTCDateTime())
    slot_end: Mapped[datetime] = mapped_column(UTCDateTime())
    comment: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    application: Mapped["Application"] = relationship(back_populates="courier_tasks")
    courier: Mapped["User | None"] = relationship()
