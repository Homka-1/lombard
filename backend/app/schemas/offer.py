"""Offer and loan quote read schemas (shared by applications and the expert API)."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.domain.enums import OfferStatus


class SchedulePointRead(BaseModel):
    day: int = Field(description="День займа")
    date: date
    interest: int = Field(description="Проценты, накопленные к этому дню, тиын")
    total: int = Field(description="Сумма к возврату в этот день, тиын")
    is_due_date: bool


class LoanQuoteRead(BaseModel):
    loan_amount: int
    daily_rate_bp: int
    rate_label: str = Field(description="«0,25 % в день»")
    annual_rate_percent: float = Field(description="Номинальная годовая ставка (× 365), справочно")
    term_days: int
    interest: int
    total_to_repay: int
    start_date: date
    due_date: date
    grace_until: date = Field(description="Последний день льготного периода после срока")
    schedule: list[SchedulePointRead]


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    phone: str | None
    city: str | None


class OfferRead(BaseModel):
    id: int
    status: OfferStatus
    status_label: str
    market_value: int
    value_min: int
    value_max: int
    ltv_percent: int | None
    hallmark_confirmed: bool | None
    loan_amount: int
    daily_rate_bp: int
    rate_label: str
    term_days: int
    interest: int
    total_to_repay: int
    comment: str | None
    expert: UserBrief
    expires_at: datetime | None
    decided_at: datetime | None
    created_at: datetime
    quote: LoanQuoteRead = Field(
        description="Расчёт при выдаче сегодня (точные даты фиксируются при выдаче средств)"
    )
