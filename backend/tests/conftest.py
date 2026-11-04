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
def settings(db_url: str, tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        database_url=db_url,
        upload_dir=str(tmp_path / "uploads"),
    )


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


@pytest.fixture
def h(auth_headers):
    """Like `auth_headers`, but logs each role in only once per test."""
    cache: dict[str, dict[str, str]] = {}

    def get(who: str) -> dict[str, str]:
        if who not in cache:
            cache[who] = auth_headers(who)
        return cache[who]

    return get


# --- Images for photo tests ---------------------------------------------------------------


def make_scene(seed: int = 1, size: tuple[int, int] = (1200, 900)):
    """Deterministic 'photo': random shapes with outlines — sharp, well exposed."""
    import random

    from PIL import Image, ImageDraw

    rnd = random.Random(seed)
    img = Image.new("RGB", size, (150, 140, 130))
    draw = ImageDraw.Draw(img)
    for _ in range(60):
        x, y = rnd.randrange(size[0]), rnd.randrange(size[1])
        w = rnd.randrange(20, 200)
        color = tuple(rnd.randrange(256) for _ in range(3))
        if rnd.random() < 0.5:
            draw.ellipse([x, y, x + w, y + w], fill=color, outline=(0, 0, 0), width=3)
        else:
            draw.rectangle([x, y, x + w, y + w // 2], fill=color)
    return img


def image_bytes(img, fmt: str = "JPEG", **save_kwargs) -> bytes:
    import io

    buf = io.BytesIO()
    img.save(buf, format=fmt, **save_kwargs)
    return buf.getvalue()


def jpeg(seed: int = 1, size: tuple[int, int] = (1200, 900)) -> bytes:
    return image_bytes(make_scene(seed, size), "JPEG", quality=90)
