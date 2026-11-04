"""Stage 7: courier slots, calling a courier, courier steps, assignment and inspection."""

import itertools
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.domain.enums import ApplicationStatus, CourierTaskKind, CourierTaskStatus, Role
from app.domain.logistics import (
    KZ_TZ,
    CourierStepError,
    SlotRules,
    bookable_slots,
    day_slots,
    find_slot,
    next_steps,
    step_result,
)
from app.domain.money import tenge
from app.models import Notification, User
from tests.test_applications import Headers
from tests.test_review import send_offer, submitted, take

K, T, S = CourierTaskKind, CourierTaskStatus, ApplicationStatus

# --- Pure domain: slots -------------------------------------------------------------------


def test_day_slots_are_local_two_hour_windows():
    slots = day_slots(date(2026, 11, 5))
    assert len(slots) == 5
    assert slots[0].start == datetime(2026, 11, 5, 5, tzinfo=UTC)  # 10:00 in Almaty
    assert slots[-1].end == datetime(2026, 11, 5, 15, tzinfo=UTC)  # 20:00
    assert slots[0].label == "05.11, 10:00–12:00"
    assert slots[0].local_date == date(2026, 11, 5)


def test_bookable_slots_respect_lead_time_and_horizon():
    now = datetime(2026, 11, 4, 6, 30, tzinfo=UTC)  # 11:30 local
    slots = bookable_slots(now)
    assert slots[0].label == "04.11, 14:00–16:00"  # 12:00 starts in < 2 h
    assert len(slots) == 3 + 7 * 5
    assert slots[-1].label == "11.11, 18:00–20:00"
    assert all(a.start < b.start for a, b in itertools.pairwise(slots))


def test_late_evening_starts_tomorrow():
    now = datetime(2026, 11, 4, 14, tzinfo=UTC)  # 19:00 local
    assert bookable_slots(now)[0].label == "05.11, 10:00–12:00"


def test_find_slot():
    now = datetime(2026, 11, 4, 6, 30, tzinfo=UTC)
    local = datetime(2026, 11, 5, 12, tzinfo=KZ_TZ)
    assert find_slot(local, now) is not None  # any time zone is fine
    assert find_slot(local.astimezone(UTC), now) == find_slot(local, now)
    assert find_slot(local.replace(tzinfo=None), now) is None  # naive
    assert find_slot(local + timedelta(minutes=30), now) is None  # not a slot boundary
    assert find_slot(datetime(2026, 11, 4, 12, tzinfo=KZ_TZ), now) is None  # too soon
    assert find_slot(datetime(2026, 11, 20, 12, tzinfo=KZ_TZ), now) is None  # beyond horizon


def test_custom_rules():
    rules = SlotRules(day_start_hour=9, day_end_hour=21, slot_hours=3, lead_hours=0)
    assert [s.label[-11:] for s in day_slots(date(2026, 11, 5), rules)] == [
        "09:00–12:00",
        "12:00–15:00",
        "15:00–18:00",
        "18:00–21:00",
    ]
    with pytest.raises(ValueError):
        SlotRules(day_start_hour=10, day_end_hour=19, slot_hours=2)
    with pytest.raises(ValueError):
        SlotRules(day_start_hour=20, day_end_hour=10)


# --- Pure domain: courier task flow -------------------------------------------------------


def test_pickup_flow():
    assert step_result(K.PICKUP, "start", T.SCHEDULED) == (T.EN_ROUTE, S.COURIER_EN_ROUTE)
    assert step_result(K.PICKUP, "pick_up", T.EN_ROUTE) == (T.PICKED_UP, S.ITEM_PICKED_UP)
    assert step_result(K.PICKUP, "deliver", T.PICKED_UP) == (T.DELIVERED, S.ITEM_DELIVERED)
    with pytest.raises(CourierStepError, match="Забрал изделие"):
        step_result(K.PICKUP, "pick_up", T.SCHEDULED)
    with pytest.raises(CourierStepError):
        step_result(K.PICKUP, "deliver", T.DELIVERED)
    assert next_steps(K.PICKUP, T.SCHEDULED) == ["start"]
    assert next_steps(K.PICKUP, T.EN_ROUTE) == ["pick_up"]
    assert next_steps(K.PICKUP, T.PICKED_UP) == ["deliver"]
    assert next_steps(K.PICKUP, T.DELIVERED) == []


