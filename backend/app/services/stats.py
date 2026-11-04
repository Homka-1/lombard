"""Admin dashboard statistics."""

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domain.enums import ApplicationStatus, LoanStatus, PaymentKind, PaymentStatus, Role
from app.domain.logistics import local_today
from app.models import Application, CourierTask, Loan, User
from app.services import logistics
from app.services.loans import OPEN_LOAN_STATUSES, loan_figures

S = ApplicationStatus

# Funnel stages for the dashboard: how far applications have got.
REVIEW = {S.PRE_ESTIMATED, S.UNDER_REVIEW, S.NEED_INFO, S.OFFER_SENT}
LOGISTICS = {
    S.OFFER_ACCEPTED,
    S.COURIER_SCHEDULED,
    S.COURIER_EN_ROUTE,
    S.ITEM_PICKED_UP,
    S.ITEM_DELIVERED,
    S.INSPECTED,
}
LOANS = {S.FUNDS_ISSUED, S.LOAN_ACTIVE, S.EXTENDED, S.OVERDUE}
CLOSED = {S.REPAID, S.ITEM_RETURNED, S.FORFEITED}
DECLINED = {S.REJECTED, S.OFFER_DECLINED}


@dataclass
class Stats:
    applications_total: int = 0
    by_status: dict[str, int] = field(default_factory=dict)
    funnel: dict[str, int] = field(default_factory=dict)
    loans_active: int = 0
    loans_overdue: int = 0
    loans_repaid: int = 0
    loans_forfeited: int = 0
    portfolio_principal: int = 0  # open loans, tiyn
    accrued_interest: int = 0  # open loans, as of now
    issued_total: int = 0
    repaid_total: int = 0
    interest_income: int = 0  # paid interest: extensions + interest part of repayments
    failed_payments: int = 0
    due_soon: int = 0
    users_by_role: dict[str, int] = field(default_factory=dict)
    couriers_open_tasks: int = 0
    courier_tasks_today: int = 0


def collect(session: Session, now: datetime, grace_days: int) -> Stats:
    st = Stats()
    statuses = Counter(session.scalars(select(Application.status)))
    st.applications_total = sum(statuses.values())
    st.by_status = {s.value: statuses.get(s, 0) for s in S}
    st.funnel = {
        "draft": statuses.get(S.DRAFT, 0) + statuses.get(S.SUBMITTED, 0),
        "review": sum(statuses.get(s, 0) for s in REVIEW),
        "logistics": sum(statuses.get(s, 0) for s in LOGISTICS),
        "loans": sum(statuses.get(s, 0) for s in LOANS),
        "closed": sum(statuses.get(s, 0) for s in CLOSED),
        "declined": sum(statuses.get(s, 0) for s in DECLINED),
    }

    loans = list(session.scalars(select(Loan).options(selectinload(Loan.payments))))
    for loan in loans:
        if loan.status in OPEN_LOAN_STATUSES:
            f = loan_figures(loan, now, grace_days)
            st.portfolio_principal += loan.principal
            st.accrued_interest += f.interest
            st.due_soon += int(f.due_soon)
        st.loans_active += loan.status is LoanStatus.ACTIVE
        st.loans_overdue += loan.status is LoanStatus.OVERDUE
        st.loans_repaid += loan.status is LoanStatus.REPAID
        st.loans_forfeited += loan.status is LoanStatus.FORFEITED
        for p in loan.payments:
            if p.status is PaymentStatus.FAILED:
                st.failed_payments += 1
                continue
            if p.status is not PaymentStatus.SUCCEEDED:
                continue
            if p.kind is PaymentKind.DISBURSEMENT:
                st.issued_total += p.amount
            elif p.kind is PaymentKind.EXTENSION:
                st.interest_income += p.amount
            elif p.kind is PaymentKind.REPAYMENT:
                st.repaid_total += p.amount
                st.interest_income += p.amount - loan.principal

    roles = Counter(session.scalars(select(User.role).where(User.is_active.is_(True))))
    st.users_by_role = {r.value: roles.get(r, 0) for r in Role}
    st.couriers_open_tasks = sum(logistics.open_task_counts(session).values())
    today = local_today(now)
    st.courier_tasks_today = sum(
        1
        for t in session.scalars(select(CourierTask))
        if t.status.value != "CANCELLED" and local_today(t.slot_start) == today
    )
    return st
