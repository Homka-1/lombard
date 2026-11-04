"""Loan lifecycle: disbursement, repayment, extension, overdue / forfeit, item return.

INSPECTED → FUNDS_ISSUED → LOAN_ACTIVE → REPAID → ITEM_RETURNED
                                       ↘ EXTENDED → LOAN_ACTIVE
                                       ↘ OVERDUE → REPAID | EXTENDED | FORFEITED

Money goes through `PaymentGateway` (a mock by default). Every function takes `now`
from the application clock (see `app/services/clock.py`). Functions do not commit.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domain.enums import (
    ApplicationStatus,
    CourierTaskKind,
    LoanStatus,
    PaymentKind,
    PaymentStatus,
    Role,
)
from app.domain.loan_calc import GRACE_DAYS, interest_for, quote
from app.domain.loans import (
    LoanFigures,
    LoanPhase,
    card_problem,
    due_at_for,
    extended_due_date,
    figures,
    mask_card,
    normalize_card,
    ticket_number,
)
from app.domain.logistics import Slot, SlotRules, local_today
from app.domain.money import format_kzt
from app.models import Application, Loan, Payment, StatusHistory, User
from app.services import logistics
from app.services.errors import ConflictError, NotFoundError, Problem, ValidationProblems
from app.services.inspection import accepted_offer, latest_inspection
from app.services.notifications import notify
from app.services.payments import GatewayResult, PaymentGateway
from app.services.status import change_status

S = ApplicationStatus
OPEN_LOAN_STATUSES = frozenset({LoanStatus.ACTIVE, LoanStatus.OVERDUE})
LOAN_NOT_FOUND = "Займ не найден"


class PaymentDeclinedError(Exception):
    """The (mock) bank declined the operation (→ 402). Message is user-facing.

    For card charges a FAILED payment is recorded: commit, then report the error.
    """


def _date(d) -> str:  # type: ignore[no-untyped-def]
    return d.strftime("%d.%m.%Y")


def _check_card(card_number: str) -> str:
    problem = card_problem(card_number)
    if problem:
        raise ValidationProblems([Problem("card_number", problem)], "Проверьте данные карты")
    return normalize_card(card_number)


def loan_figures(loan: Loan, now: datetime, grace_days: int = GRACE_DAYS) -> LoanFigures:
    return figures(
        principal=loan.principal,
        daily_rate_bp=loan.daily_rate_bp,
        interest_from=loan.interest_from or loan.issued_at,
        due_at=loan.due_at,
        now=now,
        grace_days=grace_days,
    )


def _history_note(session: Session, app: Application, user: User | None, text: str, at) -> None:  # type: ignore[no-untyped-def]
    """Timeline line without a status change."""
    entry = StatusHistory(
        from_status=app.status,
        to_status=app.status,
        actor_id=user.id if user else None,
        actor_role=user.role if user else None,
        comment=text,
        created_at=at,
    )
    app.history.append(entry)
    session.add(entry)


# --- Disbursement -------------------------------------------------------------------------


@dataclass(frozen=True)
class PayoutTerms:
    """Final terms from the inspection; dates are fixed on the day of the payout."""

    offer_id: int
    loan_amount: int
    daily_rate_bp: int
    term_days: int


def payout_terms(app: Application) -> PayoutTerms:
    if app.status is not S.INSPECTED:
        raise ConflictError("Деньги выдаются после осмотра изделия экспертом")
    if app.loan is not None:
        raise ConflictError("Займ по заявке уже выдан")
    insp = latest_inspection(app)
    details = (insp.details if insp else None) or {}
    if not details.get("loan_amount"):
        raise ConflictError("Нет результатов осмотра")
    return PayoutTerms(
        offer_id=int(details.get("offer_id") or accepted_offer(app).id),
        loan_amount=int(details["loan_amount"]),
        daily_rate_bp=int(details["daily_rate_bp"]),
        term_days=int(details["term_days"]),
    )


def issue_funds(
    session: Session,
    app: Application,
    user: User,
    card_number: str,
    *,
    gateway: PaymentGateway,
    now: datetime,
) -> Loan:
    """Pay the loan out to the client's card and open the loan (pledge ticket).

    INSPECTED → FUNDS_ISSUED → LOAN_ACTIVE. Requested by the client (or an admin on the
    client's behalf); the status changes are made by the system after the payout.
    """
    terms = payout_terms(app)
    card = _check_card(card_number)
    calc = quote(terms.loan_amount, terms.daily_rate_bp, terms.term_days, local_today(now))
    number = ticket_number(app.id, now)
    result = gateway.payout(card, terms.loan_amount, reference=number)
    if not result.ok:
        raise PaymentDeclinedError(f"Не удалось перевести деньги: {result.message}")

    loan = Loan(
        offer_id=terms.offer_id,
        ticket_number=number,
        principal=terms.loan_amount,
        daily_rate_bp=terms.daily_rate_bp,
        term_days=terms.term_days,
        issued_at=now,
        due_at=due_at_for(calc.due_date),
        interest_from=now,
        status=LoanStatus.ACTIVE,
        extensions_count=0,
    )
    app.loan = loan
    session.add(loan)
    loan.payments.append(
        Payment(
            kind=PaymentKind.DISBURSEMENT,
            status=PaymentStatus.SUCCEEDED,
            amount=terms.loan_amount,
            destination=mask_card(card),
            provider_ref=result.provider_ref,
            created_at=now,
            processed_at=now,
        )
    )
    actor = user if user.role is Role.ADMIN else None
    change_status(
        session,
        app,
        S.FUNDS_ISSUED,
        user=actor,
        comment=f"{format_kzt(terms.loan_amount)} отправлено на карту {mask_card(card)}",
        at=now,
    )
    change_status(
        session,
        app,
        S.LOAN_ACTIVE,
        comment=f"Залоговый билет {number}: вернуть {format_kzt(calc.total_to_repay)} "
        f"до {_date(calc.due_date)}",
        at=now,
    )
    notify(
        session,
        app.client_id,
        f"Деньги отправлены: {format_kzt(terms.loan_amount)}",
        f"Займ по заявке {app.number} выдан на карту {mask_card(card)}. Залоговый билет "
        f"{number}. Вернуть {format_kzt(calc.total_to_repay)} до {_date(calc.due_date)}.",
        application=app,
        sms=True,
        email=True,
        at=now,
    )
    session.flush()
    return loan


# --- Overdue and forfeit ------------------------------------------------------------------


def sync_loan(session: Session, loan: Loan, now: datetime, grace_days: int = GRACE_DAYS) -> bool:
    """Bring an open loan's status in line with the clock. Returns True if it changed."""
    changed = False
    app = loan.application
    phase = loan_figures(loan, now, grace_days).phase
    if loan.status is LoanStatus.ACTIVE and phase is not LoanPhase.ACTIVE:
        loan.status = LoanStatus.OVERDUE
        f = loan_figures(loan, now, grace_days)
        change_status(
            session, app, S.OVERDUE, comment=f"Срок займа истёк {_date(f.due_date)}", at=now
        )
        notify(
            session,
            app.client_id,
            f"Займ просрочен: {loan.ticket_number}",
            f"Срок возврата был {_date(f.due_date)}. Погасите займ или продлите его до "
            f"{_date(f.grace_until)} — после этой даты изделие перейдёт ломбарду. "
            f"Сейчас к оплате {format_kzt(f.total_to_repay)}.",
            application=app,
            sms=True,
            email=True,
            at=now,
        )
        changed = True
    if loan.status is LoanStatus.OVERDUE and phase is LoanPhase.FORFEIT:
        loan.status = LoanStatus.FORFEITED
        loan.closed_at = now
        change_status(
            session,
            app,
            S.FORFEITED,
            comment="Льготный период закончился, изделие перешло ломбарду",
            at=now,
        )
        notify(
            session,
            app.client_id,
            f"Изделие перешло ломбарду: {loan.ticket_number}",
            "Льготный период после срока займа закончился. По условиям залогового билета "
            "изделие перешло в собственность ломбарда, долг по займу закрыт.",
            application=app,
            sms=True,
            email=True,
            at=now,
        )
        changed = True
    if changed:
        session.flush()
    return changed


def process_loans(session: Session, now: datetime, grace_days: int = GRACE_DAYS) -> dict[str, int]:
    """Periodic job: overdue / forfeit loans whose due date has passed."""
    loans = session.scalars(
        select(Loan)
        .where(Loan.status.in_(OPEN_LOAN_STATUSES), Loan.due_at < now)
        .options(selectinload(Loan.application))
        .order_by(Loan.id)
    )
    counts = {"overdue": 0, "forfeited": 0}
    for loan in loans:
        before = loan.status
        if sync_loan(session, loan, now, grace_days):
            if before is LoanStatus.ACTIVE:
                counts["overdue"] += 1
            if loan.status is LoanStatus.FORFEITED:
                counts["forfeited"] += 1
    return counts


# --- Repayment and extension --------------------------------------------------------------


def _ensure_open(loan: Loan) -> None:
    if loan.status is LoanStatus.FORFEITED:
        raise ConflictError("Льготный период закончился: изделие перешло ломбарду")
    if loan.status not in OPEN_LOAN_STATUSES:
        raise ConflictError("Займ уже закрыт")


def _charge(
    session: Session,
    loan: Loan,
    kind: PaymentKind,
    card: str,
    amount: int,
    gateway: PaymentGateway,
    now: datetime,
) -> Payment:
    result: GatewayResult = gateway.charge(card, amount, reference=loan.ticket_number)
    payment = Payment(
        kind=kind,
        status=PaymentStatus.SUCCEEDED if result.ok else PaymentStatus.FAILED,
        amount=amount,
        destination=mask_card(card),
        provider_ref=result.provider_ref,
        created_at=now,
        processed_at=now,
    )
    loan.payments.append(payment)
    session.add(payment)
    if not result.ok:
        session.flush()
        raise PaymentDeclinedError(f"Оплата не прошла: {result.message}")
    return payment


def repay(
    session: Session,
    loan: Loan,
    client: User,
    card_number: str,
    *,
    gateway: PaymentGateway,
    now: datetime,
    grace_days: int = GRACE_DAYS,
) -> Payment:
    """Full repayment: principal + interest for the days used. → REPAID."""
    sync_loan(session, loan, now, grace_days)
    _ensure_open(loan)
    card = _check_card(card_number)
    f = loan_figures(loan, now, grace_days)
    payment = _charge(session, loan, PaymentKind.REPAYMENT, card, f.total_to_repay, gateway, now)
    loan.status = LoanStatus.REPAID
    loan.closed_at = now
    app = loan.application
    change_status(
        session,
        app,
        S.REPAID,
        user=client,
        comment=f"Займ погашен: {format_kzt(f.total_to_repay)} "
        f"(проценты {format_kzt(f.interest)} за {f.days_used} дн.)",
        at=now,
    )
    notify(
        session,
        app.client_id,
        f"Займ погашен: {loan.ticket_number}",
        f"Оплата {format_kzt(f.total_to_repay)} получена. Выберите время, когда курьер "
        f"привезёт изделие.",
        application=app,
        sms=True,
        at=now,
    )
    session.flush()
    return payment


@dataclass(frozen=True)
class ExtensionQuote:
    term_days: int
    pay_now: int  # accrued interest
    days_used: int
    new_due_date: object  # date
    total_at_new_due: int
    extensions_left: int


def extension_quote(
    loan: Loan,
    term_days: int | None,
    now: datetime,
    *,
    max_extensions: int,
    grace_days: int = GRACE_DAYS,
) -> ExtensionQuote:
    """Validate an extension and compute what it costs (nothing saved)."""
    _ensure_open(loan)
    category = loan.application.category
    term = term_days or loan.term_days
    problems: list[Problem] = []
    if not category.min_term_days <= term <= category.max_term_days:
        problems.append(
            Problem(
                "term_days",
                f"{category.name}: срок от {category.min_term_days} "
                f"до {category.max_term_days} дней",
            )
        )
    if problems:
        raise ValidationProblems(problems, "Проверьте условия продления")
    if loan.extensions_count >= max_extensions:
        raise ConflictError(f"Займ можно продлить не больше {max_extensions} раз")
    f = loan_figures(loan, now, grace_days)
    return ExtensionQuote(
        term_days=term,
        pay_now=f.interest,
        days_used=f.days_used,
        new_due_date=extended_due_date(now, term),
        total_at_new_due=loan.principal + interest_for(loan.principal, loan.daily_rate_bp, term),
        extensions_left=max_extensions - loan.extensions_count - 1,
    )


def extend(
    session: Session,
    loan: Loan,
    client: User,
    card_number: str,
    term_days: int | None,
    *,
    gateway: PaymentGateway,
    now: datetime,
    max_extensions: int,
    grace_days: int = GRACE_DAYS,
) -> Payment:
    """Pay the accrued interest; a new term starts today. → EXTENDED → LOAN_ACTIVE."""
    sync_loan(session, loan, now, grace_days)
    plan = extension_quote(
        loan, term_days, now, max_extensions=max_extensions, grace_days=grace_days
    )
    card = _check_card(card_number)
    payment = _charge(session, loan, PaymentKind.EXTENSION, card, plan.pay_now, gateway, now)
    loan.status = LoanStatus.ACTIVE
    loan.interest_from = now
    loan.due_at = due_at_for(plan.new_due_date)  # type: ignore[arg-type]
    loan.term_days = plan.term_days
    loan.extensions_count += 1
    app = loan.application
    change_status(
        session,
        app,
        S.EXTENDED,
        user=client,
        comment=f"Оплачены проценты {format_kzt(plan.pay_now)} за {plan.days_used} дн.",
        at=now,
    )
    change_status(
        session,
        app,
        S.LOAN_ACTIVE,
        comment=f"Займ продлён на {plan.term_days} дн., до {_date(plan.new_due_date)}",
        at=now,
    )
    notify(
        session,
        app.client_id,
        f"Займ продлён: {loan.ticket_number}",
        f"Проценты {format_kzt(plan.pay_now)} оплачены. Новый срок — "
        f"{_date(plan.new_due_date)}, к возврату {format_kzt(plan.total_at_new_due)}.",
        application=app,
        sms=True,
        at=now,
    )
    session.flush()
    return payment


# --- Item return --------------------------------------------------------------------------


def can_schedule_return(app: Application) -> bool:
    return app.status is S.REPAID and logistics.current_task(app, CourierTaskKind.RETURN) is None


def schedule_return(
    session: Session,
    app: Application,
    user: User,
    data: logistics.VisitInput,
    *,
    now: datetime,
    rules: SlotRules,
):  # type: ignore[no-untyped-def]
    """After repayment: book a courier to bring the item back (status stays REPAID)."""
    if app.status is not S.REPAID:
        raise ConflictError("Вернуть изделие можно после погашения займа")
    if not can_schedule_return(app):
        raise ConflictError("Возврат изделия уже запланирован")
    task = logistics.book_visit(session, app, CourierTaskKind.RETURN, data, now=now, rules=rules)
    slot = Slot(task.slot_start, task.slot_end).label
    _history_note(session, app, user, f"Возврат изделия: курьер приедет {slot}", now)
    assert task.courier is not None
    notify(
        session,
        app.client_id,
        f"Возврат изделия запланирован: {app.number}",
        f"Курьер {task.courier.full_name} привезёт изделие {slot} по адресу: "
        f"{data.city}, {data.address}.",
        application=app,
        at=now,
    )
    session.flush()
    return task


# --- Reading ------------------------------------------------------------------------------


def _loan_options():  # type: ignore[no-untyped-def]
    return (
        selectinload(Loan.application).selectinload(Application.category),
        selectinload(Loan.application).selectinload(Application.client),
        selectinload(Loan.application).selectinload(Application.courier_tasks),
        selectinload(Loan.payments),
    )


def list_loans(session: Session, user: User, status: LoanStatus | None = None) -> list[Loan]:
    """Client: own loans. Admin: all."""
    stmt = select(Loan).options(*_loan_options())
    if user.role is Role.CLIENT:
        stmt = stmt.join(Application, Application.id == Loan.application_id).where(
            Application.client_id == user.id
        )
    if status is not None:
        stmt = stmt.where(Loan.status == status)
    return list(session.scalars(stmt.order_by(Loan.issued_at.desc(), Loan.id.desc())))


def get_loan(session: Session, loan_id: int, user: User) -> Loan:
    loan = session.scalar(select(Loan).where(Loan.id == loan_id).options(*_loan_options()))
    if loan is None:
        raise NotFoundError(LOAN_NOT_FOUND)
    if user.role is Role.CLIENT and loan.application.client_id != user.id:
        raise NotFoundError(LOAN_NOT_FOUND)
    if user.role not in (Role.CLIENT, Role.ADMIN):
        raise NotFoundError(LOAN_NOT_FOUND)
    return loan


def loan_actions(loan: Loan, viewer: User) -> list[str]:
    actions = ["ticket"]
    if viewer.role is Role.CLIENT and loan.status in OPEN_LOAN_STATUSES:
        actions += ["repay", "extend"]
    if viewer.role is Role.CLIENT and can_schedule_return(loan.application):
        actions.append("schedule_return")
    return actions
