"""In-person inspection of a delivered item: ITEM_DELIVERED → INSPECTED.

The expert confirms the item and the final loan amount. The amount may only go down
from the accepted offer (the client agreed to that maximum); rate and term stay as
accepted. The final terms live in `Appraisal(kind=INSPECTION).details` and are used
to open the loan at disbursement (stage 8).
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.domain.enums import ApplicationStatus, AppraisalKind, OfferStatus
from app.domain.loan_calc import LoanQuote, max_loan_amount
from app.domain.money import format_kzt
from app.models import Application, Appraisal, Offer, User
from app.models.base import utcnow
from app.services.errors import ConflictError, Problem, ValidationProblems
from app.services.notifications import notify
from app.services.review import (
    OfferInput,
    build_quote,
    latest_expert_appraisal,
    local_today,
)
from app.services.status import change_status

S = ApplicationStatus
INSPECTION_CONFIDENCE = 100


@dataclass(frozen=True)
class InspectionInput:
    market_value: int | None = None  # None — keep the expert appraisal
    loan_amount: int | None = None  # None — accepted amount, capped by LTV of the new value
    hallmark_confirmed: bool | None = None
    weight_g: Decimal | None = None  # measured weight
    comment: str | None = None


@dataclass(frozen=True)
class InspectionPlan:
    offer: Offer
    market_value: int
    ltv_percent: int
    quote: LoanQuote

    @property
    def adjusted(self) -> bool:
        return self.quote.loan_amount != self.offer.loan_amount


def accepted_offer(app: Application) -> Offer:
    accepted = [o for o in app.offers if o.status is OfferStatus.ACCEPTED]
    if not accepted:
        raise ConflictError("По заявке нет принятого предложения")
    return max(accepted, key=lambda o: (o.created_at, o.id))


def latest_inspection(app: Application) -> Appraisal | None:
    items = [a for a in app.appraisals if a.kind is AppraisalKind.INSPECTION]
    return max(items, key=lambda a: (a.created_at, a.id)) if items else None


def plan_inspection(app: Application, data: InspectionInput, now: datetime) -> InspectionPlan:
    """Validate the inspection result and compute the final loan terms (nothing saved)."""
    if app.status is not S.ITEM_DELIVERED:
        raise ConflictError("Осмотр возможен, когда изделие доставлено в ломбард")
    offer = accepted_offer(app)
    expert = latest_expert_appraisal(app)
    market_value = data.market_value or (expert.value if expert else offer.appraisal.value)
    details = offer.appraisal.details or {}
    ltv = int(details.get("ltv_percent") or app.category.ltv_percent)

    amount = data.loan_amount
    if amount is None:
        amount = min(offer.loan_amount, max_loan_amount(market_value, ltv))
    if amount > offer.loan_amount:
        raise ValidationProblems(
            [
                Problem(
                    "loan_amount",
                    f"Сумма не может превышать согласованную с клиентом "
                    f"({format_kzt(offer.loan_amount)})",
                )
            ],
            "Проверьте результат осмотра",
        )
    terms = build_quote(
        app.category,
        OfferInput(
            market_value=market_value,
            ltv_percent=ltv,
            daily_rate_bp=offer.daily_rate_bp,
            term_days=offer.term_days,
            loan_amount=amount,
        ),
        local_today(now),
    )
    return InspectionPlan(offer=offer, market_value=market_value, ltv_percent=ltv, quote=terms)


def inspect(
    session: Session,
    app: Application,
    expert: User,
    data: InspectionInput,
    now: datetime | None = None,
) -> Appraisal:
    """Record the inspection and move the application to INSPECTED. The client is notified."""
    now = now or utcnow()
    plan = plan_inspection(app, data, now)
    terms = plan.quote
    comment = (data.comment or "").strip() or None
    if plan.adjusted and comment is None:
        raise ValidationProblems(
            [Problem("comment", "Объясните клиенту, почему сумма изменилась")],
            "Проверьте результат осмотра",
        )

    appraisal = Appraisal(
        kind=AppraisalKind.INSPECTION,
        appraiser_id=expert.id,
        value=plan.market_value,
        value_min=plan.market_value,
        value_max=plan.market_value,
        confidence=INSPECTION_CONFIDENCE,
        comment=comment,
        details={
            "offer_id": plan.offer.id,
            "offer_loan_amount": plan.offer.loan_amount,
            "loan_amount": terms.loan_amount,
            "adjusted": plan.adjusted,
            "ltv_percent": plan.ltv_percent,
            "daily_rate_bp": terms.daily_rate_bp,
            "term_days": terms.term_days,
            "total_to_repay": terms.total_to_repay,
            "hallmark_confirmed": data.hallmark_confirmed,
            "weight_g": str(data.weight_g) if data.weight_g is not None else None,
        },
        created_at=now,
    )
    app.appraisals.append(appraisal)
    session.add(appraisal)

    if plan.adjusted:
        summary = (
            f"Осмотр: сумма займа скорректирована "
            f"{format_kzt(plan.offer.loan_amount)} → {format_kzt(terms.loan_amount)}"
        )
        body = (
            f"Эксперт осмотрел изделие. Сумма займа изменена: {format_kzt(terms.loan_amount)} "
            f"вместо {format_kzt(plan.offer.loan_amount)}. Причина: {comment}"
        )
    else:
        summary = f"Осмотр: подлинность подтверждена, сумма {format_kzt(terms.loan_amount)}"
        body = (
            f"Эксперт осмотрел изделие и подтвердил сумму займа "
            f"{format_kzt(terms.loan_amount)}. Скоро деньги поступят на карту."
        )
    change_status(session, app, S.INSPECTED, user=expert, comment=summary)
    notify(session, app.client_id, f"Осмотр завершён: {app.number}", body, application=app)
    session.flush()
    return appraisal
