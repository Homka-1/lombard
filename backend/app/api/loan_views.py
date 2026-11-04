"""Loan serialisation (shared by the applications card and the loans API)."""

from datetime import datetime

from app.core.config import Settings
from app.domain.loan_calc import format_rate, interest_for
from app.domain.loans import LOAN_STATUS_LABELS, PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS
from app.domain.state_machine import STATUS_LABELS
from app.models import Loan, Payment, User
from app.schemas.loan import (
    ExtensionQuoteRead,
    LoanApplicationBrief,
    LoanRead,
    LoanSummaryRead,
    PaymentRead,
)
from app.schemas.offer import UserBrief
from app.services import loans as svc
from app.services.errors import ConflictError, ValidationProblems


def payment_read(p: Payment) -> PaymentRead:
    return PaymentRead(
        id=p.id,
        kind=p.kind,
        kind_label=PAYMENT_KIND_LABELS[p.kind],
        status=p.status,
        status_label=PAYMENT_STATUS_LABELS[p.status],
        amount=p.amount,
        destination=p.destination,
        provider_ref=p.provider_ref,
        created_at=p.created_at,
    )


def _summary_fields(loan: Loan, now: datetime, settings: Settings) -> dict:
    f = svc.loan_figures(loan, now, settings.grace_period_days)
    return {
        "id": loan.id,
        "ticket_number": loan.ticket_number,
        "status": loan.status,
        "status_label": LOAN_STATUS_LABELS[loan.status],
        "principal": loan.principal,
        "daily_rate_bp": loan.daily_rate_bp,
        "rate_label": format_rate(loan.daily_rate_bp),
        "issued_at": loan.issued_at,
        "due_date": f.due_date,
        "grace_until": f.grace_until,
        "days_used": f.days_used,
        "accrued_interest": f.interest,
        "total_to_repay": f.total_to_repay,
        "days_left": f.days_left,
        "overdue_days": f.overdue_days,
        "grace_days_left": f.grace_days_left,
        "due_soon": f.due_soon,
        "extensions_count": loan.extensions_count,
        "closed_at": loan.closed_at,
        "ticket_url": f"{settings.api_prefix}/loans/{loan.id}/ticket",
    }


def loan_summary_read(loan: Loan, now: datetime, settings: Settings) -> LoanSummaryRead:
    return LoanSummaryRead(**_summary_fields(loan, now, settings))


def loan_read(loan: Loan, viewer: User, now: datetime, settings: Settings) -> LoanRead:
    app = loan.application
    extension = None
    if loan.status in svc.OPEN_LOAN_STATUSES:
        try:
            q = svc.extension_quote(
                loan,
                None,
                now,
                max_extensions=settings.max_loan_extensions,
                grace_days=settings.grace_period_days,
            )
            extension = ExtensionQuoteRead(
                term_days=q.term_days,
                pay_now=q.pay_now,
                days_used=q.days_used,
                new_due_date=q.new_due_date,  # type: ignore[arg-type]
                total_at_new_due=q.total_at_new_due,
                extensions_left=q.extensions_left,
            )
        except (ConflictError, ValidationProblems):
            extension = None
    actions = svc.loan_actions(loan, viewer)
    if extension is None and "extend" in actions:
        actions.remove("extend")
    return LoanRead(
        **_summary_fields(loan, now, settings),
        application=LoanApplicationBrief(
            id=app.id,
            number=app.number,
            title=app.title,
            category_name=app.category.name,
            status=app.status,
            status_label=STATUS_LABELS[app.status],
        ),
        client=UserBrief.model_validate(app.client),
        term_days=loan.term_days,
        due_at=loan.due_at,
        interest_from=loan.interest_from or loan.issued_at,
        total_at_due=loan.principal
        + interest_for(loan.principal, loan.daily_rate_bp, loan.term_days),
        extensions_left=max(0, settings.max_loan_extensions - loan.extensions_count),
        extension=extension,
        payments=[payment_read(p) for p in loan.payments],
        actions=actions,
        now=now,
    )
