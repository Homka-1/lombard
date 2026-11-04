"""Stage 8: payout, loan, repayment, extension, overdue / forfeit, item return, admin API."""

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.domain.enums import NotificationChannel
from app.domain.loan_calc import format_rate
from app.domain.loans import (
    LoanPhase,
    card_problem,
    days_used,
    due_at_for,
    figures,
    luhn_ok,
    mask_card,
    ticket_number,
)
from app.domain.logistics import KZ_TZ
from app.domain.money import tenge
from app.main import create_app
from app.models import Notification, Payment, User
from app.services.payments import DECLINED_CARD, DEMO_CARD, NO_FUNDS_CARD, MockPaymentGateway
from tests.test_applications import Headers
from tests.test_logistics import accepted, notes, schedule, slots, step
from tests.test_review import submitted

CARD = "4400 4301 2345 6789"
PRINCIPAL = tenge(95_200)
DAILY = tenge(190.40)  # 95 200 ₸ × 0,2 % per day


# --- Pure domain --------------------------------------------------------------------------


def test_due_at_is_end_of_local_day():
    due = due_at_for(date(2026, 12, 4))
    assert due.astimezone(UTC) == datetime(2026, 12, 4, 18, 59, 59, tzinfo=UTC)


def test_days_used_counts_local_days_at_least_one():
    issued = datetime(2026, 11, 4, 18, 30, tzinfo=UTC)  # 23:30 in Almaty
    assert days_used(issued, issued) == 1
    assert days_used(issued, issued + timedelta(hours=1)) == 1  # 00:30 next day — 1 day
    assert days_used(issued, issued + timedelta(days=10)) == 10


def test_figures_phases():
    issued = datetime(2026, 11, 4, 6, tzinfo=UTC)
    due = due_at_for(date(2026, 12, 4))
    kw = {"principal": PRINCIPAL, "daily_rate_bp": 20, "interest_from": issued, "due_at": due}
    f = figures(**kw, now=issued + timedelta(days=5))
    assert f.days_used == 5 and f.interest == 5 * DAILY
    assert f.total_to_repay == PRINCIPAL + 5 * DAILY
    assert f.phase is LoanPhase.ACTIVE and f.days_left == 25 and not f.due_soon
    assert figures(**kw, now=issued + timedelta(days=28)).due_soon
    on_due = figures(**kw, now=due)
    assert on_due.phase is LoanPhase.ACTIVE and on_due.days_left == 0
    late = figures(**kw, now=due + timedelta(seconds=1))
    assert late.phase is LoanPhase.OVERDUE and late.overdue_days == 1
    assert late.grace_until == date(2027, 1, 3) and late.grace_days_left == 29
    assert late.interest == 31 * DAILY  # interest keeps accruing
    assert figures(**kw, now=due + timedelta(days=30)).phase is LoanPhase.OVERDUE
    assert figures(**kw, now=due + timedelta(days=30, seconds=1)).phase is LoanPhase.FORFEIT


def test_cards():
    for card in (DEMO_CARD, DECLINED_CARD, NO_FUNDS_CARD, "4242424242424242"):
        assert luhn_ok(card)
    assert card_problem(CARD) is None
    assert card_problem("4400-4301-2345-6789") is None
    assert card_problem("4400 4301 2345 6788") == "Проверьте номер карты: похоже, в нём опечатка"
    assert card_problem("1234") == "Номер карты — 16–19 цифр"
    assert card_problem("4400 43ab 2345 6789") == "Номер карты — 16–19 цифр"
    assert mask_card(CARD) == "4400 43** **** 6789"


def test_ticket_number_uses_local_year():
    assert ticket_number(42, datetime(2026, 12, 31, 20, tzinfo=UTC)) == "ЗБ-2027-000042"


