"""Appraisals (auto / expert / inspection) and loan offers."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import AppraisalKind, OfferStatus
from app.models.base import Base, IdMixin, UTCDateTime, str_enum, utcnow

if TYPE_CHECKING:
    from app.models.application import Application
    from app.models.user import User


class Appraisal(IdMixin, Base):
    """Market value estimate in tiyn: a range plus a point value and confidence."""

    __tablename__ = "appraisals"
    __table_args__ = (
        CheckConstraint(
            "value_min >= 0 AND value_min <= value AND value <= value_max", name="value_range"
        ),
        CheckConstraint("confidence >= 0 AND confidence <= 100", name="confidence_range"),
    )

    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[AppraisalKind] = mapped_column(str_enum(AppraisalKind))
    appraiser_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # NULL for AUTO
    value_min: Mapped[int] = mapped_column(Integer)
    value_max: Mapped[int] = mapped_column(Integer)
    value: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[int] = mapped_column(Integer)  # 0–100 %
    comment: Mapped[str | None] = mapped_column(Text)
    # Calculation breakdown: formula inputs, photo checks, etc.
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    application: Mapped["Application"] = relationship(back_populates="appraisals")
    appraiser: Mapped["User | None"] = relationship()


class Offer(IdMixin, Base):
    """Loan terms proposed by the expert. Amounts in tiyn."""

    __tablename__ = "offers"
    __table_args__ = (
        CheckConstraint("loan_amount > 0", name="amount_positive"),
        CheckConstraint("term_days >= 1", name="term_positive"),
        CheckConstraint("total_to_repay >= loan_amount", name="repay_ge_amount"),
    )

    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    appraisal_id: Mapped[int] = mapped_column(ForeignKey("appraisals.id"))
    expert_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    loan_amount: Mapped[int] = mapped_column(Integer)
    daily_rate_bp: Mapped[int] = mapped_column(Integer)
    term_days: Mapped[int] = mapped_column(Integer)
    total_to_repay: Mapped[int] = mapped_column(Integer)
    status: Mapped[OfferStatus] = mapped_column(str_enum(OfferStatus), default=OfferStatus.SENT)
    comment: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    application: Mapped["Application"] = relationship(back_populates="offers")
    appraisal: Mapped[Appraisal] = relationship()
    expert: Mapped["User"] = relationship()
