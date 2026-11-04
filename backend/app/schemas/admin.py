"""Admin reference data and staff schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.enums import Metal, Role
from app.schemas.auth import RegisterRequest


class AdminCategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str | None
    ltv_percent: int
    daily_rate_bp: int
    min_term_days: int
    max_term_days: int
    requires_metal: bool
    sort_order: int
    is_active: bool


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    ltv_percent: int | None = Field(default=None, ge=1, le=100)
    daily_rate_bp: int | None = Field(default=None, ge=1, le=1000)
    min_term_days: int | None = Field(default=None, ge=1, le=365)
    max_term_days: int | None = Field(default=None, ge=1, le=365)
    sort_order: int | None = None
    is_active: bool | None = None


class CategoryCreate(BaseModel):
    code: str = Field(min_length=2, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    ltv_percent: int = Field(ge=1, le=100)
    daily_rate_bp: int = Field(ge=1, le=1000, description="Ставка в б.п. в день: 25 = 0,25 %")
    min_term_days: int = Field(default=7, ge=1, le=365)
    max_term_days: int = Field(default=60, ge=1, le=365)
    requires_metal: bool = False
    sort_order: int = 100

    @model_validator(mode="after")
    def _terms(self) -> "CategoryCreate":
        if self.max_term_days < self.min_term_days:
            raise ValueError("Максимальный срок меньше минимального")
        return self


class MetalPriceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    metal: Metal
    price_per_gram: int = Field(description="Тиын за грамм металла 999 пробы")
    effective_from: datetime
    source: str
    is_current: bool = False


class MetalPriceCreate(BaseModel):
    metal: Metal
    price_per_gram: int = Field(gt=0, le=10_000_000_00, description="Тиын за грамм 999")
    effective_from: datetime | None = Field(default=None, description="По умолчанию — сейчас")
    source: str = Field(default="manual", max_length=100)

    @field_validator("effective_from")
    @classmethod
    def _aware(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Укажите время с часовым поясом, например 2026-11-05T09:00:00+05:00")
        return value


class StaffCreate(RegisterRequest):
    role: Role = Role.EXPERT

    @model_validator(mode="after")
    def _courier_city(self) -> "StaffCreate":
        if self.role is Role.COURIER and not self.city:
            raise ValueError("Для курьера укажите город обслуживания")
        return self