def test_mock_gateway():
    gw = MockPaymentGateway()
    assert gw.payout(CARD, 100, "x").ok
    assert gw.payout(NO_FUNDS_CARD, 100, "x").ok  # no funds matters only for charges
    assert gw.charge(NO_FUNDS_CARD, 100, "x").message == "Недостаточно средств на карте"
    declined = gw.charge(DECLINED_CARD, 100, "x")
    assert not declined.ok and declined.provider_ref is None
    assert [op[4] for op in gw.operations] == [True, True, False, False]


# --- Helpers ------------------------------------------------------------------------------


def inspected(client: TestClient, session: Session, h: Headers) -> int:
    """Application in INSPECTED: 95 200 ₸, 0,2 % per day, 30 days."""
    app_id = accepted(client, session, h)
    assert schedule(client, h, app_id, slots(client, h)[0]["start"]).status_code == 200
    task_id = client.get("/api/courier/tasks?scope=active", headers=h("courier")).json()[0]["id"]
    for name in ("start", "pick-up", "deliver"):
        assert step(client, h, task_id, name).status_code == 200
    resp = client.post(
        f"/api/expert/applications/{app_id}/inspection",
        json={"hallmark_confirmed": True},
        headers=h("expert"),
    )
    assert resp.status_code == 200, resp.text
    return app_id


def payout(client: TestClient, h: Headers, app_id: int, card: str = CARD, who="client"):
    return client.post(
        f"/api/applications/{app_id}/payout", json={"card_number": card}, headers=h(who)
    )


def issued(client: TestClient, session: Session, h: Headers) -> tuple[int, dict]:
    app_id = inspected(client, session, h)
    resp = payout(client, h, app_id)
    assert resp.status_code == 200, resp.text
    loan_id = resp.json()["loan"]["id"]
    return app_id, client.get(f"/api/loans/{loan_id}", headers=h("client")).json()


def advance(client: TestClient, h: Headers, days: int, hours: int = 0) -> dict:
    resp = client.post("/api/admin/clock", json={"days": days, "hours": hours}, headers=h("admin"))
    assert resp.status_code == 200, resp.text
    return resp.json()


def card_of(client: TestClient, h: Headers, app_id: int, who: str = "client") -> dict:
    return client.get(f"/api/applications/{app_id}", headers=h(who)).json()


# --- Full backend scenario ----------------------------------------------------------------


