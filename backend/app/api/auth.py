"""Registration, login (JSON + OAuth2 form for Swagger), token refresh, profile."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.deps import CurrentUser, SessionDep, SettingsDep, unauthorized
from app.core.security import (
    TokenError,
    TokenType,
    create_token,
    decode_token,
    hash_password,
    verify_password,
    verify_password_dummy,
)
from app.domain.enums import Role
from app.models import User
from app.models.base import utcnow
from app.schemas.auth import AuthResponse, LoginRequest, RefreshRequest, RegisterRequest, TokenPair
from app.schemas.user import PasswordChange, UserRead, UserUpdateMe

router = APIRouter(prefix="/auth", tags=["auth"])

INVALID_CREDENTIALS = "Неверный e-mail или пароль"


def issue_tokens(user: User, settings: Settings) -> TokenPair:
    access, access_exp = create_token(user.id, user.role, TokenType.ACCESS, settings)
    refresh, refresh_exp = create_token(user.id, user.role, TokenType.REFRESH, settings)
    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        access_expires_at=access_exp,
        refresh_expires_at=refresh_exp,
    )


def auth_response(user: User, settings: Settings) -> AuthResponse:
    pair = issue_tokens(user, settings)
    return AuthResponse(**pair.model_dump(), user=UserRead.model_validate(user))


def find_user_by_email(session: Session, email: str) -> User | None:
    return session.scalar(select(User).where(func.lower(User.email) == email.lower()))


def authenticate(session: Session, email: str, password: str) -> User:
    user = find_user_by_email(session, email)
    if user is None:
        verify_password_dummy(password)
        raise unauthorized(INVALID_CREDENTIALS)
    if not verify_password(password, user.password_hash):
        raise unauthorized(INVALID_CREDENTIALS)
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Учётная запись заблокирована")
    user.last_login_at = utcnow()
    session.commit()
    return user


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Регистрация клиента",
)
def register(data: RegisterRequest, session: SessionDep, settings: SettingsDep) -> AuthResponse:
    """Self-registration always creates a CLIENT; other roles are assigned by an admin."""
    if find_user_by_email(session, data.email) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким e-mail уже существует")
    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        city=data.city,
        role=Role.CLIENT,
        password_hash=hash_password(data.password),
        last_login_at=utcnow(),
    )
    session.add(user)
    session.commit()
    return auth_response(user, settings)


@router.post("/login", response_model=AuthResponse, summary="Вход (JSON)")
def login(data: LoginRequest, session: SessionDep, settings: SettingsDep) -> AuthResponse:
    user = authenticate(session, data.email, data.password)
    return auth_response(user, settings)


@router.post("/token", response_model=TokenPair, summary="Вход (OAuth2-форма для Swagger)")
def token(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: SessionDep,
    settings: SettingsDep,
) -> TokenPair:
    """Same as `/login`, but `application/x-www-form-urlencoded` (username = e-mail)."""
    user = authenticate(session, form.username, form.password)
    return issue_tokens(user, settings)


@router.post("/refresh", response_model=TokenPair, summary="Обновить пару токенов")
def refresh(data: RefreshRequest, session: SessionDep, settings: SettingsDep) -> TokenPair:
    try:
        payload = decode_token(data.refresh_token, TokenType.REFRESH, settings)
    except TokenError as exc:
        raise unauthorized(str(exc)) from exc
    user = session.get(User, payload.user_id)
    if user is None or not user.is_active:
        raise unauthorized("Учётная запись недоступна")
    # The role is re-read from the DB, so a role change applies on the next refresh.
    return issue_tokens(user, settings)


@router.get("/me", response_model=UserRead, summary="Текущий пользователь")
def me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserRead, summary="Изменить свой профиль")
def update_me(data: UserUpdateMe, user: CurrentUser, session: SessionDep) -> User:
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "full_name" and value is None:
            continue
        setattr(user, field, value)
    session.commit()
    return user


@router.post(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Сменить пароль",
)
def change_password(data: PasswordChange, user: CurrentUser, session: SessionDep) -> None:
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Текущий пароль указан неверно")
    user.password_hash = hash_password(data.new_password)
    session.commit()
