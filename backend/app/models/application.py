"""Client application (pledge request) and its photos and status history."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import ApplicationStatus, ItemCondition, Metal, Role
from app.models.base import Base, IdMixin, TimestampMixin, UTCDateTime, str_enum, utcnow

if TYPE_CHECKING:
    from app.models.appraisal import Appraisal, Offer
    from app.models.catalog import Category
    from app.models.courier import CourierTask
    from app.models.loan import Loan
    from app.models.user import User


class Application(IdMixin, TimestampMixin, Base):
    __tablename__ = "applications"
    __table_args__ = (
        CheckConstraint("weight_mg IS NULL OR weight_mg > 0", name="weight_positive"),
        CheckConstraint(
            "fineness IS NULL OR (fineness > 0 AND fineness <= 999)", name="fineness_range"
        ),
    )

    client_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    expert_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[ApplicationStatus] = mapped_column(
        str_enum(ApplicationStatus), default=ApplicationStatus.DRAFT, index=True
    )

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    metal: Mapped[Metal | None] = mapped_column(str_enum(Metal))
    fineness: Mapped[int | None] = mapped_column(Integer)  # проба: 585, 750, 925…
    weight_mg: Mapped[int | None] = mapped_column(Integer)  # 3.52 g -> 3520
    brand: Mapped[str | None] = mapped_column(String(100))
    condition: Mapped[ItemCondition | None] = mapped_column(str_enum(ItemCondition))
    requested_amount: Mapped[int | None] = mapped_column(Integer)  # tiyn

    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    client: Mapped["User"] = relationship(foreign_keys=[client_id], back_populates="applications")
    expert: Mapped["User | None"] = relationship(foreign_keys=[expert_id])
    category: Mapped["Category"] = relationship()
    photos: Mapped[list["Photo"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="Photo.position",
    )
    appraisals: Mapped[list["Appraisal"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="Appraisal.created_at",
    )
    offers: Mapped[list["Offer"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="Offer.created_at",
    )
    courier_tasks: Mapped[list["CourierTask"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="CourierTask.created_at",
    )
    loan: Mapped["Loan | None"] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )
    history: Mapped[list["StatusHistory"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="StatusHistory.id",
    )

    @property
    def number(self) -> str:
        """Human-readable number, e.g. `Л-000042`."""
        return f"Л-{self.id:06d}"

    def __repr__(self) -> str:
        return f"<Application {self.id} {self.status}>"


class Photo(IdMixin, Base):
    __tablename__ = "photos"
    __table_args__ = (CheckConstraint("size_bytes > 0", name="size_positive"),)

    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    original_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(50))
    size_bytes: Mapped[int] = mapped_column(Integer)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    quality_score: Mapped[int | None] = mapped_column(Integer)  # 0–100, PhotoAppraiser
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    application: Mapped[Application] = relationship(back_populates="photos")


class StatusHistory(IdMixin, Base):
    """Audit log of application status changes."""

    __tablename__ = "status_history"

    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    from_status: Mapped[ApplicationStatus | None] = mapped_column(str_enum(ApplicationStatus))
    to_status: Mapped[ApplicationStatus] = mapped_column(str_enum(ApplicationStatus))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Role at the time of the change; NULL means the system.
    actor_role: Mapped[Role | None] = mapped_column(str_enum(Role))
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    application: Mapped[Application] = relationship(back_populates="history")
    actor: Mapped["User | None"] = relationship()
