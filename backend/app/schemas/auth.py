from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.user import (
    PASSWORD_MAX,
    PASSWORD_MIN,
    UserRead,
    validate_password,
    validate_phone,
)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    full_name: str = Field(min_length=2, max_length=255)
    phone: str | None = Field(default=None, examples=["+7 701 123-45-67"])
    city: str | None = Field(default=None, max_length=100, examples=["Алматы"])

    _password = field_validator("password")(validate_password)
    _phone = field_validator("phone")(validate_phone)

    @field_validator("email")
    @classmethod
    def _lower_email(cls, value: str) -> str:
        return value.lower()

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Укажите имя")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=PASSWORD_MAX)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    access_expires_at: datetime
    refresh_expires_at: datetime


class AuthResponse(TokenPair):
    user: UserRead
