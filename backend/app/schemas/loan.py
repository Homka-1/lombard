"""Loan, payment, notification and admin schemas. Money in tiyn, times in UTC."""

import datetime as dt
from datetime import datetime

from pydantic import BaseModel, Field

from app.domain.enums import (
    ApplicationStatus,
    LoanStatus,
    NotificationChannel,
    PaymentKind,
    PaymentStatus,
)
from app.schemas.offer import UserBrief

CARD_EXAMPLE = "4400 4301 2345 6789"


class CardBody(BaseModel):
    card_number: str = Field(
        min_length=12,
        max_length=32,
        examples=[CARD_EXAMPLE],
        description="Номер карты (мок-банк: 4000 0000 0000 0002 — отказ банка, "
        "4000 0000 0000 9995 — нет средств для списания)",
    )


class ExtendBody(CardBody):
    term_days: int | None = Field(
        default=None, ge=1, le=365, description="Новый срок от сегодня; по умолчанию — прежний"
    )


class PaymentRead(BaseModel):
    id: int
    kind: PaymentKind
    kind_label: str
    status: PaymentStatus
    status_label: str
    amount: int
    destination: str | None = Field(description="Маскированный номер карты")
    provider_ref: str | None
    created_at: datetime


class ExtensionQuoteRead(BaseModel):
    term_days: int
    pay_now: int = Field(description="Начисленные проценты — оплатить сейчас")
    days_used: int
    new_due_date: dt.date
    total_at_new_due: int = Field(description="Сумма к возврату в новый срок")
    extensions_left: int


class LoanApplicationBrief(BaseModel):
    id: int
    number: str
    title: str
    category_name: str
    status: ApplicationStatus
    status_label: str


class LoanSummaryRead(BaseModel):
    """Loan as shown in the application card."""

    id: int
    ticket_number: str
    status: LoanStatus
    status_label: str
    principal: int
    daily_rate_bp: int
    rate_label: str
    issued_at: datetime
    due_date: dt.date = Field(description="Вернуть до конца этого дня (время Казахстана)")
    grace_until: dt.date = Field(description="Последний день льготного периода")
    days_used: int
    accrued_interest: int
    total_to_repay: int = Field(description="Погасить сегодня: тело + проценты")
    days_left: int = Field(description="Дней до срока; отрицательное — просрочка")
    overdue_days: int
    grace_days_left: int
    due_soon: bool
    extensions_count: int
    closed_at: datetime | None
    ticket_url: str


class LoanRead(LoanSummaryRead):
    application: LoanApplicationBrief
    client: UserBrief
    term_days: int = Field(description="Срок текущего периода (после продления — новый)")
    due_at: datetime
    interest_from: datetime
    total_at_due: int = Field(description="К возврату в срок текущего периода")
    extensions_left: int
    extension: ExtensionQuoteRead | None = Field(
        description="Продление на прежний срок: сколько платить сейчас"
    )
    payments: list[PaymentRead]
    actions: list[str]
    now: datetime = Field(description="Время, на которое сделан расчёт (часы приложения)")


# --- Notifications ------------------------------------------------------------------------


class NotificationRead(BaseModel):
    id: int
    channel: NotificationChannel
    title: str
    body: str
    is_read: bool
    application_id: int | None
    created_at: datetime


class UnreadCount(BaseModel):
    unread: int


class OutboxItem(NotificationRead):
    user: UserBrief
    email: str


# --- Admin --------------------------------------------------------------------------------


class ClockRead(BaseModel):
    now: datetime
    offset_seconds: int
    offset_days: float
    enabled: bool


class ClockAdvance(BaseModel):
    days: int = Field(default=0, ge=0, le=365)
    hours: int = Field(default=0, ge=0, le=24 * 365)
    run_jobs: bool = Field(default=True, description="Сразу обработать просрочки и офферы")


class JobsResult(BaseModel):
    now: datetime
    offers_expired: int
    loans_overdue: int
    loans_forfeited: int


class ClockAdvanceResult(ClockRead):
    jobs: JobsResult | None


class FunnelRead(BaseModel):
    draft: int
    review: int
    logistics: int
    loans: int
    closed: int
    declined: int


class StatsRead(BaseModel):
    now: datetime
    applications_total: int
    by_status: dict[str, int]
    funnel: FunnelRead
    loans_active: int
    loans_overdue: int
    loans_repaid: int
    loans_forfeited: int
    loans_due_soon: int
    portfolio_principal: int = Field(description="Выдано и не возвращено, тиын")
    accrued_interest: int = Field(description="Начислено по открытым займам на сейчас")
    issued_total: int
    repaid_total: int
    interest_income: int = Field(description="Полученные проценты")
    failed_payments: int
    users_by_role: dict[str, int]
    couriers_open_tasks: int
    courier_tasks_today: int
