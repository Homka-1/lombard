"""Password hashing (bcrypt) and JWT access/refresh tokens (PyJWT, HS256)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum

import bcrypt
import jwt

from app.core.config import Settings
from app.domain.enums import Role

# bcrypt only uses the first 72 bytes of the password.
_MAX_BCRYPT_BYTES = 72
# Work factor; tests lower it to keep the suite fast.
BCRYPT_ROUNDS = 12
JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    raw = password.encode("utf-8")[:_MAX_BCRYPT_BYTES]
    return bcrypt.hashpw(raw, bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    raw = password.encode("utf-8")[:_MAX_BCRYPT_BYTES]
    try:
        return bcrypt.checkpw(raw, password_hash.encode("ascii"))
    except ValueError:
        return False


# Compared against when the e-mail is unknown, so that login takes the same time
# whether or not the account exists (no user enumeration by timing).
_DUMMY_HASH = hash_password("timing-equaliser")


def verify_password_dummy(password: str) -> None:
    verify_password(password, _DUMMY_HASH)


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"


class TokenError(Exception):
    """Token is malformed, expired, signed with another key or of the wrong type."""


@dataclass(frozen=True)
class TokenPayload:
    user_id: int
    role: Role
    type: TokenType
    expires_at: datetime
    jti: str


def create_token(
    user_id: int,
    role: Role,
    token_type: TokenType,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> tuple[str, datetime]:
    """Return `(jwt, expires_at)`."""
    now = now or datetime.now(UTC)
    if token_type is TokenType.ACCESS:
        ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    else:
        ttl = timedelta(days=settings.refresh_token_ttl_days)
    expires_at = now + ttl
    claims = {
        "sub": str(user_id),
        "role": role.value,
        "type": token_type.value,
        "iss": settings.jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(claims, settings.secret_key, algorithm=JWT_ALGORITHM), expires_at


def decode_token(token: str, expected_type: TokenType, settings: Settings) -> TokenPayload:
    try:
        claims = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[JWT_ALGORITHM],
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "exp", "iat", "type", "role", "jti"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Срок действия токена истёк") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("Недействительный токен") from exc
    try:
        payload = TokenPayload(
            user_id=int(claims["sub"]),
            role=Role(claims["role"]),
            type=TokenType(claims["type"]),
            expires_at=datetime.fromtimestamp(claims["exp"], UTC),
            jti=str(claims["jti"]),
        )
    except (ValueError, TypeError) as exc:
        raise TokenError("Недействительный токен") from exc
    if payload.type is not expected_type:
        raise TokenError("Неверный тип токена")
    return payload
