from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.security import TokenType, create_token, verify_password
from app.domain.enums import Role
from app.models import User
from tests.conftest import login

NEW_USER = {
    "email": "Asem.Test@Mail.KZ",
    "password": "secret123",
    "full_name": "  Асем   Тестова ",
    "phone": "8 (701) 555-44-33",
    "city": "Шымкент",
}


def test_register_creates_client(client, session):
    resp = client.post("/api/auth/register", json=NEW_USER)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"] and body["refresh_token"]
    user = body["user"]
    assert user["email"] == "asem.test@mail.kz"
    assert user["full_name"] == "Асем Тестова"
    assert user["phone"] == "+77015554433"
    assert user["phone_display"] == "+7 701 555-44-33"
    assert user["role"] == "CLIENT"
    assert "password_hash" not in user

    db_user = session.scalar(select(User).where(User.email == "asem.test@mail.kz"))
    assert db_user.password_hash != NEW_USER["password"]
    assert verify_password("secret123", db_user.password_hash)


def test_register_ignores_role_field(client):
    resp = client.post("/api/auth/register", json={**NEW_USER, "role": "ADMIN"})
    assert resp.status_code == 201
    assert resp.json()["user"]["role"] == "CLIENT"


def test_register_duplicate_email_case_insensitive(client):
    assert client.post("/api/auth/register", json=NEW_USER).status_code == 201
    resp = client.post("/api/auth/register", json={**NEW_USER, "email": "asem.test@mail.kz"})
    assert resp.status_code == 409
    assert "уже существует" in resp.json()["detail"]


def test_register_validation(client):
    for patch in (
        {"password": "short1"},
        {"password": "onlyletters"},
        {"email": "not-an-email"},
        {"phone": "+7 912 000-00-00"},
        {"full_name": " "},
    ):
        resp = client.post("/api/auth/register", json={**NEW_USER, **patch})
        assert resp.status_code == 422, patch


def test_login_demo_user_and_me(client, seeded):
    resp = client.post(
        "/api/auth/login", json={"email": "EXPERT@lombard.kz", "password": "demo1234"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user"]["role"] == "EXPERT"
    assert body["user"]["last_login_at"] is not None

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "expert@lombard.kz"


def test_login_wrong_password_and_unknown_email(client, seeded):
    for email, pwd in (("client@lombard.kz", "wrong1234"), ("nobody@lombard.kz", "demo1234")):
        resp = client.post("/api/auth/login", json={"email": email, "password": pwd})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Неверный e-mail или пароль"
        assert resp.headers["www-authenticate"] == "Bearer"


def test_login_inactive_user(client, seeded):
    user = seeded.scalar(select(User).where(User.email == "client2@lombard.kz"))
    user.is_active = False
    seeded.commit()
    resp = client.post(
        "/api/auth/login", json={"email": "client2@lombard.kz", "password": "demo1234"}
    )
    assert resp.status_code == 403


def test_oauth2_form_token_for_swagger(client, seeded):
    resp = client.post(
        "/api/auth/token", data={"username": "admin@lombard.kz", "password": "demo1234"}
    )
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    assert (
        client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["role"]
        == "ADMIN"
    )


def test_me_requires_token(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401
    assert resp.headers["www-authenticate"] == "Bearer"
    bad = client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
    assert bad.status_code == 401


def test_refresh_token_cannot_be_used_as_access(client, seeded):
    body = client.post(
        "/api/auth/login", json={"email": "client@lombard.kz", "password": "demo1234"}
    ).json()
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['refresh_token']}"})
    assert resp.status_code == 401


def test_refresh_issues_new_pair(client, seeded):
    body = client.post(
        "/api/auth/login", json={"email": "client@lombard.kz", "password": "demo1234"}
    ).json()
    resp = client.post("/api/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert resp.status_code == 200
    new = resp.json()
    assert new["access_token"] != body["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {new['access_token']}"})
    assert me.status_code == 200

    # An access token is not accepted by /refresh.
    resp = client.post("/api/auth/refresh", json={"refresh_token": body["access_token"]})
    assert resp.status_code == 401


def test_refresh_rejected_for_blocked_user(client, seeded):
    body = client.post(
        "/api/auth/login", json={"email": "client@lombard.kz", "password": "demo1234"}
    ).json()
    user = seeded.scalar(select(User).where(User.email == "client@lombard.kz"))
    user.is_active = False
    seeded.commit()
    resp = client.post("/api/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert resp.status_code == 401
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 401


def test_expired_access_token(client, seeded, settings):
    user = seeded.scalar(select(User).where(User.email == "client@lombard.kz"))
    past = datetime.now(UTC) - timedelta(days=1)
    token, _ = create_token(user.id, Role.CLIENT, TokenType.ACCESS, settings, now=past)
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert "истёк" in resp.json()["detail"]


def test_update_profile_and_change_password(client, seeded):
    headers = login(client, "client@lombard.kz")
    resp = client.patch(
        "/api/auth/me",
        headers=headers,
        json={"phone": "+7 777 000-11-22", "city": "Караганда", "role": "ADMIN"},
    )
    assert resp.status_code == 200
    assert resp.json()["phone"] == "+77770001122"
    assert resp.json()["role"] == "CLIENT"

    wrong = client.post(
        "/api/auth/me/password",
        headers=headers,
        json={"current_password": "nope", "new_password": "newpass99"},
    )
    assert wrong.status_code == 400
    ok = client.post(
        "/api/auth/me/password",
        headers=headers,
        json={"current_password": "demo1234", "new_password": "newpass99"},
    )
    assert ok.status_code == 204
    login(client, "client@lombard.kz", "newpass99")


def test_validation_messages_in_russian(client):
    resp = client.post(
        "/api/auth/register",
        json={"email": "bad", "password": "x", "full_name": "Асем", "phone": "123"},
    )
    assert resp.status_code == 422
    msgs = {e["loc"][-1]: e["msg"] for e in resp.json()["detail"]}
    assert msgs["password"] == "Минимальная длина — 8 симв."
    assert msgs["email"] == "Некорректный адрес e-mail"
    assert msgs["phone"].startswith("Введите номер")
