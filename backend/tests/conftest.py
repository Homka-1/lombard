from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import make_engine, make_session_factory
from app.main import create_app
from app.models import Base


@pytest.fixture(autouse=True)
def _fast_bcrypt(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.core.security as security

    monkeypatch.setattr(security, "BCRYPT_ROUNDS", 4)


@pytest.fixture
def db_url(tmp_path: Path) -> str:
    return f"sqlite:///{tmp_path / 'test.db'}"


@pytest.fixture
def settings(db_url: str) -> Settings:
    return Settings(_env_file=None, environment="test", database_url=db_url)


@pytest.fixture
def engine(db_url: str) -> Iterator[Engine]:
    engine = make_engine(db_url)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    with make_session_factory(engine)() as session:
        yield session


@pytest.fixture
def client(settings: Settings, engine: Engine) -> Iterator[TestClient]:
    app = create_app(settings)
    with TestClient(app) as client:
        yield client
    app.state.engine.dispose()


@pytest.fixture
def seeded(session: Session) -> Session:
    """DB with reference data and demo users (password `demo1234`)."""
    from app.seed import run_seed

    run_seed(session)
    session.commit()
    return session


def login(client: TestClient, email: str, password: str = "demo1234") -> dict[str, str]:
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture
def auth_headers(client: TestClient, seeded: Session):
    """`auth_headers("expert")` → Authorization header of the demo user of that role."""
    emails = {
        "client": "client@lombard.kz",
        "client2": "client2@lombard.kz",
        "expert": "expert@lombard.kz",
        "courier": "courier@lombard.kz",
        "admin": "admin@lombard.kz",
    }
    return lambda who: login(client, emails[who])
