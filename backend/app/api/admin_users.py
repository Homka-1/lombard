"""Admin: list users, change role / activity. (Rest of the admin API — stage 8.)"""

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from app.core.deps import AdminUser, SessionDep
from app.domain.enums import Role
from app.models import User
from app.schemas.user import AdminUserUpdate, UserRead

router = APIRouter(prefix="/admin/users", tags=["admin"])


@router.get("", response_model=list[UserRead], summary="Пользователи")
def list_users(
    session: SessionDep,
    _admin: AdminUser,
    role: Role | None = None,
    q: str | None = Query(default=None, max_length=100, description="Поиск по имени/e-mail"),
) -> list[User]:
    stmt = select(User).order_by(User.id)
    if role is not None:
        stmt = stmt.where(User.role == role)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(User.email.ilike(like), User.full_name.ilike(like)))
    return list(session.scalars(stmt))


@router.patch("/{user_id}", response_model=UserRead, summary="Изменить роль/статус")
def update_user(user_id: int, data: AdminUserUpdate, session: SessionDep, admin: AdminUser) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    changes = data.model_dump(exclude_unset=True)
    if user.id == admin.id and (
        changes.get("is_active") is False or changes.get("role", Role.ADMIN) != Role.ADMIN
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Нельзя снять с себя роль администратора или заблокировать себя",
        )
    for field, value in changes.items():
        if value is not None or field == "city":
            setattr(user, field, value)
    session.commit()
    return user
