"""Apply state-machine transitions to applications and record history."""

from sqlalchemy.orm import Session

from app.domain.enums import Actor, ApplicationStatus
from app.domain.state_machine import ensure_transition
from app.models import Application, StatusHistory, User
from app.models.base import utcnow


def change_status(
    session: Session,
    application: Application,
    target: ApplicationStatus,
    *,
    user: User | None = None,
    comment: str | None = None,
) -> StatusHistory:
    """Move `application` to `target` on behalf of `user` (None = system).

    Raises `TransitionError` subclasses from the state machine. Does not commit.
    """
    actor = Actor.from_role(user.role) if user is not None else Actor.SYSTEM
    current = application.status
    ensure_transition(current, target, actor)

    application.status = target
    if target is ApplicationStatus.SUBMITTED and application.submitted_at is None:
        application.submitted_at = utcnow()
    entry = StatusHistory(
        from_status=current,
        to_status=target,
        actor_id=user.id if user is not None else None,
        actor_role=user.role if user is not None else None,
        comment=comment,
    )
    application.history.append(entry)
    session.add(entry)
    return entry


def record_created(session: Session, application: Application, user: User) -> StatusHistory:
    """First history entry for a freshly created (DRAFT) application."""
    entry = StatusHistory(
        from_status=None,
        to_status=application.status,
        actor_id=user.id,
        actor_role=user.role,
        comment="Заявка создана",
    )
    application.history.append(entry)
    session.add(entry)
    return entry