def test_full_scenario_from_application_to_item_return(
    client: TestClient, seeded: Session, h: Headers
):
    """Заявка → предоценка → оферта → курьер → осмотр → выдача → погашение → возврат."""
    app_id = inspected(client, seeded, h)
    card = card_of(client, h, app_id)
    assert card["status"] == "INSPECTED" and card["actions"] == ["issue_funds"]
    assert card["loan"] is None
    assert card_of(client, h, app_id, "admin")["actions"] == ["issue_funds"]

    # Payout: INSPECTED → FUNDS_ISSUED → LOAN_ACTIVE.
    resp = payout(client, h, app_id)
    assert resp.status_code == 200, resp.text
    card = resp.json()
    assert card["status"] == "LOAN_ACTIVE" and card["status_label"] == "Займ действует"
    assert card["actions"] == ["repay", "extend"]
    summary = card["loan"]
    assert summary["principal"] == PRINCIPAL and summary["status"] == "ACTIVE"
    assert summary["ticket_number"].startswith("ЗБ-20") and summary["ticket_number"].endswith(
        f"{app_id:06d}"
    )
    assert summary["days_used"] == 1 and summary["total_to_repay"] == PRINCIPAL + DAILY
    assert summary["days_left"] == 30 and summary["rate_label"] == format_rate(20)
    assert summary["ticket_url"] == f"/api/loans/{summary['id']}/ticket"
    history = card["history"]
    assert [e["to_status"] for e in history][-2:] == ["FUNDS_ISSUED", "LOAN_ACTIVE"]
    assert history[-2]["actor_role"] is None  # the system, after the bank's payout
    assert "4400 43** **** 6789" in history[-2]["comment"]
    assert payout(client, h, app_id).status_code == 409  # only once

    loan = client.get(f"/api/loans/{summary['id']}", headers=h("client")).json()
    assert loan["application"]["id"] == app_id and loan["term_days"] == 30
    assert loan["total_at_due"] == tenge(100_912)
    assert (
        loan["due_date"]
        == (
            datetime.fromisoformat(loan["issued_at"]).astimezone(KZ_TZ).date() + timedelta(days=30)
        ).isoformat()
    )
    assert loan["actions"] == ["ticket", "repay", "extend"]
    assert loan["extension"]["pay_now"] == DAILY and loan["extensions_left"] == 5
    [p] = loan["payments"]
    assert p["kind"] == "DISBURSEMENT" and p["status"] == "SUCCEEDED"
    assert p["amount"] == PRINCIPAL and p["destination"] == "4400 43** **** 6789"
    assert p["provider_ref"].startswith("MOCK-PAYOUT-")
    assert [x["id"] for x in client.get("/api/loans", headers=h("client")).json()] == [loan["id"]]

    # Pledge ticket.
    ticket = client.get(summary["ticket_url"], headers=h("client"))
    assert ticket.status_code == 200 and ticket.headers["content-type"].startswith("text/html")
    assert "Залоговый билет" in ticket.text and loan["ticket_number"] in ticket.text
    assert "95 200 ₸" in ticket.text and "Айгерим Садыкова" in ticket.text
    download = client.get(f"{summary['ticket_url']}?download=true", headers=h("client"))
    assert download.headers["content-disposition"].startswith("attachment; filename=")

    # 10 days later the client repays: principal + 10 days of interest.
    advance(client, h, 10)
    loan = client.get(f"/api/loans/{loan['id']}", headers=h("client")).json()
    assert loan["days_used"] == 10 and loan["total_to_repay"] == PRINCIPAL + 10 * DAILY
    resp = client.post(
        f"/api/loans/{loan['id']}/repay", json={"card_number": CARD}, headers=h("client")
    )
    assert resp.status_code == 200, resp.text
    loan = resp.json()
    assert loan["status"] == "REPAID" and loan["closed_at"]
    assert loan["actions"] == ["ticket", "schedule_return"] and loan["extension"] is None
    repayment = loan["payments"][-1]
    assert repayment["kind"] == "REPAYMENT" and repayment["amount"] == PRINCIPAL + 10 * DAILY
    card = card_of(client, h, app_id)
    assert card["status"] == "REPAID" and card["actions"] == ["schedule_return"]
    assert card["history"][-1]["actor_role"] == "CLIENT"
    again = client.post(
        f"/api/loans/{loan['id']}/repay", json={"card_number": CARD}, headers=h("client")
    )
    assert again.status_code == 409

    # Return: book a courier; slots follow the shifted clock.
    free = slots(client, h)
    first = datetime.fromisoformat(free[0]["start"])
    assert first > datetime.now(UTC) + timedelta(days=9)
    resp = client.post(
        f"/api/applications/{app_id}/return",
        json={"city": "Алматы", "address": "ул. Абая, 150, кв. 12", "slot_start": free[0]["start"]},
        headers=h("client"),
    )
    assert resp.status_code == 200, resp.text
    card = resp.json()
    assert card["status"] == "REPAID" and card["actions"] == []
    assert card["courier_visit"]["kind"] == "RETURN"
    assert card["history"][-1]["comment"].startswith("Возврат изделия: курьер приедет")
    again = client.post(
        f"/api/applications/{app_id}/return",
        json={"city": "Алматы", "address": "ул. Абая, 150", "slot_start": free[1]["start"]},
        headers=h("client"),
    )
    assert again.status_code == 409

    # Courier brings the item back: start → deliver → ITEM_RETURNED.
    tasks = client.get("/api/courier/tasks?scope=active", headers=h("courier")).json()
    [task] = [t for t in tasks if t["kind"] == "RETURN"]
    assert task["actions"] == ["start"] and task["kind_label"] == "Вернуть клиенту"
    assert step(client, h, task["id"], "start").json()["application"]["status"] == "REPAID"
    done = step(client, h, task["id"], "deliver").json()
    assert done["status"] == "DELIVERED" and done["application"]["status"] == "ITEM_RETURNED"
    card = card_of(client, h, app_id)
    assert card["status"] == "ITEM_RETURNED" and card["actions"] == []
    assert card["loan"]["status"] == "REPAID"
    assert [e["to_status"] for e in card["history"]] == [
        "DRAFT",
        "SUBMITTED",
        "PRE_ESTIMATED",
        "UNDER_REVIEW",
        "OFFER_SENT",
        "OFFER_ACCEPTED",
        "COURIER_SCHEDULED",
        "COURIER_EN_ROUTE",
        "ITEM_PICKED_UP",
        "ITEM_DELIVERED",
        "INSPECTED",
        "FUNDS_ISSUED",
        "LOAN_ACTIVE",
        "REPAID",
        "REPAID",  # timeline note: return booked
        "ITEM_RETURNED",
    ]

    number = card["number"]
    client_notes = notes(seeded, "client@lombard.kz")
    for title in [
        f"Деньги отправлены: {tenge(95_200) // 100:,} ₸".replace(",", " ").replace(" ₸", " ₸"),
        f"Займ погашен: {loan['ticket_number']}",
        f"Возврат изделия запланирован: {number}",
        f"Курьер везёт изделие: {number}",
        f"Изделие возвращено: {number}",
    ]:
        assert title in client_notes, title

    # Mock SMS / e-mail went to the outbox, not to the in-app list.
    outbox = client.get("/api/admin/messages", headers=h("admin")).json()
    channels = {(m["channel"], m["email"]) for m in outbox}
    assert ("SMS", "client@lombard.kz") in channels and ("EMAIL", "client@lombard.kz") in channels
    sms = next(m for m in outbox if m["channel"] == "SMS")
    assert sms["title"] == "+7 701 123-45-67" and len(sms["body"]) <= 160
    in_app = client.get("/api/notifications", headers=h("client")).json()
    assert all(n["channel"] == "IN_APP" for n in in_app)

    stats = client.get("/api/admin/stats", headers=h("admin")).json()
    assert stats["loans_repaid"] == 1 and stats["loans_active"] == 0
    assert stats["issued_total"] == PRINCIPAL
    assert stats["repaid_total"] == PRINCIPAL + 10 * DAILY
    assert stats["interest_income"] == 10 * DAILY
    assert stats["by_status"]["ITEM_RETURNED"] == 1 and stats["funnel"]["closed"] == 1


