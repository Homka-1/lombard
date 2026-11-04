from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, computed_field, field_validator

from app.domain.enums import Role
from app.domain.phone import PhoneError, format_kz_phone, normalize_kz_phone

PASSWORD_MIN = 8
PASSWORD_MAX = 128


def validate_password(value: str) -> str:
    if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
        raise ValueError("Пароль должен содержать хотя бы одну букву и одну цифру")
    return value


def validate_phone(value: str | None) -> str | None:
    if value is None or value.strip() == "":
        return None
    try:
        return normalize_kz_phone(value)
    except PhoneError as exc:
        raise ValueError(str(exc)) from exc


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    phone: str | None
    role: Role
    is_active: bool
    city: str | None
    created_at: datetime
    last_login_at: datetime | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def phone_display(self) -> str | None:
        return format_kz_phone(self.phone) if self.phone else None


class UserUpdateMe(BaseModel):
    """Fields a user may change in their own profile."""

    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    phone: str | None = None
    city: str | None = Field(default=None, max_length=100)

    _phone = field_validator("phone")(validate_phone)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)

    _password = field_validator("new_password")(validate_password)


class AdminUserUpdate(BaseModel):
    role: Role | None = None
    is_active: bool | None = None
    city: str | None = Field(default=None, max_length=100)
