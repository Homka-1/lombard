"""Application, photo and appraisal schemas. Money in tiyn (1 ₸ = 100 tiyn)."""

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.enums import ApplicationStatus, AppraisalKind, ItemCondition, Metal, Role
from app.schemas.logistics import CourierVisitRead
from app.schemas.offer import OfferRead, UserBrief

MAX_REQUESTED_AMOUNT = 100_000_000_00  # 100 млн ₸


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split())
    return value or None


class ApplicationParams(BaseModel):
    """Item parameters shared by create and update."""

    description: str | None = Field(default=None, max_length=4000)
    metal: Metal | None = None
    fineness: int | None = Field(default=None, ge=1, le=999, description="Проба: 585, 750, 925…")
    weight_g: Decimal | None = Field(
        default=None, gt=0, le=10_000, decimal_places=3, description="Вес в граммах, до 0,001 г"
    )
    brand: str | None = Field(default=None, max_length=100)
    condition: ItemCondition | None = None
    requested_amount: int | None = Field(
        default=None, gt=0, le=MAX_REQUESTED_AMOUNT, description="Желаемая сумма займа, тиын"
    )

    @field_validator("brand")
    @classmethod
    def _brand(cls, value: str | None) -> str | None:
        return _strip_or_none(value)

    @field_validator("description")
    @classmethod
    def _description(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class ApplicationCreate(ApplicationParams):
    category_id: int
    title: str = Field(min_length=2, max_length=200, description="Например, «Кольцо с бриллиантом»")

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Минимальная длина — 2 симв.")
        return value


class ApplicationUpdate(ApplicationParams):
    """Partial update: only sent fields change; `null` clears an optional field."""

    category_id: int | None = None
    title: str | None = Field(default=None, min_length=2, max_length=200)

    @field_validator("title")
    @classmethod
    def _title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Минимальная длина — 2 симв.")
        return value


class CategoryBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    requires_metal: bool
    ltv_percent: int


class PhotoRead(BaseModel):
    id: int
    position: int
    original_name: str
    content_type: str
    size_bytes: int
    width: int | None
    height: int | None
    quality_score: int | None = Field(description="0–100, оценка качества снимка")
    url: str = Field(description="Подписанная ссылка на фото (действует ограниченное время)")
    thumb_url: str
    created_at: datetime


class AppraisalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: AppraisalKind
    value_min: int
    value_max: int
    value: int
    confidence: int
    comment: str | None
    details: dict[str, Any] | None
    created_at: datetime


class StatusHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    from_status: ApplicationStatus | None
    to_status: ApplicationStatus
    to_status_label: str
    actor_role: Role | None
    comment: str | None
    created_at: datetime


class ApplicationListItem(BaseModel):
    id: int
    number: str
    status: ApplicationStatus
    status_label: str
    title: str
    category: CategoryBrief
    photo_count: int
    cover_thumb_url: str | None
    pre_estimate_min: int | None
    pre_estimate_max: int | None
    created_at: datetime
    submitted_at: datetime | None
    updated_at: datetime


class ApplicationRead(BaseModel):
    id: int
    number: str
    client_id: int
    status: ApplicationStatus
    status_label: str
    category: CategoryBrief
    title: str
    description: str | None
    metal: Metal | None
    fineness: int | None
    weight_g: float | None
    brand: str | None
    condition: ItemCondition | None
    requested_amount: int | None
    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None
    editable: bool = Field(description="Клиент может менять параметры и фото")
    can_submit: bool = Field(description="Статус позволяет отправить заявку")
    max_photos: int
    photos: list[PhotoRead]
    pre_estimate: AppraisalRead | None = Field(description="Последняя автоматическая предоценка")
    client: UserBrief
    expert: UserBrief | None = Field(description="Эксперт, который ведёт заявку")
    expert_appraisal: AppraisalRead | None = Field(description="Последняя экспертная оценка")
    offer: OfferRead | None = Field(description="Последнее предложение (займ) по заявке")
    courier_visit: CourierVisitRead | None = Field(
        description="Текущий (последний не отменённый) выезд курьера"
    )
    inspection: AppraisalRead | None = Field(
        description="Результат осмотра в ломбарде; details.loan_amount — итоговая сумма займа"
    )
    actions: list[str] = Field(
        description=(
            "Действия, доступные текущему пользователю: edit, submit, delete, accept_offer, "
            "decline_offer, schedule_courier, reschedule_courier (клиент); take, send_offer, "
            "request_info, reject, inspect (эксперт); schedule_courier, reschedule_courier "
            "(админ)"
        )
    )
    history: list[StatusHistoryRead]


class PhotoOrder(BaseModel):
    photo_ids: list[int] = Field(min_length=1, description="Все фото заявки в новом порядке")
