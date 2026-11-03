from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.deps import SettingsDep

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: str
    app: str
    version: str
    environment: str
    currency: str
    time: datetime


@router.get("/health", response_model=HealthResponse, summary="Проверка работоспособности")
def health(settings: SettingsDep) -> HealthResponse:
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        version=settings.version,
        environment=settings.environment,
        currency=settings.currency,
        time=datetime.now(UTC),
    )
