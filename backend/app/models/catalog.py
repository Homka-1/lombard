"""Reference data: item categories and metal prices."""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.enums import Metal
from app.models.base import Base, IdMixin, TimestampMixin, UTCDateTime, str_enum, utcnow


class Category(IdMixin, TimestampMixin, Base):
    """Item category with loan terms.

    `ltv_percent` — loan-to-value, % of market value; `daily_rate_bp` — interest
    per day in basis points (25 = 0.25 % per day).
    """

    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint("ltv_percent > 0 AND ltv_percent <= 100", name="ltv_range"),
        CheckConstraint("daily_rate_bp >= 0", name="rate_non_negative"),
        CheckConstraint("min_term_days >= 1 AND max_term_days >= min_term_days", name="term_range"),
    )

    code: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    ltv_percent: Mapped[int] = mapped_column(Integer)
    daily_rate_bp: Mapped[int] = mapped_column(Integer)
    min_term_days: Mapped[int] = mapped_column(Integer, default=7)
    max_term_days: Mapped[int] = mapped_column(Integer, default=60)
    requires_metal: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    def __repr__(self) -> str:
        return f"<Category {self.code} ltv={self.ltv_percent}%>"


class MetalPrice(IdMixin, Base):
    """Price of pure (999) metal per gram, in tiyn. Latest `effective_from` wins."""

    __tablename__ = "metal_prices"
    __table_args__ = (
        UniqueConstraint("metal", "effective_from"),
        CheckConstraint("price_per_gram > 0", name="price_positive"),
    )

    metal: Mapped[Metal] = mapped_column(str_enum(Metal), index=True)
    price_per_gram: Mapped[int] = mapped_column(Integer)
    effective_from: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    source: Mapped[str] = mapped_column(String(100), default="manual")

    def __repr__(self) -> str:
        return f"<MetalPrice {self.metal} {self.price_per_gram} from {self.effective_from}>"
