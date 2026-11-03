from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.deps import SessionDep, SettingsDep

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "error"]
    app: str
    version: str
    environment: str
    currency: str
    time: datetime


@router.get("/health", response_model=HealthResponse, summary="Проверка работоспособности")
def health(settings: SettingsDep, session: SessionDep) -> HealthResponse:
    try:
        session.execute(text("SELECT 1"))
        database: Literal["ok", "error"] = "ok"
    except SQLAlchemyError:
        database = "error"
    return HealthResponse(
        status="ok" if database == "ok" else "degraded",
        database=database,
        app=settings.app_name,
        version=settings.version,
        environment=settings.environment,
        currency=settings.currency,
        time=datetime.now(UTC),
    )
