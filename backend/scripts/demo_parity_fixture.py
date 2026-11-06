"""Reference values for the demo mock API (stage 13).

The demo (`demo/`, `frontend/demo-src/mock-api.js`) re-implements the pricing formula,
the loan calculator and loan arithmetic in plain JavaScript. This script computes the same
cases with the backend code; `frontend/src/demo/mockApi.test.ts` checks that the JS port
gives identical numbers and texts.

    cd backend && python scripts/demo_parity_fixture.py   # rewrites the fixture
"""

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from app.domain.enums import ItemCondition, Metal
from app.domain.loan_calc import CategoryTerms, quote, validate_terms
from app.domain.loans import card_problem, figures, mask_card
from app.domain.logistics import KZ_TZ
from app.domain.phone import normalize_kz_phone
from app.domain.pricing import EstimateInput, estimate

OUT = Path(__file__).resolve().parents[2] / "frontend/src/demo/parity.fixture.json"

ESTIMATES = [
    {"category_code": "gold", "category_name": "Золото", "requires_metal": True, "ltv_percent": 80,
     "metal": "GOLD", "fineness": 585, "weight_mg": 4200, "condition": "GOOD",
     "metal_price_per_gram": 6650000, "photo_confidence": 84},
    {"category_code": "gold", "category_name": "Золото", "requires_metal": True, "ltv_percent": 80,
     "metal": "GOLD", "fineness": 750, "weight_mg": 12345, "brand": "Cartier", "condition": None,
     "metal_price_per_gram": 6650000, "photo_confidence": None},
    {"category_code": "watches", "category_name": "Часы", "requires_metal": False,
     "ltv_percent": 60, "brand": "Omega Seamaster", "condition": "EXCELLENT",
     "photo_confidence": 71},
    {"category_code": "watches", "category_name": "Часы", "requires_metal": False,
     "ltv_percent": 60, "brand": "Rolex", "condition": "GOOD", "metal": "GOLD", "fineness": 750,
     "weight_mg": 150000, "metal_price_per_gram": 6650000, "photo_confidence": 90},
    {"category_code": "electronics", "category_name": "Электроника", "requires_metal": False,
     "ltv_percent": 50, "brand": "Noname", "condition": "FAIR", "photo_confidence": 40},
    {"category_code": "silver", "category_name": "Серебро", "requires_metal": True,
     "ltv_percent": 70, "metal": "SILVER", "fineness": 925, "weight_mg": 31100,
     "brand": "Pandora", "condition": "POOR", "metal_price_per_gram": 82000,
     "photo_confidence": 63},
]  # fmt: skip

TERMS = [
    {"market_value": 15000000, "ltv_percent": 90, "daily_rate_bp": 30, "term_days": 90},
    {"market_value": 15000000, "ltv_percent": 80, "daily_rate_bp": 25, "term_days": 30,
     "loan_amount": 12000050},
    {"market_value": 15000000, "ltv_percent": 80, "daily_rate_bp": 25, "term_days": 30,
     "loan_amount": 11999950},
    {"market_value": 100000, "ltv_percent": 80, "daily_rate_bp": 25, "term_days": 30},
]  # fmt: skip


def main() -> None:
    estimates = []
    for case in ESTIMATES:
        kwargs = dict(case)
        if kwargs.get("metal"):
            kwargs["metal"] = Metal(kwargs["metal"])
        if kwargs.get("condition"):
            kwargs["condition"] = ItemCondition(kwargs["condition"])
        r = estimate(EstimateInput(**kwargs))
        estimates.append(
            {
                "input": case,
                "value": r.value,
                "value_min": r.value_min,
                "value_max": r.value_max,
                "confidence": r.confidence,
                "loan_min": r.loan_min,
                "loan_max": r.loan_max,
                "steps": r.steps,
                "warnings": r.warnings,
                "summary": r.summary,
            }
        )

    q = quote(12_000_000, 25, 30, date(2026, 11, 6))
    gold = CategoryTerms("Золото", 80, 25, 7, 60)
    issued = datetime(2026, 11, 6, 9, 0, tzinfo=UTC)
    due = datetime(2026, 11, 13, 23, 59, 59, tzinfo=KZ_TZ)
    loan_figures = []
    for days in (0, 7, 8, 40):
        now = issued + timedelta(days=days, hours=3)
        f = figures(
            principal=12_000_000, daily_rate_bp=25, interest_from=issued, due_at=due, now=now
        )
        loan_figures.append(
            {
                "now": now.isoformat(),
                "days_used": f.days_used,
                "interest": f.interest,
                "total_to_repay": f.total_to_repay,
                "due_date": f.due_date.isoformat(),
                "grace_until": f.grace_until.isoformat(),
                "days_left": f.days_left,
                "overdue_days": f.overdue_days,
                "grace_days_left": f.grace_days_left,
                "phase": f.phase.value,
                "due_soon": f.due_soon,
            }
        )

    fixture = {
        "estimates": estimates,
        "quote": {
            "input": {"amount": q.loan_amount, "bp": 25, "term": 30, "start": "2026-11-06"},
            "interest": q.interest,
            "total_to_repay": q.total_to_repay,
            "due_date": q.due_date.isoformat(),
            "grace_until": q.grace_until.isoformat(),
            "annual_rate_percent": q.annual_rate_percent,
            "schedule": [
                {
                    "day": p.day,
                    "date": p.date.isoformat(),
                    "interest": p.interest,
                    "total": p.total,
                    "is_due_date": p.is_due_date,
                }
                for p in q.schedule
            ],
        },
        "terms": [
            {"input": t, "errors": [list(e) for e in validate_terms(gold, **t)]} for t in TERMS
        ],
        "loan": {"issued_at": issued.isoformat(), "due_at": due.isoformat()},
        "figures": loan_figures,
        "cards": {
            n: card_problem(n) for n in ("4400 4301 2345 6789", "4400 4301 2345 6788", "1234")
        },
        "mask": mask_card("4400430123456789"),
        "phones": {p: normalize_kz_phone(p) for p in ("8 701 123 45 67", "7011234567")},
    }
    OUT.write_text(json.dumps(fixture, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"written {OUT}")


if __name__ == "__main__":
    main()
