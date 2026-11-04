"""Loan calculator: LTV, simple daily interest, repayment amount and accrual schedule.

Pure functions (no DB, no FastAPI) — the same code is ported to the demo (stage 13).
Amounts are integers in tiyn (1 ₸ = 100 tiyn); the rate is in basis points per day
(25 bp = 0,25 % в день). A pawn loan is repaid in one payment: principal + interest
for the days used (at least one day), so the "schedule" shows how much is due on a
given day, with the last row being the due date.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from app.domain.money import TIYN_PER_TENGE, format_kzt, tenge

BP_DENOMINATOR = 10_000  # 1 bp = 0.01 % = 1/10 000
GRACE_DAYS = 30  # after the due date: still repayable, then the item is forfeited
MIN_LOAN_AMOUNT = tenge(1_000)
MAX_MARKET_VALUE = tenge(100_000_000)
MIN_RATE_BP = 1
LOAN_STEP_TENGE = 100  # loan amounts are whole hundreds of tenge
SCHEDULE_STEP_DAYS = 7


def interest_for(principal: int, daily_rate_bp: int, days: int) -> int:
    """Simple interest in tiyn, rounded half up: principal × rate × days."""
    if principal < 0 or daily_rate_bp < 0 or days < 0:
        raise ValueError("principal, rate and days must be non-negative")
    return (principal * daily_rate_bp * days + BP_DENOMINATOR // 2) // BP_DENOMINATOR


def max_loan_amount(market_value: int, ltv_percent: int) -> int:
    """Market value × LTV, rounded *down* to whole hundreds of tenge (never above LTV)."""
    step = LOAN_STEP_TENGE * TIYN_PER_TENGE
    return market_value * ltv_percent // 100 // step * step


def format_rate(daily_rate_bp: int) -> str:
    """`25` → `0,25 % в день`, `20` → `0,2 % в день`."""
    whole, frac = divmod(daily_rate_bp, 100)
    tail = f",{frac:02d}".rstrip("0") if frac else ""
    return f"{whole}{tail} % в день"


def annual_rate_percent(daily_rate_bp: int) -> float:
    """Nominal annual rate (rate × 365), for reference: `20` → `73.0`."""
    return round(daily_rate_bp * 365 / 100, 2)


@dataclass(frozen=True)
class SchedulePoint:
    day: int
    date: date
    interest: int
    total: int
    is_due_date: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "day": self.day,
            "date": self.date.isoformat(),
            "interest": self.interest,
            "total": self.total,
            "is_due_date": self.is_due_date,
        }


@dataclass(frozen=True)
class LoanQuote:
    loan_amount: int
    daily_rate_bp: int
    term_days: int
    interest: int
    total_to_repay: int
    start_date: date
    due_date: date
    grace_until: date
    annual_rate_percent: float
    schedule: list[SchedulePoint] = field(default_factory=list)

    @property
    def summary(self) -> str:
        return (
            f"{format_kzt(self.loan_amount)} на {self.term_days} дн. под "
            f"{format_rate(self.daily_rate_bp)}: вернуть {format_kzt(self.total_to_repay)} "
            f"до {self.due_date.strftime('%d.%m.%Y')}"
        )


def schedule(
    loan_amount: int, daily_rate_bp: int, term_days: int, start: date
) -> list[SchedulePoint]:
    """Amount due if repaid on day 1, 7, 14, … and on the due date."""
    days = sorted({1, *range(SCHEDULE_STEP_DAYS, term_days, SCHEDULE_STEP_DAYS), term_days})
    points = []
    for day in days:
        interest = interest_for(loan_amount, daily_rate_bp, day)
        points.append(
            SchedulePoint(
                day=day,
                date=start + timedelta(days=day),
                interest=interest,
                total=loan_amount + interest,
                is_due_date=day == term_days,
            )
        )
    return points


def quote(loan_amount: int, daily_rate_bp: int, term_days: int, start: date) -> LoanQuote:
    """Terms of a loan issued on `start`. Inputs are assumed valid (see `validate_terms`)."""
    if term_days < 1:
        raise ValueError("term_days must be positive")
    interest = interest_for(loan_amount, daily_rate_bp, term_days)
    due = start + timedelta(days=term_days)
    return LoanQuote(
        loan_amount=loan_amount,
        daily_rate_bp=daily_rate_bp,
        term_days=term_days,
        interest=interest,
        total_to_repay=loan_amount + interest,
        start_date=start,
        due_date=due,
        grace_until=due + timedelta(days=GRACE_DAYS),
        annual_rate_percent=annual_rate_percent(daily_rate_bp),
        schedule=schedule(loan_amount, daily_rate_bp, term_days, start),
    )


@dataclass(frozen=True)
class CategoryTerms:
    """Limits of a category (from the reference table)."""

    name: str
    ltv_percent: int
    daily_rate_bp: int
    min_term_days: int
    max_term_days: int


def validate_terms(
    terms: CategoryTerms,
    *,
    market_value: int,
    ltv_percent: int,
    daily_rate_bp: int,
    term_days: int,
    loan_amount: int | None = None,
) -> list[tuple[str, str]]:
    """Check offer terms against the category limits. Returns `(field, message)` pairs.

    `loan_amount=None` means "maximum for the chosen LTV".
    """
    errors: list[tuple[str, str]] = []
    if market_value <= 0:
        errors.append(("market_value", "Стоимость должна быть больше нуля"))
    elif market_value > MAX_MARKET_VALUE:
        errors.append(("market_value", f"Стоимость не больше {format_kzt(MAX_MARKET_VALUE)}"))
    if not 1 <= ltv_percent <= terms.ltv_percent:
        errors.append(
            ("ltv_percent", f"{terms.name}: доля от оценки от 1 до {terms.ltv_percent} %")
        )
    if not MIN_RATE_BP <= daily_rate_bp <= terms.daily_rate_bp:
        errors.append(
            (
                "daily_rate_bp",
                f"{terms.name}: ставка от {format_rate(MIN_RATE_BP)} "
                f"до {format_rate(terms.daily_rate_bp)}",
            )
        )
    if not terms.min_term_days <= term_days <= terms.max_term_days:
        errors.append(
            (
                "term_days",
                f"{terms.name}: срок от {terms.min_term_days} до {terms.max_term_days} дней",
            )
        )
    if errors:
        return errors

    limit = max_loan_amount(market_value, ltv_percent)
    amount = limit if loan_amount is None else loan_amount
    field_name = "market_value" if loan_amount is None else "loan_amount"
    if amount < MIN_LOAN_AMOUNT:
        errors.append((field_name, f"Сумма займа не меньше {format_kzt(MIN_LOAN_AMOUNT)}"))
    elif loan_amount is not None and loan_amount > limit:
        errors.append(
            (
                "loan_amount",
                f"Не больше {format_kzt(limit)} ({ltv_percent} % от {format_kzt(market_value)})",
            )
        )
    elif loan_amount is not None and loan_amount % (LOAN_STEP_TENGE * TIYN_PER_TENGE):
        errors.append(("loan_amount", f"Сумма займа кратна {LOAN_STEP_TENGE}\u00a0₸"))
    return errors
