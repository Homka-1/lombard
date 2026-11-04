"""Courier logistics and inspection schemas. Times in UTC (ISO 8601), money in tiyn."""

import datetime as dt
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.domain.enums import ApplicationStatus, CourierTaskKind, CourierTaskStatus
from app.domain.loan_calc import MAX_MARKET_VALUE
from app.schemas.offer import LoanQuoteRead, UserBrief
from app.schemas.user import validate_phone


class CityRead(BaseModel):
    city: str
    couriers: int = Field(description="Активных курьеров в городе")


class SlotRead(BaseModel):
    start: datetime
    end: datetime
    date: dt.date = Field(description="Дата по времени Казахстана")
    label: str = Field(description="«05.11, 10:00–12:00» (время Казахстана)")
    capacity: int
    free: int
    available: bool


class VisitCreate(BaseModel):
    """Where and when the courier should come."""

    city: str = Field(min_length=2, max_length=100, examples=["Алматы"])
    address: str = Field(
        min_length=5, max_length=500, examples=["ул. Абая, 150, кв. 12, подъезд 2, этаж 4"]
    )
    contact_phone: str | None = Field(
        default=None,
        examples=["+7 701 123-45-67"],
        description="По умолчанию — телефон из профиля клиента",
    )
    slot_start: datetime = Field(description="Начало слота из GET /api/delivery/slots")
    comment: str | None = Field(default=None, max_length=1000, examples=["Домофон 12В"])

    _phone = field_validator("contact_phone")(validate_phone)

    @field_validator("city", "address")
    @classmethod
    def _squash(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Слишком короткое значение")
        return value

    @field_validator("comment")
    @classmethod
    def _comment(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class CourierVisitRead(BaseModel):
    """Courier visit as shown on the application card."""

    id: int
    kind: CourierTaskKind
    kind_label: str
    status: CourierTaskStatus
    status_label: str
    courier: UserBrief | None
    city: str
    address: str
    contact_phone: str
    contact_phone_display: str
    slot_start: datetime
    slot_end: datetime
    slot_label: str
    comment: str | None
    completed_at: datetime | None


class TaskApplicationBrief(BaseModel):
    id: int
    number: str
    title: str
    category_name: str
    status: ApplicationStatus
    status_label: str


class CourierTaskRead(BaseModel):
    id: int
    kind: CourierTaskKind
    kind_label: str
    status: CourierTaskStatus
    status_label: str
    application: TaskApplicationBrief
    client: UserBrief
    courier: UserBrief | None
    city: str
    address: str
    contact_phone: str
    contact_phone_display: str
    slot_start: datetime
    slot_end: datetime
    slot_label: str
    comment: str | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    actions: list[str] = Field(
        description="Шаги, доступные текущему пользователю: start, pick_up, deliver (курьер); "
        "assign (админ)"
    )


class AssignCourierBody(BaseModel):
    courier_id: int


class CourierLoadRead(BaseModel):
    courier: UserBrief
    open_tasks: int = Field(description="Незавершённые выезды")
    today_tasks: int = Field(description="Выезды на сегодня")


# --- Inspection ---------------------------------------------------------------------------


class InspectionCreate(BaseModel):
    market_value: int | None = Field(
        default=None, gt=0, le=MAX_MARKET_VALUE, description="По умолчанию — экспертная оценка"
    )
    loan_amount: int | None = Field(
        default=None,
        gt=0,
        description="Итоговая сумма займа, тиын; не больше принятой клиентом. По умолчанию — "
        "принятая сумма (или меньше, если её не позволяет новая оценка)",
    )
    hallmark_confirmed: bool | None = Field(default=None, description="Проба/клеймо подтверждены")
    weight_g: Decimal | None = Field(
        default=None, gt=0, le=10_000, decimal_places=3, description="Вес по факту, г"
    )
    comment: str | None = Field(default=None, max_length=2000)


class InspectionPreview(BaseModel):
    market_value: int
    offer_loan_amount: int
    adjusted: bool
    quote: LoanQuoteRead
