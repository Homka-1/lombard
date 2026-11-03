"""Shared FastAPI dependencies."""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import session_scope


def get_app_settings(request: Request) -> Settings:
    """Settings the running app was created with (overridable in tests)."""
    return request.app.state.settings


def get_db(request: Request) -> Iterator[Session]:
    """DB session bound to the engine the running app was created with."""
    yield from session_scope(request.app.state.session_factory)


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
SessionDep = Annotated[Session, Depends(get_db)]
