"""Active loan arithmetic: due dates, accrued interest, overdue / grace, bank cards.

Pure functions (no DB, no FastAPI) — ported to the demo (stage 13) one to one.

Dates of a loan are local Kazakhstan calendar dates (UTC+5); timestamps are UTC.
- The loan must be repaid by the end of the due date (23:59:59 local time).
- Interest accrues per started local day since `interest_from` (issue date or the last
  extension), at least one day, at the same daily rate also after the due date.
- After the due date there is a grace period (30 days by default) during which the
  client can still repay or extend; after it the item is forfeited to the pawnshop.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from enum import StrEnum
from types import MappingProxyType

from app.domain.enums import LoanStatus, PaymentKind, PaymentStatus
from app.domain.loan_calc import GRACE_DAYS, interest_for
from app.domain.logistics import KZ_TZ, local_today

END_OF_DAY = time(23, 59, 59)
DUE_SOON_DAYS = 3  # «скоро срок» in the UI


def due_at_for(due_date: date) -> datetime:
    """End of the local due date as an aware datetime (UTC+5)."""
    return datetime.combine(due_date, END_OF_DAY, KZ_TZ)


def local_date(moment: datetime) -> date:
    return moment.astimezone(KZ_TZ).date()


def days_used(interest_from: datetime, now: datetime) -> int:
    """Local calendar days since `interest_from`, at least 1 (the first day is paid)."""
    return max(1, (local_today(now) - local_date(interest_from)).days)


class LoanPhase(StrEnum):
    ACTIVE = "ACTIVE"  # before or on the due date
    OVERDUE = "OVERDUE"  # due date passed, within the grace period
    FORFEIT = "FORFEIT"  # grace period is over: the item goes to the pawnshop


@dataclass(frozen=True)
class LoanFigures:
    """What the loan looks like at `now`."""

    principal: int
    daily_rate_bp: int
    days_used: int
    interest: int  # accrued since `interest_from`
    total_to_repay: int  # principal + interest: pay this today to close the loan
    due_date: date
    grace_until: date
    days_left: int  # to the due date (0 on the due date, negative when overdue)
    overdue_days: int
    grace_days_left: int  # meaningful when overdue
    phase: LoanPhase

    @property
    def due_soon(self) -> bool:
        return self.phase is LoanPhase.ACTIVE and self.days_left <= DUE_SOON_DAYS


def phase_at(due_at: datetime, now: datetime, grace_days: int = GRACE_DAYS) -> LoanPhase:
    if now <= due_at:
        return LoanPhase.ACTIVE
    if now <= due_at + timedelta(days=grace_days):
        return LoanPhase.OVERDUE
    return LoanPhase.FORFEIT


def figures(
    *,
    principal: int,
    daily_rate_bp: int,
    interest_from: datetime,
    due_at: datetime,
    now: datetime,
    grace_days: int = GRACE_DAYS,
) -> LoanFigures:
    used = days_used(interest_from, now)
    interest = interest_for(principal, daily_rate_bp, used)
    today = local_today(now)
    due_date = local_date(due_at)
    grace_until = due_date + timedelta(days=grace_days)
    days_left = (due_date - today).days
    return LoanFigures(
        principal=principal,
        daily_rate_bp=daily_rate_bp,
        days_used=used,
        interest=interest,
        total_to_repay=principal + interest,
        due_date=due_date,
        grace_until=grace_until,
        days_left=days_left,
        overdue_days=max(0, -days_left),
        grace_days_left=max(0, (grace_until - today).days),
        phase=phase_at(due_at, now, grace_days),
    )


def extended_due_date(now: datetime, term_days: int) -> date:
    """After an extension the new term starts today."""
    return local_today(now) + timedelta(days=term_days)


def ticket_number(application_id: int, issued_at: datetime) -> str:
    """Pledge ticket number: `ЗБ-2026-000042`."""
    return f"ЗБ-{local_date(issued_at).year}-{application_id:06d}"


# --- Bank cards (mock payments) -----------------------------------------------------------


def normalize_card(number: str) -> str:
    """Digits only: spaces and dashes are allowed in the input."""
    return "".join(ch for ch in number if not ch.isspace() and ch != "-")


def luhn_ok(digits: str) -> bool:
    if not digits.isdigit():
        return False
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


def card_problem(number: str) -> str | None:
    """Russian error message, or None for a valid card number."""
    digits = normalize_card(number)
    if not digits.isdigit() or not 16 <= len(digits) <= 19:
        return "Номер карты — 16–19 цифр"
    if not luhn_ok(digits):
        return "Проверьте номер карты: похоже, в нём опечатка"
    return None


def mask_card(number: str) -> str:
    """`4400430123456789` → `4400 43** **** 6789`."""
    digits = normalize_card(number)
    masked = digits[:6] + "*" * (len(digits) - 10) + digits[-4:]
    return " ".join(masked[i : i + 4] for i in range(0, len(masked), 4))


# --- Labels -------------------------------------------------------------------------------

LOAN_STATUS_LABELS: Mapping[LoanStatus, str] = MappingProxyType(
    {
        LoanStatus.ACTIVE: "Действует",
        LoanStatus.OVERDUE: "Просрочен",
        LoanStatus.REPAID: "Погашен",
        LoanStatus.FORFEITED: "Изделие перешло ломбарду",
    }
)

PAYMENT_KIND_LABELS: Mapping[PaymentKind, str] = MappingProxyType(
    {
        PaymentKind.DISBURSEMENT: "Выдача займа",
        PaymentKind.REPAYMENT: "Погашение",
        PaymentKind.EXTENSION: "Оплата процентов (продление)",
    }
)

PAYMENT_STATUS_LABELS: Mapping[PaymentStatus, str] = MappingProxyType(
    {
        PaymentStatus.PENDING: "В обработке",
        PaymentStatus.SUCCEEDED: "Проведён",
        PaymentStatus.FAILED: "Отклонён",
    }
)
