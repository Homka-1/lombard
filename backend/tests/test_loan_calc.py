"""Pure loan calculator: interest, LTV rounding, schedule, validation."""

from datetime import date

import pytest

from app.domain.loan_calc import (
    GRACE_DAYS,
    MIN_LOAN_AMOUNT,
    CategoryTerms,
    annual_rate_percent,
    format_rate,
    interest_for,
    max_loan_amount,
    quote,
    schedule,
    validate_terms,
)
from app.domain.money import tenge

GOLD = CategoryTerms("Золото", ltv_percent=80, daily_rate_bp=25, min_term_days=7, max_term_days=60)


def test_interest_matches_mockup() -> None:
    # Expert screen mockup: 119 000 ₸ × 80 % → 95 200 ₸; 0,2 %/day × 30 days → 5 712 ₸.
    loan = max_loan_amount(tenge(119_000), 80)
    assert loan == tenge(95_200)
    assert interest_for(loan, 20, 30) == tenge(5_712)
    # Landing mockup: 95 000 ₸ × 0,2 % × 30 → 5 700 ₸.
    assert interest_for(tenge(95_000), 20, 30) == tenge(5_700)


def test_interest_rounds_half_up_to_tiyn() -> None:
    assert interest_for(1, 25, 200) == 1  # 0.5 tiyn → 1
    assert interest_for(1, 25, 199) == 0  # 0.4975 → 0
    assert interest_for(tenge(1000), 0, 30) == 0
    with pytest.raises(ValueError):
        interest_for(-1, 25, 1)


def test_max_loan_rounds_down_to_hundreds() -> None:
    assert max_loan_amount(tenge(100_049), 80) == tenge(80_000)
    assert max_loan_amount(tenge(100_199), 50) == tenge(50_000)
    assert max_loan_amount(tenge(100_200), 50) == tenge(50_100)
    assert max_loan_amount(tenge(100), 50) == 0


def test_rate_labels() -> None:
    assert format_rate(25) == "0,25 % в день"
    assert format_rate(20) == "0,2 % в день"
    assert format_rate(100) == "1 % в день"
    assert format_rate(5) == "0,05 % в день"
    assert annual_rate_percent(20) == 73.0


def test_quote_dates_and_totals() -> None:
    q = quote(tenge(95_000), 20, 30, date(2026, 11, 3))
    assert q.interest == tenge(5_700)
    assert q.total_to_repay == tenge(100_700)
    assert q.due_date == date(2026, 12, 3)  # "Вернуть 3 декабря" on the landing
    assert (q.grace_until - q.due_date).days == GRACE_DAYS
    assert "100 700 ₸" in q.summary and "03.12.2026" in q.summary
    with pytest.raises(ValueError):
        quote(tenge(1000), 20, 0, date(2026, 11, 3))


def test_schedule_points() -> None:
    pts = schedule(tenge(10_000), 25, 30, date(2026, 1, 1))
    assert [p.day for p in pts] == [1, 7, 14, 21, 28, 30]
    assert pts[0].interest == tenge(25) and pts[0].total == tenge(10_025)
    assert pts[-1].is_due_date and not any(p.is_due_date for p in pts[:-1])
    assert pts[-1].date == date(2026, 1, 31)
    assert [p.day for p in schedule(tenge(1000), 25, 7, date(2026, 1, 1))] == [1, 7]
    assert [p.day for p in schedule(tenge(1000), 25, 1, date(2026, 1, 1))] == [1]
    totals = [p.total for p in pts]
    assert totals == sorted(totals)


def valid(**kw):
    args = {
        "market_value": tenge(119_000),
        "ltv_percent": 80,
        "daily_rate_bp": 20,
        "term_days": 30,
    }
    args.update(kw)
    return validate_terms(GOLD, **args)


def test_validate_ok() -> None:
    assert valid() == []
    assert valid(loan_amount=tenge(50_000)) == []
    assert valid(term_days=7) == [] and valid(term_days=60) == []


@pytest.mark.parametrize(
    ("kw", "field"),
    [
        ({"ltv_percent": 81}, "ltv_percent"),
        ({"ltv_percent": 0}, "ltv_percent"),
        ({"daily_rate_bp": 26}, "daily_rate_bp"),
        ({"daily_rate_bp": 0}, "daily_rate_bp"),
        ({"term_days": 6}, "term_days"),
        ({"term_days": 61}, "term_days"),
        ({"market_value": 0}, "market_value"),
        ({"market_value": tenge(1_000)}, "market_value"),  # 800 ₸ < minimum loan
        ({"loan_amount": tenge(95_300)}, "loan_amount"),  # above 80 %
        ({"loan_amount": tenge(500)}, "loan_amount"),
        ({"loan_amount": tenge(50_050)}, "loan_amount"),  # not whole hundreds
    ],
)
def test_validate_errors(kw: dict, field: str) -> None:
    errors = valid(**kw)
    assert [f for f, _ in errors] == [field], errors


def test_validate_messages_are_russian() -> None:
    [(_, msg)] = valid(daily_rate_bp=30)
    assert "Золото" in msg and "0,25" in msg
    [(_, msg)] = valid(loan_amount=tenge(100_000))
    assert "95 200 ₸" in msg
    assert tenge(1_000) == MIN_LOAN_AMOUNT
