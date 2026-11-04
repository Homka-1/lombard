"""Shared FastAPI dependencies: settings, DB session, current user, role checks."""

from collections.abc import Callable, Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import session_scope
from app.core.security import TokenError, TokenType, decode_token
from app.domain.enums import Role
from app.models import User
from app.services.clock import Clock
from app.services.payments import PaymentGateway
from app.services.photo_appraiser import PhotoAppraiser
from app.storage.photos import PhotoStorage, PhotoUrlSigner


def get_app_settings(request: Request) -> Settings:
    """Settings the running app was created with (overridable in tests)."""
    return request.app.state.settings


def get_db(request: Request) -> Iterator[Session]:
    """DB session bound to the engine the running app was created with."""
    yield from session_scope(request.app.state.session_factory)


def get_photo_storage(request: Request) -> PhotoStorage:
    return request.app.state.photo_storage


def get_photo_appraiser(request: Request) -> PhotoAppraiser:
    return request.app.state.photo_appraiser


def get_photo_signer(request: Request) -> PhotoUrlSigner:
    return request.app.state.photo_signer


def get_clock(request: Request) -> Clock:
    return request.app.state.clock


def get_payment_gateway(request: Request) -> PaymentGateway:
    return request.app.state.payment_gateway


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
SessionDep = Annotated[Session, Depends(get_db)]
PhotoStorageDep = Annotated[PhotoStorage, Depends(get_photo_storage)]
PhotoAppraiserDep = Annotated[PhotoAppraiser, Depends(get_photo_appraiser)]
PhotoSignerDep = Annotated[PhotoUrlSigner, Depends(get_photo_signer)]
ClockDep = Annotated[Clock, Depends(get_clock)]
PaymentGatewayDep = Annotated[PaymentGateway, Depends(get_payment_gateway)]

# Relative URL: Swagger UI at /api/docs resolves it to /api/auth/token.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token", auto_error=False)


def unauthorized(detail: str = "Требуется вход в систему") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    token: Annotated[str | None, Depends(oauth2_scheme)],
    session: SessionDep,
    settings: SettingsDep,
) -> User:
    if not token:
        raise unauthorized()
    try:
        payload = decode_token(token, TokenType.ACCESS, settings)
    except TokenError as exc:
        raise unauthorized(str(exc)) from exc
    user = session.get(User, payload.user_id)
    if user is None:
        raise unauthorized("Пользователь не найден")
    if not user.is_active:
        raise unauthorized("Учётная запись заблокирована")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*roles: Role) -> Callable[[User], User]:
    """Dependency: the current user must have one of `roles` (no implicit admin bypass).

    Usage: `user: Annotated[User, Depends(require_role(Role.EXPERT, Role.ADMIN))]`
    or `dependencies=[Depends(require_role(Role.ADMIN))]` on a router.
    """
    if not roles:
        raise ValueError("require_role() needs at least one role")
    allowed = frozenset(roles)

    def dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Недостаточно прав для этого действия",
            )
        return user

    dependency.__name__ = f"require_role_{'_'.join(r.value.lower() for r in roles)}"
    return dependency


ClientUser = Annotated[User, Depends(require_role(Role.CLIENT))]
ExpertUser = Annotated[User, Depends(require_role(Role.EXPERT, Role.ADMIN))]
CourierUser = Annotated[User, Depends(require_role(Role.COURIER, Role.ADMIN))]
AdminUser = Annotated[User, Depends(require_role(Role.ADMIN))]
# Who may read applications: the owner-client, experts and admins.
ApplicationReader = Annotated[User, Depends(require_role(Role.CLIENT, Role.EXPERT, Role.ADMIN))]
