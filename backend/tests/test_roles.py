from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.core.deps import require_role
from app.domain.enums import Actor, ApplicationStatus, Role
from app.domain.state_machine import ensure_transition
from app.main import create_app
from app.models import User
from tests.conftest import login


@pytest.fixture
def role_client(settings, engine, seeded):
    """App with probe routes guarded by `require_role`."""
    app = create_app(settings)

    @app.get("/api/_probe/expert")
    def expert_only(user: Annotated[User, Depends(require_role(Role.EXPERT))]):
        return {"id": user.id}

    @app.get("/api/_probe/staff", dependencies=[Depends(require_role(Role.EXPERT, Role.COURIER))])
    def staff_only():
        return {"ok": True}

    @app.get("/api/_probe/transition")
    def forbidden_transition():
        ensure_transition(ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED, Actor.EXPERT)

    @app.get("/api/_probe/invalid")
    def invalid_transition():
        ensure_transition(ApplicationStatus.DRAFT, ApplicationStatus.LOAN_ACTIVE, Actor.ADMIN)

    with TestClient(app) as client:
        yield client
    app.state.engine.dispose()


@pytest.mark.parametrize(
    ("email", "expert", "staff"),
    [
        ("client@lombard.kz", 403, 403),
        ("expert@lombard.kz", 200, 200),
        ("courier@lombard.kz", 403, 200),
        ("admin@lombard.kz", 403, 403),  # no implicit admin bypass
    ],
)
def test_require_role_matrix(role_client, email, expert, staff):
    headers = login(role_client, email)
    assert role_client.get("/api/_probe/expert", headers=headers).status_code == expert
    assert role_client.get("/api/_probe/staff", headers=headers).status_code == staff


def test_require_role_anonymous_is_401(role_client):
    assert role_client.get("/api/_probe/expert").status_code == 401


def test_require_role_needs_roles():
    with pytest.raises(ValueError):
        require_role()


def test_transition_errors_mapped_to_http(role_client):
    resp = role_client.get("/api/_probe/transition")
    assert resp.status_code == 403
    assert resp.json()["detail"]
    assert role_client.get("/api/_probe/invalid").status_code == 409


def test_admin_users_access(client, auth_headers):
    assert client.get("/api/admin/users").status_code == 401
    for who in ("client", "expert", "courier"):
        assert client.get("/api/admin/users", headers=auth_headers(who)).status_code == 403
    resp = client.get("/api/admin/users", headers=auth_headers("admin"))
    assert resp.status_code == 200
    assert {u["role"] for u in resp.json()} == {"CLIENT", "EXPERT", "COURIER", "ADMIN"}
    couriers = client.get(
        "/api/admin/users", params={"role": "COURIER"}, headers=auth_headers("admin")
    ).json()
    assert len(couriers) == 2


def test_admin_promotes_user_role_applies_after_refresh(client, auth_headers):
    admin = auth_headers("admin")
    body = client.post(
        "/api/auth/login", json={"email": "client2@lombard.kz", "password": "demo1234"}
    ).json()
    uid = body["user"]["id"]
    resp = client.patch(f"/api/admin/users/{uid}", headers=admin, json={"role": "COURIER"})
    assert resp.status_code == 200 and resp.json()["role"] == "COURIER"
    # The role is always read from the DB, so access changes immediately.
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.json()["role"] == "COURIER"

    blocked = client.patch(f"/api/admin/users/{uid}", headers=admin, json={"is_active": False})
    assert blocked.json()["is_active"] is False
    assert (
        client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
        ).status_code
        == 401
    )


def test_admin_cannot_demote_self(client, auth_headers):
    admin = auth_headers("admin")
    me = client.get("/api/auth/me", headers=admin).json()
    for patch in ({"role": "CLIENT"}, {"is_active": False}):
        resp = client.patch(f"/api/admin/users/{me['id']}", headers=admin, json=patch)
        assert resp.status_code == 409
    assert client.patch("/api/admin/users/99999", headers=admin, json={}).status_code == 404
