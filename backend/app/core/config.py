"""Application settings loaded from environment variables / `.env`."""

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.domain.logistics import SlotRules

DEFAULT_SECRET_KEY = "dev-insecure-secret-change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="LOMBARD_",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Ломбард онлайн"
    version: str = "0.1.0"
    environment: str = "development"
    debug: bool = False

    api_prefix: str = "/api"
    database_url: str = "sqlite:///./lombard.db"
    db_echo: bool = False
    upload_dir: str = "./uploads"

    # Photos of an application (stage 5).
    max_photos: int = 6
    max_photo_mb: int = 10
    photo_url_ttl_seconds: int = 3600

    # Expert offer (stage 6): how long the client has to accept it.
    offer_ttl_hours: int = 72

    # Courier slots (stage 7), local Kazakhstan time.
    courier_day_start_hour: int = 10
    courier_day_end_hour: int = 20
    courier_slot_hours: int = 2
    courier_lead_hours: int = 2
    courier_horizon_days: int = 7

    # JWT. The secret must be overridden outside development/test.
    secret_key: str = DEFAULT_SECRET_KEY
    jwt_issuer: str = "lombard"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 14

    # Comma-separated in env: LOMBARD_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Region: Kazakhstan. All money is stored in tiyn (1 KZT = 100 tiyn), dates in UTC.
    currency: str = "KZT"
    timezone: str = "Asia/Almaty"

    # Loan rules (stage 8): grace period after the due date before FORFEITED.
    grace_period_days: int = 30

    @property
    def max_photo_bytes(self) -> int:
        return self.max_photo_mb * 1024 * 1024

    @property
    def slot_rules(self) -> SlotRules:
        return SlotRules(
            day_start_hour=self.courier_day_start_hour,
            day_end_hour=self.courier_day_end_hour,
            slot_hours=self.courier_slot_hours,
            lead_hours=self.courier_lead_hours,
            horizon_days=self.courier_horizon_days,
        )

    @model_validator(mode="after")
    def _check_secret_key(self) -> "Settings":
        if self.environment not in {"development", "test"} and (
            self.secret_key == DEFAULT_SECRET_KEY or len(self.secret_key) < 32
        ):
            raise ValueError(
                "LOMBARD_SECRET_KEY must be set to a random string of 32+ characters "
                f"in environment {self.environment!r}"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
