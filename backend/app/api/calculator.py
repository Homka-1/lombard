"""Public loan calculator (landing page)."""

from fastapi import APIRouter

from app.api.offer_views import quote_read
from app.core.deps import SessionDep
from app.schemas.review import CalculatorRequest, CalculatorResult
from app.services.calculator import CalculatorInput, calculate

router = APIRouter(tags=["calculator"])


@router.post(
    "/calculator",
    response_model=CalculatorResult,
    summary="Калькулятор займа: по стоимости или по параметрам изделия",
)
def loan_calculator(data: CalculatorRequest, session: SessionDep) -> CalculatorResult:
    out = calculate(session, CalculatorInput(**data.model_dump()))
    return CalculatorResult(
        category_id=out.category.id,
        category_name=out.category.name,
        ltv_percent=out.category.ltv_percent,
        market_value=out.market_value,
        value_min=out.value_min,
        value_max=out.value_max,
        estimated=out.estimated,
        estimate_steps=out.estimate_steps,
        max_loan_amount=out.max_loan_amount,
        quote=quote_read(out.quote),
    )