def test_return_flow_has_no_pick_up_step():
    assert step_result(K.RETURN, "start", T.SCHEDULED) == (T.EN_ROUTE, None)
    assert step_result(K.RETURN, "deliver", T.EN_ROUTE) == (T.DELIVERED, S.ITEM_RETURNED)
    with pytest.raises(CourierStepError, match="не применим"):
        step_result(K.RETURN, "pick_up", T.EN_ROUTE)
    assert next_steps(K.RETURN, T.SCHEDULED) == ["start"]
    assert next_steps(K.RETURN, T.EN_ROUTE) == ["deliver"]


# --- Helpers ------------------------------------------------------------------------------


def accepted(client: TestClient, session: Session, h: Headers, **kw) -> int:
    """Application of the demo client (Almaty) with an accepted offer: 95 200 ₸."""
    app_id = submitted(client, session, h, **kw)["id"]
    take(client, h, app_id)
    send_offer(client, h, app_id)
    resp = client.post(f"/api/applications/{app_id}/offer/accept", headers=h("client"))
    assert resp.status_code == 200, resp.text
    return app_id


def slots(client: TestClient, h: Headers, city: str = "Алматы") -> list[dict]:
    resp = client.get("/api/delivery/slots", params={"city": city}, headers=h("client"))
    assert resp.status_code == 200, resp.text
    return resp.json()


def visit(slot_start: str, **kw) -> dict:
    data = {
        "city": "Алматы",
        "address": "ул. Абая, 150, кв. 12",
        "slot_start": slot_start,
        "comment": "Домофон 12В",
    }
    data.update(kw)
    return data


def schedule(client: TestClient, h: Headers, app_id: int, slot_start: str, who="client", **kw):
    return client.post(
        f"/api/applications/{app_id}/courier", json=visit(slot_start, **kw), headers=h(who)
    )


def step(client: TestClient, h: Headers, task_id: int, name: str, who: str = "courier"):
    return client.post(f"/api/courier/tasks/{task_id}/{name}", headers=h(who))


def user_id(session: Session, email: str) -> int:
    return session.scalar(select(User.id).where(User.email == email))


def notes(session: Session, email: str) -> list[str]:
    session.expire_all()
    user = session.scalar(select(User).where(User.email == email))
    return [
        n.title
        for n in session.scalars(
            select(Notification).where(Notification.user_id == user.id).order_by(Notification.id)
        )
    ]


@pytest.fixture
def courier3(seeded: Session, client: TestClient) -> User:
    """A second courier in Almaty."""
    user = User(
        email="courier3@lombard.kz",
        full_name="Ерболат Сеитов",
        role=Role.COURIER,
        phone="+77781234567",
        city="Алматы",
        password_hash=hash_password("demo1234"),
    )
    seeded.add(user)
    seeded.commit()
    return user


# --- Main scenario ------------------------------------------------------------------------


