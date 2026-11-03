"""Alembic environment. DB URL: `sqlalchemy.url` if set, else app settings."""

from logging.config import fileConfig

from sqlalchemy import Connection

from alembic import context
from app.core.config import Settings
from app.core.db import make_engine
from app.models import Base

config = context.config

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def get_url() -> str:
    return config.get_main_option("sqlalchemy.url") or Settings().database_url


def _configure(connection: Connection | None = None, url: str | None = None) -> None:
    context.configure(
        connection=connection,
        url=url,
        target_metadata=target_metadata,
        render_as_batch=True,  # ALTER TABLE support on SQLite
        compare_type=True,
        literal_binds=url is not None,
        dialect_opts={"paramstyle": "named"} if url is not None else {},
    )


def run_migrations_offline() -> None:
    _configure(url=get_url())
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:  # provided by tests
        _configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
        return

    engine = make_engine(get_url())
    with engine.connect() as conn:
        _configure(connection=conn)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
