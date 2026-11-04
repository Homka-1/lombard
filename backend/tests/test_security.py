from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.config import Settings
from app.core.security import TokenError, TokenType, create_token, decode_token
from app.domain.enums import Role


@pytest.fixture
def cfg() -> Settings:
    return Settings(_env_file=None, environment="test", secret_key="x" * 40)


def test_roundtrip(cfg):
    token, exp = create_token(7, Role.EXPERT, TokenType.ACCESS, cfg)
    payload = decode_token(token, TokenType.ACCESS, cfg)
    assert payload.user_id == 7
    assert payload.role is Role.EXPERT
    assert payload.expires_at == exp.replace(microsecond=0)


def test_access_ttl_from_settings(cfg):
    now = datetime(2026, 11, 4, 10, 0, tzinfo=UTC)
    _, exp = create_token(1, Role.CLIENT, TokenType.ACCESS, cfg, now=now)
    assert exp - now == timedelta(minutes=cfg.access_token_ttl_minutes)
    _, rexp = create_token(1, Role.CLIENT, TokenType.REFRESH, cfg, now=now)
    assert rexp - now == timedelta(days=cfg.refresh_token_ttl_days)


def test_wrong_type_rejected(cfg):
    refresh, _ = create_token(1, Role.CLIENT, TokenType.REFRESH, cfg)
    with pytest.raises(TokenError, match="тип"):
        decode_token(refresh, TokenType.ACCESS, cfg)


def test_expired_rejected(cfg):
    past = datetime.now(UTC) - timedelta(hours=2)
    token, _ = create_token(1, Role.CLIENT, TokenType.ACCESS, cfg, now=past)
    with pytest.raises(TokenError, match="истёк"):
        decode_token(token, TokenType.ACCESS, cfg)


def test_foreign_signature_rejected(cfg):
    other = Settings(_env_file=None, environment="test", secret_key="y" * 40)
    token, _ = create_token(1, Role.ADMIN, TokenType.ACCESS, other)
    with pytest.raises(TokenError):
        decode_token(token, TokenType.ACCESS, cfg)


def test_alg_none_rejected(cfg):
    token = jwt.encode(
        {
            "sub": "1",
            "role": "ADMIN",
            "type": "access",
            "iss": "lombard",
            "iat": 0,
            "exp": 4102444800,
            "jti": "x",
        },
        key=None,
        algorithm="none",
    )
    with pytest.raises(TokenError):
        decode_token(token, TokenType.ACCESS, cfg)


def test_default_secret_forbidden_in_production():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(_env_file=None, environment="production")
    Settings(_env_file=None, environment="production", secret_key="s" * 48)
