"""Reference data lookups: categories and current metal prices."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import Metal
from app.models import Category, MetalPrice
from app.models.base import utcnow


def active_categories(session: Session) -> list[Category]:
    stmt = select(Category).where(Category.is_active.is_(True)).order_by(Category.sort_order)
    return list(session.scalars(stmt))


def current_metal_prices(session: Session, at: datetime | None = None) -> dict[Metal, MetalPrice]:
    """Latest price per metal with `effective_from <= at` (default: now)."""
    at = at or utcnow()
    stmt = (
        select(MetalPrice)
        .where(MetalPrice.effective_from <= at)
        .order_by(MetalPrice.metal, MetalPrice.effective_from.desc())
    )
    prices: dict[Metal, MetalPrice] = {}
    for price in session.scalars(stmt):
        prices.setdefault(price.metal, price)
    return prices
