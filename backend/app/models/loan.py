"""Loan (pledge ticket) and payments."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import LoanStatus, PaymentKind, PaymentStatus
from app.models.base import Base, IdMixin, TimestampMixin, UTCDateTime, str_enum, utcnow

if TYPE_CHECKING:
    from app.models.application import Application
    from app.models.appraisal import Offer


class Loan(IdMixin, TimestampMixin, Base):
    __tablename__ = "loans"
    __table_args__ = (
        CheckConstraint("principal > 0", name="principal_positive"),
        CheckConstraint("due_at > issued_at", name="due_after_issue"),
    )

    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), unique=True
    )
    offer_id: Mapped[int] = mapped_column(ForeignKey("offers.id"))
    ticket_number: Mapped[str] = mapped_column(String(32), unique=True)  # залоговый билет
    principal: Mapped[int] = mapped_column(Integer)  # tiyn
    daily_rate_bp: Mapped[int] = mapped_column(Integer)
    term_days: Mapped[int] = mapped_column(Integer)
    issued_at: Mapped[datetime] = mapped_column(UTCDateTime())
    due_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    status: Mapped[LoanStatus] = mapped_column(
        str_enum(LoanStatus), default=LoanStatus.ACTIVE, index=True
    )
    extensions_count: Mapped[int] = mapped_column(Integer, default=0)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    application: Mapped["Application"] = relationship(back_populates="loan")
    offer: Mapped["Offer"] = relationship()
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="loan", cascade="all, delete-orphan", order_by="Payment.created_at"
    )


class Payment(IdMixin, Base):
    """Money movement via the (mock) payment gateway. Amount in tiyn."""

    __tablename__ = "payments"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    loan_id: Mapped[int] = mapped_column(ForeignKey("loans.id", ondelete="CASCADE"), index=True)
    kind: Mapped[PaymentKind] = mapped_column(str_enum(PaymentKind))
    status: Mapped[PaymentStatus] = mapped_column(
        str_enum(PaymentStatus), default=PaymentStatus.PENDING
    )
    amount: Mapped[int] = mapped_column(Integer)
    # Masked card / account, e.g. "4400 43** **** 1234".
    destination: Mapped[str | None] = mapped_column(String(64))
    provider_ref: Mapped[str | None] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    loan: Mapped[Loan] = relationship(back_populates="payments")
