"""Public reference data for the application wizard."""

from fastapi import APIRouter

from app.core.deps import SessionDep
from app.domain.enums import ItemCondition, Metal
from app.domain.pricing import CATEGORY_METALS, CONDITION_LABELS, FINENESS_BY_METAL, METAL_LABELS
from app.schemas.catalog import CategoryRead, ConditionRead, MetalRead
from app.services.catalog import active_categories, current_metal_prices

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/categories", response_model=list[CategoryRead], summary="Категории залога")
def list_categories(session: SessionDep) -> list[CategoryRead]:
    result = []
    for cat in active_categories(session):
        metals = CATEGORY_METALS.get(cat.code) if cat.requires_metal else None
        allowed = [m for m in Metal if metals is None or m in metals]
        result.append(
            CategoryRead(
                id=cat.id,
                code=cat.code,
                name=cat.name,
                description=cat.description,
                ltv_percent=cat.ltv_percent,
                daily_rate_bp=cat.daily_rate_bp,
                min_term_days=cat.min_term_days,
                max_term_days=cat.max_term_days,
                requires_metal=cat.requires_metal,
                allowed_metals=allowed,
            )
        )
    return result


@router.get("/metals", response_model=list[MetalRead], summary="Металлы, пробы и цены")
def list_metals(session: SessionDep) -> list[MetalRead]:
    prices = current_metal_prices(session)
    return [
        MetalRead(
            metal=metal,
            label=METAL_LABELS[metal],
            finenesses=list(FINENESS_BY_METAL[metal]),
            price_per_gram=prices[metal].price_per_gram if metal in prices else None,
            effective_from=prices[metal].effective_from if metal in prices else None,
        )
        for metal in Metal
    ]


@router.get("/conditions", response_model=list[ConditionRead], summary="Состояние изделия")
def list_conditions() -> list[ConditionRead]:
    return [ConditionRead(condition=c, label=CONDITION_LABELS[c]) for c in ItemCondition]
