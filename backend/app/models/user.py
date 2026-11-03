from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import Role
from app.models.base import Base, IdMixin, TimestampMixin, UTCDateTime, str_enum

if TYPE_CHECKING:
    from app.models.application import Application
    from app.models.notification import Notification


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32))  # E.164: +77011234567
    full_name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(str_enum(Role), default=Role.CLIENT, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    city: Mapped[str | None] = mapped_column(String(100))  # couriers: service city
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    applications: Mapped[list["Application"]] = relationship(
        back_populates="client", foreign_keys="Application.client_id"
    )
    notifications: Mapped[list["Notification"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User {self.id} {self.email} {self.role}>"
