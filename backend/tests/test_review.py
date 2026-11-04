"""Expert review and offer: queue → take → offer → client accepts / declines; calculator."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.domain.enums import ApplicationStatus, AppraisalKind, OfferStatus, Role
from app.domain.money import tenge
from app.models import Application, Appraisal, Notification, Offer, User
from app.models.base import utcnow
from app.services import review
from tests.conftest import jpeg, login
from tests.test_applications import Headers, category_id, create, gold_payload, upload


def submitted(client: TestClient, session: Session, h: Headers, **kw) -> dict:
    """A gold application of the demo client in PRE_ESTIMATED."""
    app = create(client, h("client"), gold_payload(session, **kw))
    assert upload(client, h("client"), app["id"], jpeg(1), jpeg(2)).status_code == 201
    resp = client.post(f"/api/applications/{app['id']}/submit", headers=h("client"))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "PRE_ESTIMATED"
    return resp.json()


def take(client: TestClient, h: Headers, app_id: int, who: str = "expert") -> dict:
    resp = client.post(f"/api/expert/applications/{app_id}/take", headers=h(who))
    assert resp.status_code == 200, resp.text
    return resp.json()


OFFER = {
    "market_value": tenge(119_000),
    "ltv_percent": 80,
    "daily_rate_bp": 20,
    "term_days": 30,
    "hallmark_confirmed": True,
    "comment": "Клеймо и вес совпадают с описанием.",
}


def send_offer(client: TestClient, h: Headers, app_id: int, **kw) -> dict:
    resp = client.post(
        f"/api/expert/applications/{app_id}/offer", json={**OFFER, **kw}, headers=h("expert")
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture
def second_expert(seeded: Session, client: TestClient) -> dict[str, str]:
    seeded.add(
        User(
            email="expert2@lombard.kz",
            full_name="Мадина Ержанова",
            role=Role.EXPERT,
            phone="+77011112233",
            password_hash=hash_password("demo1234"),
        )
    )
    seeded.commit()
    return login(client, "expert2@lombard.kz")


# --- Main scenario ------------------------------------------------------------------------


def test_application_to_offer_to_acceptance(client: TestClient, seeded: Session, h: Headers):
    app = submitted(client, seeded, h)
    app_id = app["id"]
    assert app["actions"] == []  # client waits; nothing to do
    assert app["offer"] is None and app["expert"] is None
    assert app["client"]["full_name"] == "Айгерим Садыкова"

    # The expert sees it in the "new" queue with the client and the pre-estimate.
    queue = client.get("/api/expert/queue", headers=h("expert")).json()
    item = next(q for q in queue if q["id"] == app_id)
    assert item["client"]["full_name"] == "Айгерим Садыкова"
    assert item["pre_estimate_value"] == app["pre_estimate"]["value"]
    assert item["requested_amount"] == 150_000_00 and item["expert"] is None

    card = client.get(f"/api/applications/{app_id}", headers=h("expert")).json()
    assert card["actions"] == ["take"]

    taken = take(client, h, app_id)
    assert taken["status"] == "UNDER_REVIEW"
    assert taken["expert"]["full_name"] == "Ерлан Касымов"
    assert taken["actions"] == ["send_offer", "request_info", "reject"]
    assert all(
        q["id"] != app_id for q in client.get("/api/expert/queue", headers=h("expert")).json()
    )
    mine = client.get("/api/expert/queue?scope=mine", headers=h("expert")).json()
    assert [q["id"] for q in mine] == [app_id]

    # Live calculator: nothing is saved.
    resp = client.post(
        f"/api/expert/applications/{app_id}/quote",
        json={"market_value": tenge(119_000), "term_days": 30, "daily_rate_bp": 20},
        headers=h("expert"),
    )
    assert resp.status_code == 200, resp.text
    q = resp.json()
    assert q["loan_amount"] == tenge(95_200)  # default LTV of gold — 80 %
    assert q["interest"] == tenge(5_712) and q["total_to_repay"] == tenge(100_912)
    assert q["rate_label"] == "0,2 % в день"
    assert q["schedule"][-1]["is_due_date"] and q["schedule"][-1]["total"] == tenge(100_912)
    assert seeded.scalar(select(Offer).where(Offer.application_id == app_id)) is None

    sent = send_offer(client, h, app_id)
    assert sent["status"] == "OFFER_SENT" and sent["actions"] == []
    offer = sent["offer"]
    assert offer["status"] == "SENT" and offer["status_label"] == "Ждёт решения клиента"
    assert offer["loan_amount"] == tenge(95_200)
    assert offer["interest"] == tenge(5_712) and offer["total_to_repay"] == tenge(100_912)
    assert offer["market_value"] == tenge(119_000) and offer["ltv_percent"] == 80
    assert offer["hallmark_confirmed"] is True
    assert offer["expert"]["full_name"] == "Ерлан Касымов"
    assert offer["comment"] == OFFER["comment"]
    assert offer["quote"]["term_days"] == 30
    expert_appraisal = sent["expert_appraisal"]
    assert expert_appraisal["kind"] == "EXPERT" and expert_appraisal["value"] == tenge(119_000)
    assert expert_appraisal["details"]["auto_value"] == app["pre_estimate"]["value"]
    assert "deviation_percent" in expert_appraisal["details"]
    assert sent["history"][-1]["to_status"] == "OFFER_SENT"
    assert "100 912 ₸" in sent["history"][-1]["comment"]

    # The client is notified and may accept or decline.
    client_user = seeded.scalar(select(User).where(User.email == "client@lombard.kz"))
    notes = seeded.scalars(select(Notification).where(Notification.user_id == client_user.id))
    assert any("Предложение по заявке" in n.title for n in notes)
    card = client.get(f"/api/applications/{app_id}", headers=h("client")).json()
    assert card["actions"] == ["accept_offer", "decline_offer"]
    assert card["offer"]["loan_amount"] == tenge(95_200)

    resp = client.post(f"/api/applications/{app_id}/offer/accept", headers=h("client"))
    assert resp.status_code == 200, resp.text
    accepted = resp.json()
    assert accepted["status"] == "OFFER_ACCEPTED"
    assert accepted["status_label"] == "Предложение принято"
    assert accepted["offer"]["status"] == "ACCEPTED" and accepted["offer"]["decided_at"]
    assert accepted["actions"] == []
    assert [e["to_status"] for e in accepted["history"]] == [
        "DRAFT",
        "SUBMITTED",
        "PRE_ESTIMATED",
        "UNDER_REVIEW",
        "OFFER_SENT",
        "OFFER_ACCEPTED",
    ]
    # Second acceptance is a conflict.
    again = client.post(f"/api/applications/{app_id}/offer/accept", headers=h("client"))
    assert again.status_code == 409
    expert_user = seeded.scalar(select(User).where(User.email == "expert@lombard.kz"))
    seeded.expire_all()
    assert any(
        "принято" in n.title
        for n in seeded.scalars(select(Notification).where(Notification.user_id == expert_user.id))
    )


def test_decline_offer(client: TestClient, seeded: Session, h: Headers) -> None:
    app_id = submitted(client, seeded, h)["id"]
    take(client, h, app_id)
    send_offer(client, h, app_id)
    resp = client.post(
        f"/api/applications/{app_id}/offer/decline",
        json={"reason": "Мало"},
        headers=h("client"),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "OFFER_DECLINED" and body["offer"]["status"] == "DECLINED"
    assert body["history"][-1]["comment"] == "Клиент отказался: Мало"
    # Declining without a body works too (other application).
    app2 = submitted(client, seeded, h)["id"]
    take(client, h, app2)
    send_offer(client, h, app2)
    resp = client.post(f"/api/applications/{app2}/offer/decline", headers=h("client"))
    assert resp.status_code == 200 and resp.json()["status"] == "OFFER_DECLINED"


def test_offer_with_custom_amount_and_defaults(
    client: TestClient, seeded: Session, h: Headers
) -> None:
    app_id = submitted(client, seeded, h)["id"]
    take(client, h, app_id)
    body = send_offer(
        client,
        h,
        app_id,
        ltv_percent=None,
        daily_rate_bp=None,
        loan_amount=tenge(60_000),
        value_min=tenge(110_000),
        value_max=tenge(125_000),
        confidence=80,
    )
    offer = body["offer"]
    assert offer["loan_amount"] == tenge(60_000)
    assert offer["daily_rate_bp"] == 25 and offer["ltv_percent"] == 80  # category defaults
    assert offer["value_min"] == tenge(110_000) and offer["value_max"] == tenge(125_000)
    assert offer["interest"] == tenge(60_000) * 25 * 30 // 10_000
    assert body["expert_appraisal"]["confidence"] == 80


@pytest.mark.parametrize(
    ("kw", "field"),
    [
        ({"ltv_percent": 90}, "ltv_percent"),
        ({"daily_rate_bp": 50}, "daily_rate_bp"),
        ({"term_days": 90}, "term_days"),
        ({"loan_amount": tenge(200_000)}, "loan_amount"),
        ({"value_min": tenge(130_000)}, "value_min"),
        ({"value_max": tenge(100_000)}, "value_max"),
    ],
)
def test_offer_validation(
    client: TestClient, seeded: Session, h: Headers, kw: dict, field: str
) -> None:
    app_id = submitted(client, seeded, h)["id"]
    take(client, h, app_id)
    resp = client.post(
        f"/api/expert/applications/{app_id}/offer", json={**OFFER, **kw}, headers=h("expert")
    )
    assert resp.status_code == 422, resp.text
    assert [e["loc"][-1] for e in resp.json()["detail"]] == [field]
    assert resp.json()["message"] == "Проверьте условия займа"
    assert seeded.get(Application, app_id).status is ApplicationStatus.UNDER_REVIEW


def test_need_info_and_resubmit(client: TestClient, seeded: Session, h: Headers) -> None:
    app_id = submitted(client, seeded, h)["id"]
    take(client, h, app_id)
    short = client.post(
        f"/api/expert/applications/{app_id}/need-info", json={"comment": " "}, headers=h("expert")
    )
    assert short.status_code == 422
    resp = client.post(
        f"/api/expert/applications/{app_id}/need-info",
        json={"comment": "Сфотографируйте клеймо крупно"},
        headers=h("expert"),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "NEED_INFO"
    card = client.get(f"/api/applications/{app_id}", headers=h("client")).json()
    assert card["actions"] == ["edit", "submit"]
    assert card["history"][-1]["comment"] == "Сфотографируйте клеймо крупно"
    mine = client.get("/api/expert/queue?scope=mine", headers=h("expert")).json()
    assert [q["status"] for q in mine] == ["NEED_INFO"]

    assert upload(client, h("client"), app_id, jpeg(3)).status_code == 201
    resp = client.post(f"/api/applications/{app_id}/submit", headers=h("client"))
    assert resp.json()["status"] == "PRE_ESTIMATED"
    queue = client.get("/api/expert/queue", headers=h("expert")).json()
    item = next(q for q in queue if q["id"] == app_id)
    assert item["expert"]["full_name"] == "Ерлан Касымов"  # who handled it before
    take(client, h, app_id)
    assert send_offer(client, h, app_id)["status"] == "OFFER_SENT"


def test_reject(client: TestClient, seeded: Session, h: Headers) -> None:
    app_id = submitted(client, seeded, h)["id"]
    take(client, h, app_id)
    no_reason = client.post(
        f"/api/expert/applications/{app_id}/reject", json={}, headers=h("expert")
    )
    assert no_reason.status_code == 422
    assert no_reason.json()["detail"][0]["loc"] == ["body", "reason"]
    resp = client.post(
        f"/api/expert/applications/{app_id}/reject",
        json={"reason": "Изделие не принимается: бижутерия"},
        headers=h("expert"),
    )
    assert resp.status_code == 200 and resp.json()["status"] == "REJECTED"
    assert resp.json()["actions"] == []


# --- Access rules -------------------------------------------------------------------------


def test_actions_require_taking_first(client: TestClient, seeded: Session, h: Headers) -> None:
    app_id = submitted(client, seeded, h)["id"]
    resp = client.post(f"/api/expert/applications/{app_id}/offer", json=OFFER, headers=h("expert"))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Сначала возьмите заявку в работу"


def test_other_expert_cannot_act(
    client: TestClient, seeded: Session, h: Headers, second_expert: dict
) -> None:
    app_id = submitted(client, seeded, h)["id"]
    take(client, h, app_id)
    assert take(client, h, app_id)["status"] == "UNDER_REVIEW"  # idempotent for the owner
    resp = client.post(f"/api/expert/applications/{app_id}/take", headers=second_expert)
    assert resp.status_code == 409
    resp = client.post(
        f"/api/expert/applications/{app_id}/offer", json=OFFER, headers=second_expert
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Заявку ведёт другой эксперт"
    card = client.get(f"/api/applications/{app_id}", headers=second_expert).json()
    assert card["actions"] == []
    mine = client.get("/api/expert/queue?scope=mine", headers=second_expert).json()
    assert mine == []


def test_roles(client: TestClient, seeded: Session, h: Headers) -> None:
    app_id = submitted(client, seeded, h)["id"]
    for who in ("client", "courier"):
        assert client.get("/api/expert/queue", headers=h(who)).status_code == 403
    # Admin watches the queue but cannot act for an expert.
    assert client.get("/api/expert/queue?scope=all", headers=h("admin")).status_code == 200
    resp = client.post(f"/api/expert/applications/{app_id}/take", headers=h("admin"))
    assert resp.status_code == 403
    assert client.get("/api/expert/queue").status_code == 401
    take(client, h, app_id)
    send_offer(client, h, app_id)
    # Only the owner-client decides; experts cannot accept on the client's behalf.
    assert (
        client.post(f"/api/applications/{app_id}/offer/accept", headers=h("expert")).status_code
        == 403
    )
    assert (
        client.post(f"/api/applications/{app_id}/offer/accept", headers=h("client2")).status_code
        == 404
    )


def test_queue_scopes(client: TestClient, seeded: Session, h: Headers) -> None:
    first = submitted(client, seeded, h)["id"]
    second = submitted(client, seeded, h)["id"]
    new = client.get("/api/expert/queue?scope=new", headers=h("expert")).json()
    assert [q["id"] for q in new] == [first, second]  # FIFO
    take(client, h, second)
    all_ = client.get("/api/expert/queue?scope=all", headers=h("admin")).json()
    assert {q["id"] for q in all_} == {first, second}
    mine_admin = client.get("/api/expert/queue?scope=mine", headers=h("admin")).json()
    assert [q["id"] for q in mine_admin] == [second]
    assert client.get("/api/expert/queue?scope=bad", headers=h("expert")).status_code == 422


def test_accept_without_offer(client: TestClient, seeded: Session, h: Headers) -> None:
    app_id = submitted(client, seeded, h)["id"]
    resp = client.post(f"/api/applications/{app_id}/offer/accept", headers=h("client"))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Нет действующего предложения по заявке"


# --- Offer expiry -------------------------------------------------------------------------


def test_expired_offer_cannot_be_accepted(client: TestClient, seeded: Session, h: Headers):
    app_id = submitted(client, seeded, h)["id"]
    take(client, h, app_id)
    send_offer(client, h, app_id)
    offer = seeded.scalar(select(Offer).where(Offer.application_id == app_id))
    offer.expires_at = utcnow() - timedelta(minutes=1)
    seeded.commit()

    resp = client.post(f"/api/applications/{app_id}/offer/accept", headers=h("client"))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Срок действия предложения истёк"
    card = client.get(f"/api/applications/{app_id}", headers=h("client")).json()
    assert card["status"] == "OFFER_DECLINED"  # the expiry was committed
    assert card["offer"]["status"] == "EXPIRED"
    assert card["history"][-1]["actor_role"] is None  # done by the system


def test_expire_offers_job(client: TestClient, seeded: Session, h: Headers) -> None:
    ids = [submitted(client, seeded, h)["id"] for _ in range(2)]
    for app_id in ids:
        take(client, h, app_id)
        send_offer(client, h, app_id)
    seeded.expire_all()
    assert review.expire_offers(seeded) == 0
    later = utcnow() + timedelta(hours=73)
    assert review.expire_offers(seeded, now=later) == 2
    seeded.commit()
    for app_id in ids:
        app = seeded.get(Application, app_id)
        assert app.status is ApplicationStatus.OFFER_DECLINED
        assert app.offers[-1].status is OfferStatus.EXPIRED
    assert review.expire_offers(seeded, now=later) == 0


def test_new_offer_supersedes_old(client: TestClient, seeded: Session, h: Headers) -> None:
    """Service-level: a re-sent offer marks the previous SENT one as superseded."""
    app_id = submitted(client, seeded, h)["id"]
    take(client, h, app_id)
    send_offer(client, h, app_id)
    seeded.expire_all()
    app = seeded.get(Application, app_id)
    expert = seeded.scalar(select(User).where(User.role == Role.EXPERT))
    # Simulate "back to review" (not exposed in the API): reset status directly.
    app.status = ApplicationStatus.UNDER_REVIEW
    review.send_offer(
        seeded,
        app,
        expert,
        review.OfferInput(
            market_value=tenge(100_000), ltv_percent=80, daily_rate_bp=25, term_days=14
        ),
        ttl_hours=72,
    )
    seeded.commit()
    statuses = [o.status for o in sorted(app.offers, key=lambda o: o.id)]
    assert statuses == [OfferStatus.SUPERSEDED, OfferStatus.SENT]
    kinds = [
        a.kind for a in seeded.scalars(select(Appraisal).where(Appraisal.application_id == app_id))
    ]
    assert kinds.count(AppraisalKind.EXPERT) == 2


# --- Public calculator --------------------------------------------------------------------


def test_calculator_by_value(client: TestClient, seeded: Session) -> None:
    resp = client.post(
        "/api/calculator",
        json={"category_code": "gold", "market_value": tenge(119_000), "term_days": 30},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["estimated"] is False and body["ltv_percent"] == 80
    assert body["max_loan_amount"] == tenge(95_200)
    q = body["quote"]
    assert q["daily_rate_bp"] == 25 and q["interest"] == tenge(95_200) * 25 * 30 // 10_000
    assert q["schedule"][-1]["day"] == 30


def test_calculator_by_metal_params(client: TestClient, seeded: Session) -> None:
    resp = client.post(
        "/api/calculator",
        json={
            "category_id": category_id(seeded, "gold"),
            "metal": "GOLD",
            "fineness": 585,
            "weight_g": "4.2",
            "term_days": 30,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["estimated"] is True
    assert body["value_min"] <= body["market_value"] <= body["value_max"]
    assert body["max_loan_amount"] <= body["market_value"] * 80 // 100
    assert body["estimate_steps"]
    # Requested smaller amount.
    resp = client.post(
        "/api/calculator",
        json={
            "category_code": "gold",
            "market_value": tenge(119_000),
            "term_days": 7,
            "loan_amount": tenge(50_000),
        },
    )
    assert resp.json()["quote"]["loan_amount"] == tenge(50_000)


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"category_code": "gold", "term_days": 30}, "market_value"),  # no params
        ({"category_code": "nope", "market_value": 100_000_00, "term_days": 30}, "category_id"),
        (
            {"category_code": "electronics", "market_value": 100_000_00, "term_days": 45},
            "term_days",
        ),
        (
            {
                "category_code": "gold",
                "metal": "SILVER",
                "fineness": 925,
                "weight_g": "5",
                "term_days": 30,
            },
            "metal",
        ),
        (
            {
                "category_code": "gold",
                "market_value": 100_000_00,
                "term_days": 30,
                "loan_amount": 90_000_00,
            },
            "loan_amount",
        ),
    ],
)
def test_calculator_errors(client: TestClient, seeded: Session, payload: dict, field: str) -> None:
    resp = client.post("/api/calculator", json=payload)
    assert resp.status_code == 422, resp.text
    assert field in [e["loc"][-1] for e in resp.json()["detail"]]


def test_calculator_needs_category(client: TestClient, seeded: Session) -> None:
    resp = client.post("/api/calculator", json={"market_value": 100_000_00, "term_days": 30})
    assert resp.status_code == 422
    assert "категорию" in resp.json()["detail"][0]["msg"]


def test_calculator_brand(client: TestClient, seeded: Session) -> None:
    resp = client.post(
        "/api/calculator",
        json={"category_code": "watches", "brand": "Rolex", "condition": "GOOD", "term_days": 14},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ltv_percent"] == 60 and resp.json()["estimated"] is True
