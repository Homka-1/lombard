from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.domain.enums import ItemCondition, Metal


class CategoryRead(BaseModel):
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
    allowed_metals: list[Metal]


class MetalRead(BaseModel):
    metal: Metal
    label: str
    finenesses: list[int]
    price_per_gram: int | None  # tiyn per gram of 999 metal
    effective_from: datetime | None


class ConditionRead(BaseModel):
    condition: ItemCondition
    label: str
