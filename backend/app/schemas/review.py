"""Expert review, offer and loan-calculator schemas. Money in tiyn, rate in bp per day."""

from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.domain.enums import ItemCondition, Metal
from app.domain.loan_calc import MAX_MARKET_VALUE
from app.schemas.application import ApplicationListItem
from app.schemas.offer import LoanQuoteRead, UserBrief

# --- Expert -------------------------------------------------------------------------------


class OfferTerms(BaseModel):
    """Terms the expert proposes. Defaults come from the category (LTV, rate)."""

    market_value: int = Field(gt=0, le=MAX_MARKET_VALUE, description="Рыночная стоимость, тиын")
    ltv_percent: int | None = Field(
        default=None, ge=1, le=100, description="Доля от оценки, %; по умолчанию — LTV категории"
    )
    daily_rate_bp: int | None = Field(
        default=None, ge=1, le=10_000, description="Ставка, б.п. в день; по умолчанию — категории"
    )
    term_days: int = Field(ge=1, le=365, description="Срок займа, дней")
    loan_amount: int | None = Field(
        default=None, gt=0, description="Сумма займа, тиын; по умолчанию — максимум по LTV"
    )
    value_min: int | None = Field(default=None, ge=0, description="Нижняя граница оценки")
    value_max: int | None = Field(default=None, ge=0, description="Верхняя граница оценки")
    confidence: int | None = Field(default=None, ge=0, le=100)
    hallmark_confirmed: bool | None = Field(
        default=None, description="Проба/клеймо подтверждается по фото"
    )


class OfferCreate(OfferTerms):
    comment: str | None = Field(default=None, max_length=2000, description="Комментарий клиенту")


class CommentBody(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)


class RejectBody(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


class DeclineBody(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


class QueueItem(ApplicationListItem):
    client: UserBrief
    expert: UserBrief | None = Field(description="Эксперт, который ведёт (или вёл) заявку")
    pre_estimate_value: int | None
    pre_estimate_confidence: int | None
    requested_amount: int | None


# --- Public calculator --------------------------------------------------------------------


class CalculatorRequest(BaseModel):
    """Either `market_value`, or item parameters for an estimate by the formula."""

    category_id: int | None = None
    category_code: str | None = Field(default=None, max_length=50)
    term_days: int = Field(ge=1, le=365)
    market_value: int | None = Field(default=None, gt=0, le=MAX_MARKET_VALUE)
    metal: Metal | None = None
    fineness: int | None = Field(default=None, ge=1, le=999)
    weight_g: Decimal | None = Field(default=None, gt=0, le=10_000, decimal_places=3)
    brand: str | None = Field(default=None, max_length=100)
    condition: ItemCondition | None = None
    loan_amount: int | None = Field(default=None, gt=0, description="Желаемая сумма, тиын")

    @model_validator(mode="after")
    def _category(self) -> "CalculatorRequest":
        if self.category_id is None and not self.category_code:
            raise ValueError("Укажите категорию (category_id или category_code)")
        return self


class CalculatorResult(BaseModel):
    category_id: int
    category_name: str
    ltv_percent: int
    market_value: int = Field(description="Оценка, на которую опирается расчёт")
    value_min: int
    value_max: int
    estimated: bool = Field(description="Стоимость рассчитана по формуле, а не введена")
    estimate_steps: list[dict] = Field(default_factory=list)
    max_loan_amount: int
    quote: LoanQuoteRead