# --- Extension, overdue, forfeit ----------------------------------------------------------


def test_extension_pays_interest_and_restarts_the_term(
    client: TestClient, seeded: Session, h: Headers
):
    app_id, loan = issued(client, seeded, h)
    advance(client, h, 12)
    quote = client.get(f"/api/loans/{loan['id']}/extension?term_days=20", headers=h("client"))
    assert quote.status_code == 200, quote.text
    q = quote.json()
    assert q["pay_now"] == 12 * DAILY and q["days_used"] == 12 and q["term_days"] == 20
    assert q["extensions_left"] == 4
    bad = client.get(f"/api/loans/{loan['id']}/extension?term_days=90", headers=h("client"))
    assert bad.status_code == 422

    resp = client.post(
        f"/api/loans/{loan['id']}/extend",
        json={"card_number": CARD, "term_days": 20},
        headers=h("client"),
    )
    assert resp.status_code == 200, resp.text
    ext = resp.json()
    assert ext["status"] == "ACTIVE" and ext["extensions_count"] == 1
    assert ext["term_days"] == 20 and ext["due_date"] == q["new_due_date"]
    assert ext["days_used"] == 1 and ext["accrued_interest"] == DAILY  # a new period
    assert ext["payments"][-1]["kind"] == "EXTENSION"
    assert ext["payments"][-1]["amount"] == 12 * DAILY
    card = card_of(client, h, app_id)
    assert [e["to_status"] for e in card["history"]][-2:] == ["EXTENDED", "LOAN_ACTIVE"]
    assert card["status"] == "LOAN_ACTIVE"
    assert f"Займ продлён: {loan['ticket_number']}" in notes(seeded, "client@lombard.kz")


