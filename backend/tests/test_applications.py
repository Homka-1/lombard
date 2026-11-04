"""Applications API: CRUD, photos, submission with the automatic pre-estimate."""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from PIL import ImageFilter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import ApplicationStatus, Role
from app.models import Application, Category, MetalPrice, Photo, User
from app.services.status import change_status
from tests.conftest import image_bytes, jpeg, make_scene

Headers = Callable[[str], dict[str, str]]


def category_id(session: Session, code: str) -> int:
    return session.scalar(select(Category.id).where(Category.code == code))


def gold_payload(session: Session, **kw) -> dict:
    data = {
        "category_id": category_id(session, "gold"),
        "title": "  Кольцо   с бриллиантом ",
        "description": "Золотое кольцо, есть бирка",
        "metal": "GOLD",
        "fineness": 585,
        "weight_g": "3.52",
        "condition": "EXCELLENT",
        "requested_amount": 150_000_00,
    }
    data.update(kw)
    return data


def create(client: TestClient, headers: dict, payload: dict) -> dict:
    resp = client.post("/api/applications", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def upload(client: TestClient, headers: dict, app_id: int, *blobs: bytes, name: str = "ring.jpg"):
    files = [("files", (f"{i}-{name}", blob, "image/jpeg")) for i, blob in enumerate(blobs)]
    return client.post(f"/api/applications/{app_id}/photos", files=files, headers=headers)


# --- catalog ------------------------------------------------------------------------------


def test_catalog_is_public(client: TestClient, seeded: Session) -> None:
    cats = client.get("/api/catalog/categories").json()
    assert [c["code"] for c in cats] == ["gold", "silver", "platinum", "watches", "electronics"]
    gold = cats[0]
    assert gold["allowed_metals"] == ["GOLD"]
    assert len(cats[3]["allowed_metals"]) == 4  # watches: any metal
    metals = {m["metal"]: m for m in client.get("/api/catalog/metals").json()}
    assert metals["GOLD"]["price_per_gram"] == 66_500_00
    assert 585 in metals["GOLD"]["finenesses"] and 925 in metals["SILVER"]["finenesses"]
    conditions = client.get("/api/catalog/conditions").json()
    assert conditions[0] == {"condition": "NEW", "label": "Новое"}


# --- CRUD ---------------------------------------------------------------------------------


def test_create_draft(client: TestClient, seeded: Session, h: Headers) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    assert app["status"] == "DRAFT" and app["status_label"] == "Черновик"
    assert app["number"] == f"Л-{app['id']:06d}"
    assert app["title"] == "Кольцо с бриллиантом"
    assert app["weight_g"] == 3.52
    assert app["category"]["code"] == "gold"
    assert app["editable"] is True and app["photos"] == [] and app["pre_estimate"] is None
    assert app["max_photos"] == 6
    assert [e["to_status"] for e in app["history"]] == ["DRAFT"]
    stored = seeded.get(Application, app["id"])
    seeded.refresh(stored)
    assert stored.weight_mg == 3520


@pytest.mark.parametrize(
    ("override", "field", "text"),
    [
        ({"fineness": 925}, "fineness", "Проба 925"),
        ({"metal": "SILVER", "fineness": 925}, "metal", "Золото"),
        ({"category_id": 9999}, "category_id", "не найдена"),
        ({"weight_g": "-1"}, "weight_g", "больше 0"),
        ({"weight_g": "1.2345"}, "weight_g", "знаков"),
        ({"title": " a "}, "title", "Минимальная длина"),
        ({"condition": "BROKEN"}, "condition", "Допустимые значения"),
    ],
)
def test_create_validation(
    client: TestClient, seeded: Session, h: Headers, override: dict, field: str, text: str
) -> None:
    payload = gold_payload(seeded, **override)
    resp = client.post("/api/applications", json=payload, headers=h("client"))
    assert resp.status_code == 422, resp.text
    errors = resp.json()["detail"]
    assert any(e["loc"][-1] == field and text in e["msg"] for e in errors), errors


def test_only_clients_create(client: TestClient, seeded: Session, h: Headers) -> None:
    for who in ("expert", "courier", "admin"):
        resp = client.post("/api/applications", json=gold_payload(seeded), headers=h(who))
        assert resp.status_code == 403
    assert client.post("/api/applications", json=gold_payload(seeded)).status_code == 401


def test_list_and_visibility(client: TestClient, seeded: Session, h: Headers) -> None:
    own = create(client, h("client"), gold_payload(seeded))
    other = create(client, h("client2"), gold_payload(seeded, title="Цепь"))

    mine = client.get("/api/applications", headers=h("client")).json()
    ids = {a["id"] for a in mine}
    assert own["id"] in ids and other["id"] not in ids  # + the seeded draft
    assert len(mine) == 2

    # Someone else's application looks like a missing one.
    assert client.get(f"/api/applications/{other['id']}", headers=h("client")).status_code == 404
    assert (
        client.patch(
            f"/api/applications/{other['id']}", json={"title": "Чужая"}, headers=h("client")
        ).status_code
        == 404
    )

    # Experts and admins see all; couriers have no access to applications here.
    all_ids = {a["id"] for a in client.get("/api/applications", headers=h("expert")).json()}
    assert {own["id"], other["id"]} <= all_ids
    assert client.get(f"/api/applications/{own['id']}", headers=h("admin")).status_code == 200
    assert client.get("/api/applications", headers=h("courier")).status_code == 403

    drafts = client.get("/api/applications?status=DRAFT", headers=h("expert")).json()
    assert all(a["status"] == "DRAFT" for a in drafts) and len(drafts) == 3
    assert client.get("/api/applications?status=OFFER_SENT", headers=h("expert")).json() == []


def test_update_draft(client: TestClient, seeded: Session, h: Headers) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    url = f"/api/applications/{app['id']}"
    resp = client.patch(
        url, json={"weight_g": 5, "brand": "  Tiffany ", "title": None}, headers=h("client")
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["weight_g"] == 5.0 and body["brand"] == "Tiffany"
    assert body["title"] == "Кольцо с бриллиантом"  # null title = unchanged

    # Cross-field check uses the stored metal: 925 is not a gold hallmark.
    assert client.patch(url, json={"fineness": 925}, headers=h("client")).status_code == 422
    # Switch category to silver together with metal and fineness.
    resp = client.patch(
        url,
        json={"category_id": category_id(seeded, "silver"), "metal": "SILVER", "fineness": 925},
        headers=h("client"),
    )
    assert resp.status_code == 200 and resp.json()["category"]["code"] == "silver"
    # Clear an optional field.
    assert client.patch(url, json={"brand": None}, headers=h("client")).json()["brand"] is None


def test_delete_draft_removes_files(
    client: TestClient, seeded: Session, h: Headers, settings
) -> None:
    from pathlib import Path

    app = create(client, h("client"), gold_payload(seeded))
    assert upload(client, h("client"), app["id"], jpeg(1)).status_code == 201
    folder = Path(settings.upload_dir) / "applications" / str(app["id"])
    assert len(list(folder.iterdir())) == 2  # full + thumbnail

    resp = client.delete(f"/api/applications/{app['id']}", headers=h("client"))
    assert resp.status_code == 204
    assert list(folder.iterdir()) == []
    assert client.get(f"/api/applications/{app['id']}", headers=h("client")).status_code == 404


# --- photos -------------------------------------------------------------------------------


def test_upload_photos_and_fetch_by_signed_url(
    client: TestClient, seeded: Session, h: Headers
) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    resp = upload(client, h("client"), app["id"], jpeg(1, (3000, 2000)), jpeg(2))
    assert resp.status_code == 201, resp.text
    photos = resp.json()["photos"]
    assert [p["position"] for p in photos] == [0, 1]
    first = photos[0]
    assert first["content_type"] == "image/jpeg"
    assert max(first["width"], first["height"]) == 2560
    assert 0 <= first["quality_score"] <= 100

    # The URL works without the Authorization header (for <img src>).
    img = client.get(first["url"])
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/jpeg"
    assert img.content[:2] == b"\xff\xd8"
    thumb = client.get(first["thumb_url"])
    assert thumb.status_code == 200 and len(thumb.content) < len(img.content)

    # Tampered / foreign signatures are rejected.
    bad = first["url"].replace(f"/photos/{first['id']}/", f"/photos/{photos[1]['id']}/")
    assert client.get(bad).status_code == 403
    assert client.get(first["url"][:-4] + "0000").status_code == 403
    assert client.get(f"/api/photos/{first['id']}/full").status_code == 422

    listed = client.get("/api/applications", headers=h("client")).json()
    item = next(a for a in listed if a["id"] == app["id"])
    assert item["photo_count"] == 2 and "/thumb?" in item["cover_thumb_url"]


def test_upload_limits(client: TestClient, seeded: Session, h: Headers, settings) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    aid = app["id"]
    assert upload(client, h("client"), aid, *[jpeg(i) for i in range(4)]).status_code == 201

    resp = upload(client, h("client"), aid, *[jpeg(i) for i in range(3)])
    assert resp.status_code == 422
    assert "не больше 6 фото" in resp.json()["detail"][0]["msg"]
    assert "осталось мест: 2" in resp.json()["detail"][0]["msg"]

    # A bad file in the batch: nothing from the batch is saved.
    resp = upload(client, h("client"), aid, jpeg(5), b"not an image")
    assert resp.status_code == 422
    assert "не является изображением" in resp.json()["detail"][0]["msg"]
    assert len(client.get(f"/api/applications/{aid}", headers=h("client")).json()["photos"]) == 4

    assert upload(client, h("client"), aid, jpeg(5), jpeg(6)).status_code == 201
    resp = upload(client, h("client"), aid, jpeg(7))
    assert resp.status_code == 422 and "лимит исчерпан" in resp.json()["detail"][0]["msg"]


def test_upload_too_large(client: TestClient, seeded: Session, h: Headers, settings) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    big = b"\xff\xd8" + b"0" * (settings.max_photo_bytes + 10)
    resp = upload(client, h("client"), app["id"], big)
    assert resp.status_code == 413
    assert "10 МБ" in resp.json()["detail"]


def test_upload_png_and_webp(client: TestClient, seeded: Session, h: Headers) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    files = [
        ("files", ("a.png", image_bytes(make_scene(1, (800, 600)), "PNG"), "image/png")),
        ("files", ("b.webp", image_bytes(make_scene(2, (800, 600)), "WEBP"), "image/webp")),
    ]
    resp = client.post(f"/api/applications/{app['id']}/photos", files=files, headers=h("client"))
    assert resp.status_code == 201, resp.text
    assert [p["original_name"] for p in resp.json()["photos"]] == ["a.png", "b.webp"]
    assert {p["content_type"] for p in resp.json()["photos"]} == {"image/jpeg"}


def test_delete_and_reorder_photos(client: TestClient, seeded: Session, h: Headers) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    aid = app["id"]
    photos = upload(client, h("client"), aid, jpeg(1), jpeg(2), jpeg(3)).json()["photos"]
    p1, p2, p3 = (p["id"] for p in photos)

    order_url = f"/api/applications/{aid}/photos/order"
    resp = client.put(order_url, json={"photo_ids": [p3, p1, p2]}, headers=h("client"))
    assert resp.status_code == 200
    assert [p["id"] for p in resp.json()["photos"]] == [p3, p1, p2]
    resp = client.put(order_url, json={"photo_ids": [p3, p1]}, headers=h("client"))
    assert resp.status_code == 422

    resp = client.delete(f"/api/applications/{aid}/photos/{p1}", headers=h("client"))
    assert resp.status_code == 200
    assert [(p["id"], p["position"]) for p in resp.json()["photos"]] == [(p3, 0), (p2, 1)]
    again = client.delete(f"/api/applications/{aid}/photos/{p1}", headers=h("client"))
    assert again.status_code == 404
    seeded.expire_all()
    assert seeded.get(Photo, p1) is None


# --- submission and pre-estimate ----------------------------------------------------------


def test_submit_requires_photos_and_params(client: TestClient, seeded: Session, h: Headers) -> None:
    app = create(
        client,
        h("client"),
        gold_payload(seeded, fineness=None, weight_g=None, condition=None),
    )
    resp = client.post(f"/api/applications/{app['id']}/submit", headers=h("client"))
    assert resp.status_code == 422
    body = resp.json()
    assert body["message"] == "Заявку пока нельзя отправить"
    fields = {e["loc"][-1] for e in body["detail"]}
    assert fields == {"photos", "condition", "fineness", "weight_g"}


def test_submit_gold_ring_gets_pre_estimate(
    client: TestClient, seeded: Session, h: Headers
) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    aid = app["id"]
    upload(client, h("client"), aid, jpeg(1), jpeg(2), jpeg(3))

    resp = client.post(f"/api/applications/{aid}/submit", headers=h("client"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "PRE_ESTIMATED"
    assert body["status_label"] == "Предоценка готова"
    assert body["editable"] is False and body["submitted_at"] is not None
    assert [e["to_status"] for e in body["history"]] == ["DRAFT", "SUBMITTED", "PRE_ESTIMATED"]
    assert body["history"][1]["actor_role"] == "CLIENT"
    assert body["history"][2]["actor_role"] is None  # the system

    pre = body["pre_estimate"]
    assert pre["kind"] == "AUTO"
    # 3.52 g × 0.585 × 66 500 ₸ ≈ 136 937 ₸ → 136 900 ₸
    assert pre["value"] == 136_900_00
    assert pre["value_min"] < pre["value"] < pre["value_max"]
    assert 60 <= pre["confidence"] <= 95
    details = pre["details"]
    assert details["method"] == "metal"
    assert details["ltv_percent"] == 80
    assert details["loan_estimate"]["max"] == 109_500_00  # 80 % of 136 900 ₸, rounded
    assert details["metal_price"]["price_per_gram"] == 66_500_00
    assert len(details["photos"]["photos"]) == 3
    assert details["photo_appraiser"] == "heuristic-v1"
    assert "Предварительная оценка" in pre["comment"]
    assert all(p["quality_score"] is not None for p in body["photos"])

    # After submission the application is read-only for the client.
    url = f"/api/applications/{aid}"
    assert client.patch(url, json={"title": "Новое"}, headers=h("client")).status_code == 409
    assert upload(client, h("client"), aid, jpeg(4)).status_code == 409
    assert client.delete(url, headers=h("client")).status_code == 409
    assert client.post(f"{url}/submit", headers=h("client")).status_code == 409

    listed = client.get("/api/applications", headers=h("client")).json()
    item = next(a for a in listed if a["id"] == aid)
    assert item["pre_estimate_min"] == pre["value_min"]
    assert item["pre_estimate_max"] == pre["value_max"]


def test_watch_pre_estimate_and_photo_quality_matters(
    client: TestClient, seeded: Session, h: Headers
) -> None:
    def submit(blobs: list[bytes]) -> dict:
        payload = {
            "category_id": category_id(seeded, "watches"),
            "title": "Часы Omega",
            "brand": "Omega Seamaster",
            "condition": "GOOD",
        }
        app = create(client, h("client"), payload)
        assert upload(client, h("client"), app["id"], *blobs).status_code == 201
        resp = client.post(f"/api/applications/{app['id']}/submit", headers=h("client"))
        assert resp.status_code == 200, resp.text
        return resp.json()["pre_estimate"]

    good = submit([jpeg(1), jpeg(2), jpeg(3)])
    blurry = image_bytes(make_scene(1).filter(ImageFilter.GaussianBlur(6)), "JPEG")
    poor = submit([blurry])
    assert good["details"]["method"] == "brand"
    assert good["value"] == poor["value"] == 1_050_000_00  # 1.5 M ₸ × 0.7 (GOOD)
    assert poor["confidence"] < good["confidence"]
    assert poor["value_max"] - poor["value_min"] > good["value_max"] - good["value_min"]
    assert any("нерезкое" in i for i in poor["details"]["photos"]["issues"])


def test_need_info_resubmit_creates_new_pre_estimate(
    client: TestClient, seeded: Session, h: Headers
) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    aid = app["id"]
    upload(client, h("client"), aid, jpeg(1))
    first = client.post(f"/api/applications/{aid}/submit", headers=h("client")).json()

    # Expert flow is stage 6: move the application to NEED_INFO directly.
    expert = seeded.scalar(select(User).where(User.role == Role.EXPERT))
    obj = seeded.get(Application, aid)
    change_status(seeded, obj, ApplicationStatus.UNDER_REVIEW, user=expert)
    change_status(seeded, obj, ApplicationStatus.NEED_INFO, user=expert, comment="Фото пробы")
    seeded.commit()

    detail = client.get(f"/api/applications/{aid}", headers=h("client")).json()
    assert detail["status"] == "NEED_INFO" and detail["editable"] is True
    assert upload(client, h("client"), aid, jpeg(2), jpeg(3)).status_code == 201
    resp = client.post(f"/api/applications/{aid}/submit", headers=h("client"))
    assert resp.status_code == 200, resp.text
    second = resp.json()
    assert second["status"] == "PRE_ESTIMATED"
    assert second["pre_estimate"]["id"] != first["pre_estimate"]["id"]
    assert second["pre_estimate"]["confidence"] > first["pre_estimate"]["confidence"]
    assert second["history"][-2]["comment"] == "Повторно отправлена с дополнениями"


def test_submit_without_metal_price_fails_cleanly(
    client: TestClient, seeded: Session, h: Headers
) -> None:
    app = create(client, h("client"), gold_payload(seeded))
    upload(client, h("client"), app["id"], jpeg(1))
    for price in seeded.scalars(select(MetalPrice).where(MetalPrice.metal == "GOLD")):
        seeded.delete(price)
    seeded.commit()
    resp = client.post(f"/api/applications/{app['id']}/submit", headers=h("client"))
    assert resp.status_code == 422
    assert "Нет цены" in resp.json()["detail"][0]["msg"]
    # Nothing changed: still a draft without appraisals.
    detail = client.get(f"/api/applications/{app['id']}", headers=h("client")).json()
    assert detail["status"] == "DRAFT" and detail["pre_estimate"] is None


def test_seeded_draft_can_be_completed(client: TestClient, seeded: Session, h: Headers) -> None:
    draft = client.get("/api/applications", headers=h("client")).json()[0]
    assert draft["status"] == "DRAFT"
    assert upload(client, h("client"), draft["id"], jpeg(1), jpeg(2)).status_code == 201
    resp = client.post(f"/api/applications/{draft['id']}/submit", headers=h("client"))
    assert resp.status_code == 200 and resp.json()["status"] == "PRE_ESTIMATED"
