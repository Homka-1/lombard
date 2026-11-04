"""Serialisation of offers and loan quotes (shared by the applications and expert APIs)."""

from datetime import date

from app.domain.enums import OfferStatus
from app.domain.loan_calc import LoanQuote, format_rate, quote
from app.models import Offer
from app.schemas.offer import LoanQuoteRead, OfferRead, SchedulePointRead, UserBrief

OFFER_STATUS_LABELS: dict[OfferStatus, str] = {
    OfferStatus.SENT: "Ждёт решения клиента",
    OfferStatus.ACCEPTED: "Принято",
    OfferStatus.DECLINED: "Отклонено клиентом",
    OfferStatus.EXPIRED: "Истёк срок",
    OfferStatus.SUPERSEDED: "Заменено новым",
}


def quote_read(q: LoanQuote) -> LoanQuoteRead:
    return LoanQuoteRead(
        loan_amount=q.loan_amount,
        daily_rate_bp=q.daily_rate_bp,
        rate_label=format_rate(q.daily_rate_bp),
        annual_rate_percent=q.annual_rate_percent,
        term_days=q.term_days,
        interest=q.interest,
        total_to_repay=q.total_to_repay,
        start_date=q.start_date,
        due_date=q.due_date,
        grace_until=q.grace_until,
        schedule=[
            SchedulePointRead(
                day=p.day,
                date=p.date,
                interest=p.interest,
                total=p.total,
                is_due_date=p.is_due_date,
            )
            for p in q.schedule
        ],
    )


def offer_read(offer: Offer, today: date) -> OfferRead:
    appraisal = offer.appraisal
    details = appraisal.details or {}
    q = quote(offer.loan_amount, offer.daily_rate_bp, offer.term_days, today)
    return OfferRead(
        id=offer.id,
        status=offer.status,
        status_label=OFFER_STATUS_LABELS[offer.status],
        market_value=appraisal.value,
        value_min=appraisal.value_min,
        value_max=appraisal.value_max,
        ltv_percent=details.get("ltv_percent"),
        hallmark_confirmed=details.get("hallmark_confirmed"),
        loan_amount=offer.loan_amount,
        daily_rate_bp=offer.daily_rate_bp,
        rate_label=format_rate(offer.daily_rate_bp),
        term_days=offer.term_days,
        interest=offer.total_to_repay - offer.loan_amount,
        total_to_repay=offer.total_to_repay,
        comment=offer.comment,
        expert=UserBrief.model_validate(offer.expert),
        expires_at=offer.expires_at,
        decided_at=offer.decided_at,
        created_at=offer.created_at,
        quote=quote_read(q),
    )