def test_accepted_offer_to_courier_to_inspection(client: TestClient, seeded: Session, h: Headers):
    app_id = accepted(client, seeded, h)

    cities = client.get("/api/delivery/cities", headers=h("client")).json()
    assert cities == [{"city": "Алматы", "couriers": 1}, {"city": "Астана", "couriers": 1}]
    free = slots(client, h)
    assert free and all(s["capacity"] == 1 and s["available"] for s in free)
    assert len(free) >= 7 * 5
    slot = free[0]

    # Client calls the courier; phone defaults to the profile phone.
    resp = schedule(client, h, app_id, slot["start"])
    assert resp.status_code == 200, resp.text
    card = resp.json()
    assert card["status"] == "COURIER_SCHEDULED"
    assert card["actions"] == ["reschedule_courier"]
    v = card["courier_visit"]
    assert v["kind"] == "PICKUP" and v["status"] == "SCHEDULED"
    assert v["courier"]["full_name"] == "Нурлан Жумабаев"
    assert v["contact_phone"] == "+77011234567"
    assert v["contact_phone_display"] == "+7 701 123-45-67"
    assert v["slot_label"] == slot["label"] and v["address"] == "ул. Абая, 150, кв. 12"
    assert card["history"][-1]["comment"] == f"Курьер вызван на {slot['label']}"

    taken = next(s for s in slots(client, h) if s["start"] == slot["start"])
    assert taken["free"] == 0 and taken["available"] is False

    # Courier: the day's list and the active list.
    day = client.get(
        "/api/courier/tasks", params={"day": slot["date"]}, headers=h("courier")
    ).json()
    assert [t["application"]["id"] for t in day] == [app_id]
    task = day[0]
    assert task["actions"] == ["start"] and task["kind_label"] == "Забрать у клиента"
    assert task["client"]["full_name"] == "Айгерим Садыкова"
    assert task["application"]["number"] == card["number"]
    active = client.get("/api/courier/tasks?scope=active", headers=h("courier")).json()
    assert [t["id"] for t in active] == [task["id"]]

    # Courier steps move the application.
    r = step(client, h, task["id"], "start")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "EN_ROUTE" and r.json()["actions"] == ["pick_up"]
    assert r.json()["application"]["status"] == "COURIER_EN_ROUTE"
    client_card = client.get(f"/api/applications/{app_id}", headers=h("client")).json()
    assert client_card["actions"] == []  # too late to reschedule
    assert step(client, h, task["id"], "pick-up").json()["application"]["status"] == (
        "ITEM_PICKED_UP"
    )
    delivered = step(client, h, task["id"], "deliver").json()
    assert delivered["status"] == "DELIVERED" and delivered["completed_at"]
    assert delivered["application"]["status"] == "ITEM_DELIVERED"
    assert delivered["actions"] == []
    assert client.get("/api/courier/tasks?scope=active", headers=h("courier")).json() == []
    done = client.get("/api/courier/tasks?scope=done", headers=h("courier")).json()
    assert [t["id"] for t in done] == [task["id"]]

    # Expert: the inspection queue.
    queue = client.get("/api/expert/queue?scope=inspection", headers=h("expert")).json()
    assert [q["id"] for q in queue] == [app_id]
    card = client.get(f"/api/applications/{app_id}", headers=h("expert")).json()
    assert card["actions"] == ["inspect"] and card["inspection"] is None

    preview = client.post(
        f"/api/expert/applications/{app_id}/inspection/quote", json={}, headers=h("expert")
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["adjusted"] is False
    assert preview.json()["quote"]["loan_amount"] == tenge(95_200)

    resp = client.post(
        f"/api/expert/applications/{app_id}/inspection",
        json={"hallmark_confirmed": True, "weight_g": "3.52"},
        headers=h("expert"),
    )
    assert resp.status_code == 200, resp.text
    card = resp.json()
    assert card["status"] == "INSPECTED" and card["status_label"] == "Осмотрено"
    assert card["actions"] == []
    insp = card["inspection"]
    assert insp["kind"] == "INSPECTION" and insp["value"] == tenge(119_000)
    assert insp["confidence"] == 100
    assert insp["details"]["loan_amount"] == tenge(95_200)
    assert insp["details"]["adjusted"] is False
    assert insp["details"]["total_to_repay"] == tenge(100_912)
    assert insp["details"]["weight_g"] == "3.52"
    assert [e["to_status"] for e in card["history"]][-6:] == [
        "OFFER_ACCEPTED",
        "COURIER_SCHEDULED",
        "COURIER_EN_ROUTE",
        "ITEM_PICKED_UP",
        "ITEM_DELIVERED",
        "INSPECTED",
    ]
    assert card["history"][-1]["actor_role"] == "EXPERT"
    assert card["history"][-2]["actor_role"] == "COURIER"

    client_notes = notes(seeded, "client@lombard.kz")
    number = card["number"]
    for title in [
        f"Курьер назначен по заявке {number}",
        f"Курьер выехал: {number}",
        f"Курьер забрал изделие: {number}",
        f"Изделие в ломбарде: {number}",
        f"Осмотр завершён: {number}",
    ]:
        assert title in client_notes
    assert f"Новый выезд: {number}" in notes(seeded, "courier@lombard.kz")
    assert f"Нужен осмотр: {number}" in notes(seeded, "expert@lombard.kz")


# --- Calling a courier: validation and permissions ----------------------------------------


def test_schedule_validation(client: TestClient, seeded: Session, h: Headers):
    pre = submitted(client, seeded, h)["id"]
    slot = slots(client, h)[0]["start"]
    assert schedule(client, h, pre, slot).status_code == 409  # no accepted offer yet

    app_id = accepted(client, seeded, h)
    r = schedule(client, h, app_id, slot, city="Шымкент")
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["body", "city"]
    r = schedule(client, h, app_id, "2026-01-01T05:00:00Z")
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["body", "slot_start"]
    odd = datetime.fromisoformat(slot) + timedelta(minutes=30)
    assert schedule(client, h, app_id, odd.isoformat()).status_code == 422
    r = schedule(client, h, app_id, slot, contact_phone="+1 202 555 0100")
    assert r.status_code == 422
    assert schedule(client, h, app_id, slot, address="дом").status_code == 422
    assert client.get("/api/delivery/slots?city=Шымкент", headers=h("client")).status_code == 422

    assert schedule(client, h, app_id, slot, who="expert").status_code == 403
    assert schedule(client, h, app_id, slot, who="courier").status_code == 403
    assert schedule(client, h, app_id, slot, who="client2").status_code == 404
    assert client.get("/api/delivery/slots?city=Алматы").status_code == 401

    r = schedule(client, h, app_id, slot, contact_phone="8 (777) 123-45-67")
    assert r.status_code == 200, r.text
    assert r.json()["courier_visit"]["contact_phone"] == "+77771234567"
    assert schedule(client, h, app_id, slot).status_code == 409  # already scheduled


def test_admin_can_call_courier_for_client(client: TestClient, seeded: Session, h: Headers):
    app_id = accepted(client, seeded, h)
    card = client.get(f"/api/applications/{app_id}", headers=h("admin")).json()
    assert card["actions"] == ["schedule_courier"]
    r = schedule(client, h, app_id, slots(client, h)[0]["start"], who="admin")
    assert r.status_code == 200, r.text
    assert r.json()["history"][-1]["actor_role"] == "ADMIN"


def test_slot_capacity_and_least_loaded_courier(
    client: TestClient, seeded: Session, h: Headers, courier3: User
):
    a1, a2, a3 = (accepted(client, seeded, h) for _ in range(3))
    free = slots(client, h)
    assert free[0]["capacity"] == 2
    s1, s2 = free[0]["start"], free[1]["start"]

    # Both couriers have no load → the lower id (Нурлан) gets the first one.
    r1 = schedule(client, h, a1, s1).json()
    assert r1["courier_visit"]["courier"]["full_name"] == "Нурлан Жумабаев"
    # Another slot: Нурлан already has an open task → the least loaded one.
    r2 = schedule(client, h, a2, s2).json()
    assert r2["courier_visit"]["courier"]["full_name"] == "Ерболат Сеитов"
    # Same slot as the first: only Ерболат is free there.
    r3 = schedule(client, h, a3, s1).json()
    assert r3["courier_visit"]["courier"]["full_name"] == "Ерболат Сеитов"
    assert next(s for s in slots(client, h) if s["start"] == s1)["free"] == 0

    a4 = accepted(client, seeded, h)
    r = schedule(client, h, a4, s1)
    assert r.status_code == 409 and "заняты" in r.json()["detail"]


# --- Courier workspace --------------------------------------------------------------------


def test_courier_permissions_and_step_order(client: TestClient, seeded: Session, h: Headers):
    app_id = accepted(client, seeded, h)
    card = schedule(client, h, app_id, slots(client, h)[0]["start"]).json()
    task_id = card["courier_visit"]["id"]

    assert step(client, h, task_id, "pick-up").status_code == 409
    assert step(client, h, task_id, "deliver").status_code == 409
    other = login_courier2(client)
    assert client.get(f"/api/courier/tasks/{task_id}", headers=other).status_code == 404
    assert client.post(f"/api/courier/tasks/{task_id}/start", headers=other).status_code == 404
    assert client.get("/api/courier/tasks?scope=all", headers=other).json() == []
    assert step(client, h, task_id, "start", who="admin").status_code == 403
    assert step(client, h, task_id, "start", who="client").status_code == 403
    assert client.get("/api/courier/tasks", headers=h("client")).status_code == 403
    assert client.get("/api/courier/tasks/999", headers=h("courier")).status_code == 404

    # Couriers do not read the application card itself — only their task.
    assert client.get(f"/api/applications/{app_id}", headers=h("courier")).status_code == 403
    # Admin sees every task, with the "assign" action.
    task = client.get(f"/api/courier/tasks/{task_id}", headers=h("admin")).json()
    assert task["actions"] == ["assign"]

    assert step(client, h, task_id, "start").status_code == 200
    assert step(client, h, task_id, "start").status_code == 409  # twice
    # Inspection is impossible before delivery.
    r = client.post(f"/api/expert/applications/{app_id}/inspection", json={}, headers=h("expert"))
    assert r.status_code == 409


def login_courier2(client: TestClient) -> dict[str, str]:
    from tests.conftest import login

    return login(client, "courier2@lombard.kz")


def test_reschedule(client: TestClient, seeded: Session, h: Headers, courier3: User):
    app_id = accepted(client, seeded, h)
    free = slots(client, h)
    card = schedule(client, h, app_id, free[0]["start"]).json()
    assert card["courier_visit"]["courier"]["full_name"] == "Нурлан Жумабаев"

    r = client.put(
        f"/api/applications/{app_id}/courier",
        json=visit(free[3]["start"], address="пр. Достык, 5", contact_phone="+77071112233"),
        headers=h("client"),
    )
    assert r.status_code == 200, r.text
    moved = r.json()
    assert moved["status"] == "COURIER_SCHEDULED"
    v = moved["courier_visit"]
    assert v["id"] == card["courier_visit"]["id"]
    assert v["slot_label"] == free[3]["label"] and v["address"] == "пр. Достык, 5"
    assert v["courier"]["full_name"] == "Нурлан Жумабаев"  # still free → keeps the task
    assert moved["history"][-1]["comment"] == f"Визит перенесён на {free[3]['label']}"
    assert moved["history"][-1]["from_status"] == moved["history"][-1]["to_status"]
    assert next(s for s in slots(client, h) if s["start"] == free[0]["start"])["free"] == 2

    assert step(client, h, v["id"], "start").status_code == 200
    r = client.put(
        f"/api/applications/{app_id}/courier", json=visit(free[4]["start"]), headers=h("client")
    )
    assert r.status_code == 409


def test_reschedule_into_busy_slot_switches_courier(
    client: TestClient, seeded: Session, h: Headers, courier3: User
):
    a1, a2 = accepted(client, seeded, h), accepted(client, seeded, h)
    free = slots(client, h)
    schedule(client, h, a1, free[0]["start"])  # Нурлан
    card = schedule(client, h, a2, free[1]["start"]).json()  # Ерболат (less loaded)
    assert card["courier_visit"]["courier"]["full_name"] == "Ерболат Сеитов"
    # Move a1 to slot 1 where Ерболат is busy: Нурлан is free there, so he keeps it.
    r = client.put(
        f"/api/applications/{a1}/courier", json=visit(free[1]["start"]), headers=h("client")
    )
    assert r.json()["courier_visit"]["courier"]["full_name"] == "Нурлан Жумабаев"
    # Admin moves Нурлан's task to Ерболат? Busy in that slot → 409.
    task_id = r.json()["courier_visit"]["id"]
    r = client.post(
        f"/api/admin/courier-tasks/{task_id}/assign",
        json={"courier_id": courier3.id},
        headers=h("admin"),
    )
    assert r.status_code == 409


# --- Admin --------------------------------------------------------------------------------


def test_admin_assigns_courier(client: TestClient, seeded: Session, h: Headers, courier3: User):
    app_id = accepted(client, seeded, h)
    card = schedule(client, h, app_id, slots(client, h)[0]["start"]).json()
    task_id = card["courier_visit"]["id"]

    load = client.get("/api/admin/couriers?city=Алматы", headers=h("admin")).json()
    assert [(c["courier"]["full_name"], c["open_tasks"]) for c in load] == [
        ("Нурлан Жумабаев", 1),
        ("Ерболат Сеитов", 0),
    ]
    assert client.get("/api/admin/couriers", headers=h("courier")).status_code == 403
    tasks = client.get("/api/admin/courier-tasks", headers=h("admin")).json()
    assert [t["id"] for t in tasks] == [task_id]
    assert client.get("/api/admin/courier-tasks?unassigned=true", headers=h("admin")).json() == []

    client_id = user_id(seeded, "client@lombard.kz")
    r = client.post(
        f"/api/admin/courier-tasks/{task_id}/assign",
        json={"courier_id": client_id},
        headers=h("admin"),
    )
    assert r.status_code == 422
    r = client.post(
        f"/api/admin/courier-tasks/{task_id}/assign", json={"courier_id": 9999}, headers=h("admin")
    )
    assert r.status_code == 404

    r = client.post(
        f"/api/admin/courier-tasks/{task_id}/assign",
        json={"courier_id": courier3.id},
        headers=h("admin"),
    )
    assert r.status_code == 200, r.text
    assert r.json()["courier"]["full_name"] == "Ерболат Сеитов"
    assert client.get("/api/courier/tasks?scope=active", headers=h("courier")).json() == []
    assert step(client, h, task_id, "start").status_code == 404  # no longer his

    from tests.conftest import login

    h3 = login(client, "courier3@lombard.kz")
    assert [t["id"] for t in client.get("/api/courier/tasks?scope=all", headers=h3).json()] == [
        task_id
    ]
    number = card["number"]
    assert f"Выезд {number} передан другому курьеру" in notes(seeded, "courier@lombard.kz")
    assert f"Сменился курьер по заявке {number}" in notes(seeded, "client@lombard.kz")

    assert client.post(f"/api/courier/tasks/{task_id}/start", headers=h3).status_code == 200
    r = client.post(
        f"/api/admin/courier-tasks/{task_id}/assign",
        json={"courier_id": user_id(seeded, "courier@lombard.kz")},
        headers=h("admin"),
    )
    assert r.status_code == 409


# --- Inspection ---------------------------------------------------------------------------


def delivered(client: TestClient, seeded: Session, h: Headers) -> int:
    app_id = accepted(client, seeded, h)
    slot = next(s for s in slots(client, h) if s["available"])
    task_id = schedule(client, h, app_id, slot["start"]).json()["courier_visit"]["id"]
    for name in ("start", "pick-up", "deliver"):
        assert step(client, h, task_id, name).status_code == 200
    return app_id


def inspect(client: TestClient, h: Headers, app_id: int, **body):
    return client.post(
        f"/api/expert/applications/{app_id}/inspection", json=body, headers=h("expert")
    )


def test_inspection_lowers_amount(client: TestClient, seeded: Session, h: Headers):
    app_id = delivered(client, seeded, h)

    # More than the client accepted — not allowed.
    r = inspect(client, h, app_id, loan_amount=tenge(96_000))
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["body", "loan_amount"]
    # Not a multiple of 100 ₸ / above LTV of the new value.
    assert inspect(client, h, app_id, loan_amount=tenge(90_050)).status_code == 422
    r = inspect(client, h, app_id, market_value=tenge(100_000), loan_amount=tenge(90_000))
    assert r.status_code == 422

    # Lower market value → amount capped by LTV (80 %); the reason is required.
    preview = client.post(
        f"/api/expert/applications/{app_id}/inspection/quote",
        json={"market_value": tenge(100_000)},
        headers=h("expert"),
    ).json()
    assert preview["adjusted"] is True and preview["quote"]["loan_amount"] == tenge(80_000)
    assert preview["offer_loan_amount"] == tenge(95_200)
    r = inspect(client, h, app_id, market_value=tenge(100_000))
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["body", "comment"]
    assert client.get(f"/api/applications/{app_id}", headers=h("client")).json()["status"] == (
        "ITEM_DELIVERED"
    )


def test_inspection_with_correction(client: TestClient, seeded: Session, h: Headers):
    app_id = delivered(client, seeded, h)
    r = inspect(
        client,
        h,
        app_id,
        market_value=tenge(100_000),
        hallmark_confirmed=True,
        weight_g="3.1",
        comment="Фактический вес 3,1 г вместо 3,52 г.",
    )
    assert r.status_code == 200, r.text
    card = r.json()
    d = card["inspection"]["details"]
    assert d["adjusted"] is True and d["loan_amount"] == tenge(80_000)
    assert d["offer_loan_amount"] == tenge(95_200)
    assert d["daily_rate_bp"] == 20 and d["term_days"] == 30
    assert d["total_to_repay"] == tenge(84_800)  # 80 000 + 0,2 % × 30 дн.
    assert "95\u00a0200\u00a0₸ → 80\u00a0000\u00a0₸" in card["history"][-1]["comment"]
    assert card["offer"]["loan_amount"] == tenge(95_200)  # the offer itself is history
    assert inspect(client, h, app_id).status_code == 409  # already inspected

    # Only experts inspect.
    other = delivered(client, seeded, h)
    r = client.post(f"/api/expert/applications/{other}/inspection", json={}, headers=h("admin"))
    assert r.status_code == 403
    r = client.post(f"/api/expert/applications/{other}/inspection", json={}, headers=h("client"))
    assert r.status_code == 403
