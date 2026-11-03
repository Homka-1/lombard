from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import func, inspect, select

from alembic import command
from app.core.db import make_engine, make_session_factory
from app.core.security import verify_password
from app.domain.enums import ApplicationStatus, Role
from app.models import Application, Base, Category, MetalPrice, User
from app.seed import DEMO_PASSWORD, DEMO_USERS, run_seed

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def alembic_cfg(db_url: str) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    cfg.attributes["configure_logger"] = False
    return cfg


@pytest.fixture
def migrated_engine(alembic_cfg, db_url):
    command.upgrade(alembic_cfg, "head")
    engine = make_engine(db_url)
    yield engine
    engine.dispose()


def test_upgrade_creates_all_tables(migrated_engine):
    tables = set(inspect(migrated_engine).get_table_names())
    assert set(Base.metadata.tables) <= tables
    assert "alembic_version" in tables


def test_migrations_match_models(migrated_engine):
    with migrated_engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []


def test_downgrade_to_base(alembic_cfg, migrated_engine):
    command.downgrade(alembic_cfg, "base")
    assert inspect(migrated_engine).get_table_names() == ["alembic_version"]


def test_seed_after_migrations_is_idempotent(migrated_engine):
    factory = make_session_factory(migrated_engine)
    with factory() as session:
        first = run_seed(session)
        assert first.created["users"] == len(DEMO_USERS)
    with factory() as session:
        second = run_seed(session)
        assert second.created == {}

        assert session.scalar(select(func.count()).select_from(Category)) == 5
        assert session.scalar(select(func.count()).select_from(MetalPrice)) == 4
        assert session.scalar(select(func.count()).select_from(Application)) == 1

        roles = set(session.scalars(select(User.role)))
        assert roles == set(Role)

        admin = session.scalar(select(User).where(User.email == "admin@lombard.kz"))
        assert verify_password(DEMO_PASSWORD, admin.password_hash)
        assert not verify_password("wrong", admin.password_hash)

        draft = session.scalar(select(Application))
        assert draft.status is ApplicationStatus.DRAFT
        assert len(draft.history) == 1


def test_seed_phones_are_kazakh(migrated_engine):
    with make_session_factory(migrated_engine)() as session:
        run_seed(session)
        for user in session.scalars(select(User)):
            assert user.phone.startswith("+77") and len(user.phone) == 12


def test_seed_reset_passwords(migrated_engine):
    factory = make_session_factory(migrated_engine)
    with factory() as session:
        run_seed(session)
        user = session.scalar(select(User).where(User.email == "client@lombard.kz"))
        user.password_hash = "broken"
        session.commit()
        report = run_seed(session, reset_passwords=True)
        assert report.created == {"password_resets": 1}
        assert verify_password(DEMO_PASSWORD, user.password_hash)