def test_extension_limit(client: TestClient, seeded: Session, h: Headers, settings: Settings):
    _, loan = issued(client, seeded, h)
    for _ in range(5):
        r = client.post(
            f"/api/loans/{loan['id']}/extend", json={"card_number": CARD}, headers=h("client")
        )
        assert r.status_code == 200, r.text
    assert r.json()["extensions_left"] == 0 and r.json()["extension"] is None
    assert "extend" not in r.json()["actions"]
    r = client.post(
        f"/api/loans/{loan['id']}/extend", json={"card_number": CARD}, headers=h("client")
    )
    assert r.status_code == 409 and "не больше 5 раз" in r.json()["detail"]


def test_overdue_then_repay_in_grace_period(client: TestClient, seeded: Session, h: Headers):
    app_id, loan = issued(client, seeded, h)
    result = advance(client, h, 31)
    assert result["jobs"]["loans_overdue"] == 1 and result["jobs"]["loans_forfeited"] == 0
    card = card_of(client, h, app_id)
    assert card["status"] == "OVERDUE" and card["actions"] == ["repay", "extend"]
    assert card["loan"]["status"] == "OVERDUE" and card["loan"]["overdue_days"] == 1
    assert card["history"][-1]["actor_role"] is None
    assert f"Займ просрочен: {loan['ticket_number']}" in notes(seeded, "client@lombard.kz")
    stats = client.get("/api/admin/stats", headers=h("admin")).json()
    assert stats["loans_overdue"] == 1 and stats["portfolio_principal"] == PRINCIPAL

    resp = client.post(
        f"/api/loans/{loan['id']}/repay", json={"card_number": CARD}, headers=h("client")
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["payments"][-1]["amount"] == PRINCIPAL + 31 * DAILY
    assert card_of(client, h, app_id)["status"] == "REPAID"


def test_overdue_loan_can_be_extended(client: TestClient, seeded: Session, h: Headers):
    app_id, loan = issued(client, seeded, h)
    advance(client, h, 35, hours=1)
    r = client.post(
        f"/api/loans/{loan['id']}/extend", json={"card_number": CARD}, headers=h("client")
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ACTIVE" and r.json()["days_left"] == 30
    assert [e["to_status"] for e in card_of(client, h, app_id)["history"]][-3:] == [
        "OVERDUE",
        "EXTENDED",
        "LOAN_ACTIVE",
    ]


def test_forfeit_after_grace_period(client: TestClient, seeded: Session, h: Headers):
    app_id, loan = issued(client, seeded, h)
    result = advance(client, h, 61, hours=1)
    assert result["jobs"] == {
        "now": result["jobs"]["now"],
        "offers_expired": 0,
        "loans_overdue": 1,
        "loans_forfeited": 1,
    }
    card = card_of(client, h, app_id)
    assert card["status"] == "FORFEITED" and card["actions"] == []
    assert [e["to_status"] for e in card["history"]][-2:] == ["OVERDUE", "FORFEITED"]
    detail = client.get(f"/api/loans/{loan['id']}", headers=h("client")).json()
    assert detail["status"] == "FORFEITED" and detail["actions"] == ["ticket"]
    r = client.post(
        f"/api/loans/{loan['id']}/repay", json={"card_number": CARD}, headers=h("client")
    )
    assert r.status_code == 409 and "перешло ломбарду" in r.json()["detail"]
    stats = client.get("/api/admin/stats", headers=h("admin")).json()
    assert stats["loans_forfeited"] == 1 and stats["portfolio_principal"] == 0


def test_status_syncs_on_read_without_the_job(client: TestClient, seeded: Session, h: Headers):
    app_id, loan = issued(client, seeded, h)
    client.post("/api/admin/clock", json={"days": 40, "run_jobs": False}, headers=h("admin"))
    assert card_of(client, h, app_id)["status"] == "LOAN_ACTIVE"  # nothing ran yet
    detail = client.get(f"/api/loans/{loan['id']}", headers=h("client")).json()
    assert detail["status"] == "OVERDUE" and detail["overdue_days"] == 10
    assert card_of(client, h, app_id)["status"] == "OVERDUE"


# --- Payment failures and validation ------------------------------------------------------


def test_declined_payout_keeps_inspected(client: TestClient, seeded: Session, h: Headers):
    app_id = inspected(client, seeded, h)
    r = payout(client, h, app_id, "4000 0000 0000 0002")
    assert r.status_code == 402 and r.json()["detail"].endswith("Банк отклонил операцию")
    assert card_of(client, h, app_id)["status"] == "INSPECTED"
    r = payout(client, h, app_id, "4400 4301 2345 6788")
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["body", "card_number"]
    assert payout(client, h, app_id, who="admin").status_code == 200  # admin on behalf


def test_failed_repayment_is_recorded(client: TestClient, seeded: Session, h: Headers):
    app_id, loan = issued(client, seeded, h)
    r = client.post(
        f"/api/loans/{loan['id']}/repay",
        json={"card_number": NO_FUNDS_CARD},
        headers=h("client"),
    )
    assert r.status_code == 402 and "Недостаточно средств" in r.json()["detail"]
    seeded.expire_all()
    failed = seeded.scalars(select(Payment).where(Payment.status == "FAILED")).all()
    assert len(failed) == 1 and failed[0].kind.value == "REPAYMENT"
    assert card_of(client, h, app_id)["status"] == "LOAN_ACTIVE"
    assert client.get("/api/admin/stats", headers=h("admin")).json()["failed_payments"] == 1


def test_payout_requires_inspection(client: TestClient, seeded: Session, h: Headers):
    app_id = accepted(client, seeded, h)
    assert payout(client, h, app_id).status_code == 409
    pre = submitted(client, seeded, h)["id"]
    assert payout(client, h, pre).status_code == 409
    r = client.post(
        f"/api/applications/{pre}/return",
        json={
            "city": "Алматы",
            "address": "ул. Абая, 1",
            "slot_start": slots(client, h)[0]["start"],
        },
        headers=h("client"),
    )
    assert r.status_code == 409


def test_loan_permissions(client: TestClient, seeded: Session, h: Headers):
    app_id, loan = issued(client, seeded, h)
    url = f"/api/loans/{loan['id']}"
    assert client.get(url, headers=h("client2")).status_code == 404
    assert client.get(url, headers=h("expert")).status_code == 403
    assert client.get(url, headers=h("courier")).status_code == 403
    assert client.get(url, headers=h("admin")).status_code == 200
    assert client.get(f"{url}/ticket", headers=h("client2")).status_code == 404
    assert client.get("/api/loans", headers=h("client2")).json() == []
    assert len(client.get("/api/loans", headers=h("admin")).json()) == 1
    assert client.get("/api/loans?status=REPAID", headers=h("admin")).json() == []
    pay = {"card_number": CARD}
    assert client.post(f"{url}/repay", json=pay, headers=h("admin")).status_code == 403
    assert client.post(f"{url}/repay", json=pay, headers=h("client2")).status_code == 404
    assert payout(client, h, app_id, who="expert").status_code == 403
    assert payout(client, h, app_id, who="courier").status_code == 403
    assert client.get("/api/loans/999", headers=h("client")).status_code == 404


# --- Notifications ------------------------------------------------------------------------


def test_notifications_api(client: TestClient, seeded: Session, h: Headers):
    issued(client, seeded, h)
    count = client.get("/api/notifications/unread-count", headers=h("client")).json()["unread"]
    assert count >= 5
    items = client.get("/api/notifications?unread=true&limit=3", headers=h("client")).json()
    assert len(items) == 3 and items[0]["title"].startswith("Деньги отправлены")
    r = client.post(f"/api/notifications/{items[0]['id']}/read", headers=h("client"))
    assert r.status_code == 200 and r.json()["is_read"] is True
    unread = client.get("/api/notifications/unread-count", headers=h("client")).json()
    assert unread["unread"] == count - 1
    # Someone else's notification looks missing.
    assert (
        client.post(f"/api/notifications/{items[1]['id']}/read", headers=h("expert")).status_code
        == 404
    )
    assert client.post("/api/notifications/read-all", headers=h("client")).json() == {"unread": 0}
    assert client.get("/api/notifications?unread=true", headers=h("client")).json() == []
    # SMS rows are not part of the in-app list.
    sms = seeded.scalars(
        select(Notification).where(Notification.channel == NotificationChannel.SMS)
    ).all()
    assert sms
    assert (
        client.post(f"/api/notifications/{sms[0].id}/read", headers=h("client")).status_code == 404
    )
    assert client.get("/api/notifications").status_code == 401


# --- Admin --------------------------------------------------------------------------------


def test_admin_categories(client: TestClient, seeded: Session, h: Headers):
    cats = client.get("/api/admin/categories", headers=h("admin")).json()
    gold = next(c for c in cats if c["code"] == "gold")
    r = client.patch(
        f"/api/admin/categories/{gold['id']}",
        json={"ltv_percent": 75, "daily_rate_bp": 22},
        headers=h("admin"),
    )
    assert r.status_code == 200 and r.json()["ltv_percent"] == 75
    r = client.patch(
        f"/api/admin/categories/{gold['id']}", json={"min_term_days": 90}, headers=h("admin")
    )
    assert r.status_code == 422
    new = {"code": "furs", "name": "Шубы", "ltv_percent": 40, "daily_rate_bp": 35}
    r = client.post("/api/admin/categories", json=new, headers=h("admin"))
    assert r.status_code == 201 and r.json()["is_active"] is True
    assert client.post("/api/admin/categories", json=new, headers=h("admin")).status_code == 409
    r = client.patch(
        f"/api/admin/categories/{r.json()['id']}", json={"is_active": False}, headers=h("admin")
    )
    assert r.json()["is_active"] is False
    public = client.get("/api/catalog/categories").json()
    assert "furs" not in [c["code"] for c in public]
    assert next(c for c in public if c["code"] == "gold")["ltv_percent"] == 75
    assert client.get("/api/admin/categories", headers=h("expert")).status_code == 403
    assert client.patch("/api/admin/categories/999", json={}, headers=h("admin")).status_code == 404


def test_admin_metal_prices(client: TestClient, seeded: Session, h: Headers):
    r = client.post(
        "/api/admin/metal-prices",
        json={"metal": "GOLD", "price_per_gram": tenge(70_000)},
        headers=h("admin"),
    )
    assert r.status_code == 201 and r.json()["is_current"] is True
    future = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    r = client.post(
        "/api/admin/metal-prices",
        json={"metal": "GOLD", "price_per_gram": tenge(71_000), "effective_from": future},
        headers=h("admin"),
    )
    assert r.status_code == 201 and r.json()["is_current"] is False
    history = client.get("/api/admin/metal-prices?metal=GOLD", headers=h("admin")).json()
    assert [p["price_per_gram"] for p in history[:3]] == [
        tenge(71_000),
        tenge(70_000),
        tenge(66_500),
    ]
    metals = client.get("/api/catalog/metals").json()
    assert next(m for m in metals if m["metal"] == "GOLD")["price_per_gram"] == tenge(70_000)
    naive = client.post(
        "/api/admin/metal-prices",
        json={"metal": "GOLD", "price_per_gram": 1, "effective_from": "2026-11-05T09:00:00"},
        headers=h("admin"),
    )
    assert naive.status_code == 422


def test_admin_creates_staff(client: TestClient, seeded: Session, h: Headers):
    body = {
        "email": "Courier9@Lombard.kz",
        "password": "secret123",
        "full_name": "Данияр Ахметов",
        "phone": "+7 777 123 45 67",
        "role": "COURIER",
    }
    r = client.post("/api/admin/users", json=body, headers=h("admin"))
    assert r.status_code == 422  # courier needs a city
    r = client.post("/api/admin/users", json={**body, "city": "Шымкент"}, headers=h("admin"))
    assert r.status_code == 201, r.text
    assert r.json()["email"] == "courier9@lombard.kz" and r.json()["role"] == "COURIER"
    assert r.json()["phone_display"] == "+7 777 123-45-67"
    dup = client.post("/api/admin/users", json={**body, "city": "Шымкент"}, headers=h("admin"))
    assert dup.status_code == 409
    cities = [c["city"] for c in client.get("/api/delivery/cities", headers=h("client")).json()]
    assert "Шымкент" in cities
    assert client.post("/api/admin/users", json=body, headers=h("expert")).status_code == 403


def test_admin_clock_and_jobs(client: TestClient, seeded: Session, h: Headers):
    clock = client.get("/api/admin/clock", headers=h("admin")).json()
    assert clock["offset_seconds"] == 0 and clock["enabled"] is True
    r = advance(client, h, 2, hours=12)
    assert r["offset_days"] == 2.5 and r["jobs"]["loans_overdue"] == 0
    assert client.post("/api/admin/jobs/run", headers=h("admin")).json()["offers_expired"] == 0
    r = client.delete("/api/admin/clock", headers=h("admin")).json()
    assert r["offset_seconds"] == 0
    assert client.post("/api/admin/clock", json={"days": -1}, headers=h("admin")).status_code == 422
    assert client.get("/api/admin/clock", headers=h("client")).status_code == 403


def test_time_travel_can_be_disabled(settings: Settings, seeded: Session) -> None:
    prod_like = settings.model_copy(update={"time_travel": False})
    app = create_app(prod_like)
    with TestClient(app) as c:
        from tests.conftest import login

        headers = login(c, "admin@lombard.kz")
        r = c.post("/api/admin/clock", json={"days": 1}, headers=headers)
        assert r.status_code == 409
        assert c.get("/api/admin/clock", headers=headers).json()["enabled"] is False
    app.state.engine.dispose()
    assert Settings(_env_file=None, environment="test").time_travel_enabled
    assert not Settings(
        _env_file=None, environment="production", secret_key="x" * 40
    ).time_travel_enabled


@pytest.mark.parametrize("who", ["client", "expert", "courier"])
def test_admin_endpoints_need_admin(client: TestClient, seeded: Session, h: Headers, who: str):
    for url in ("/api/admin/stats", "/api/admin/messages", "/api/admin/metal-prices"):
        assert client.get(url, headers=h(who)).status_code == 403
    assert client.post("/api/admin/jobs/run", headers=h(who)).status_code == 403


def test_stats_on_seed(client: TestClient, seeded: Session, h: Headers):
    stats = client.get("/api/admin/stats", headers=h("admin")).json()
    assert stats["applications_total"] >= 1 and stats["loans_active"] == 0
    assert stats["users_by_role"]["COURIER"] == 2
    assert set(stats["funnel"]) == {"draft", "review", "logistics", "loans", "closed", "declined"}
    seeded.expire_all()
    assert seeded.scalar(select(User).where(User.email == "admin@lombard.kz")) is not None
