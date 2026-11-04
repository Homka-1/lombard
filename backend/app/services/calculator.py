"""Public loan calculator for the landing page: category + value (or item parameters)."""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import ItemCondition, Metal
from app.domain.loan_calc import LoanQuote, max_loan_amount, quote, validate_terms
from app.domain.pricing import EstimateError, EstimateInput, estimate, validate_metal_params
from app.models import Category
from app.services.catalog import current_metal_prices
from app.services.errors import Problem, ValidationProblems
from app.services.review import category_terms, local_today


@dataclass(frozen=True)
class CalculatorInput:
    term_days: int
    category_id: int | None = None
    category_code: str | None = None
    market_value: int | None = None
    metal: Metal | None = None
    fineness: int | None = None
    weight_g: Decimal | None = None
    brand: str | None = None
    condition: ItemCondition | None = None
    loan_amount: int | None = None


@dataclass
class CalculatorOutput:
    category: Category
    market_value: int
    value_min: int
    value_max: int
    estimated: bool
    max_loan_amount: int
    quote: LoanQuote
    estimate_steps: list[dict[str, Any]] = field(default_factory=list)


def _category(session: Session, data: CalculatorInput) -> Category:
    stmt = select(Category).where(Category.is_active.is_(True))
    if data.category_id is not None:
        stmt = stmt.where(Category.id == data.category_id)
    else:
        stmt = stmt.where(Category.code == data.category_code)
    category = session.scalar(stmt)
    if category is None:
        raise ValidationProblems([Problem("category_id", "Категория не найдена")])
    return category


def calculate(session: Session, data: CalculatorInput) -> CalculatorOutput:
    category = _category(session, data)
    steps: list[dict[str, Any]] = []
    if data.market_value is not None:
        value = value_min = value_max = data.market_value
        estimated = False
    else:
        problems = [
            Problem(f, m)
            for f, m in validate_metal_params(
                category.code, category.requires_metal, data.metal, data.fineness
            )
        ]
        if problems:
            raise ValidationProblems(problems, "Проверьте параметры изделия")
        weight_mg = (
            int((data.weight_g * 1000).to_integral_value()) if data.weight_g is not None else None
        )
        price = current_metal_prices(session).get(data.metal) if data.metal else None
        try:
            result = estimate(
                EstimateInput(
                    category_code=category.code,
                    category_name=category.name,
                    requires_metal=category.requires_metal,
                    ltv_percent=category.ltv_percent,
                    metal=data.metal,
                    fineness=data.fineness,
                    weight_mg=weight_mg,
                    brand=data.brand,
                    condition=data.condition,
                    metal_price_per_gram=price.price_per_gram if price else None,
                    photo_confidence=None,
                )
            )
        except EstimateError as exc:
            raise ValidationProblems(
                [Problem("market_value", f"{exc}. Или укажите стоимость изделия")],
                "Недостаточно данных для расчёта",
            ) from exc
        value, value_min, value_max = result.value, result.value_min, result.value_max
        estimated = True
        steps = result.steps

    errors = validate_terms(
        category_terms(category),
        market_value=value,
        ltv_percent=category.ltv_percent,
        daily_rate_bp=category.daily_rate_bp,
        term_days=data.term_days,
        loan_amount=data.loan_amount,
    )
    if errors:
        raise ValidationProblems([Problem(f, m) for f, m in errors], "Проверьте условия расчёта")
    limit = max_loan_amount(value, category.ltv_percent)
    amount = data.loan_amount if data.loan_amount is not None else limit
    return CalculatorOutput(
        category=category,
        market_value=value,
        value_min=value_min,
        value_max=value_max,
        estimated=estimated,
        max_loan_amount=limit,
        quote=quote(amount, category.daily_rate_bp, data.term_days, local_today()),
        estimate_steps=steps,
    )
