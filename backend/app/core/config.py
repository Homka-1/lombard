"""Application settings loaded from environment variables / `.env`."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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
    upload_dir: str = "./uploads"

    # JWT (used from stage 4). Must be overridden outside development.
    secret_key: str = "change-me-in-production"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 14

    # Comma-separated in env: LOMBARD_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Region: Kazakhstan. All money is stored in tiyn (1 KZT = 100 tiyn), dates in UTC.
    currency: str = "KZT"
    timezone: str = "Asia/Almaty"


@lru_cache
def get_settings() -> Settings:
    return Settings()
