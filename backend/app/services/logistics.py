"""Courier logistics: slots, booking a pickup, assigning couriers, courier steps.

Functions do not commit; the API layer commits.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.domain.enums import ApplicationStatus, CourierTaskKind, CourierTaskStatus, Role
from app.domain.logistics import (
    KZ_TZ,
    OPEN_TASK_STATUSES,
    STEP_LABELS,
    CourierStepError,
    Slot,
    SlotRules,
    bookable_slots,
    find_slot,
    step_result,
)
from app.domain.phone import format_kz_phone
from app.models import Application, CourierTask, StatusHistory, User
from app.models.base import utcnow
from app.services.errors import ConflictError, NotFoundError, Problem, ValidationProblems
from app.services.notifications import notify
from app.services.status import change_status

S = ApplicationStatus
T = CourierTaskStatus
TASK_NOT_FOUND = "Выезд не найден"


# --- Couriers and slots -------------------------------------------------------------------


def active_couriers(session: Session, city: str | None = None) -> list[User]:
    stmt = select(User).where(User.role == Role.COURIER, User.is_active.is_(True))
    if city is not None:
        stmt = stmt.where(User.city == city)
    return list(session.scalars(stmt.order_by(User.id)))


def served_cities(session: Session) -> list[tuple[str, int]]:
    """Cities with at least one active courier, with the number of couriers."""
    rows = session.execute(
        select(User.city, func.count(User.id))
        .where(User.role == Role.COURIER, User.is_active.is_(True), User.city.is_not(None))
        .group_by(User.city)
        .order_by(User.city)
    )
    return [(city, count) for city, count in rows]


def _busy_courier_ids(
    session: Session, start: datetime, end: datetime, exclude_task_id: int | None = None
) -> set[int]:
    """Couriers with a (non-cancelled) task overlapping [start, end)."""
    stmt = select(CourierTask.courier_id).where(
        CourierTask.courier_id.is_not(None),
        CourierTask.status != T.CANCELLED,
        CourierTask.slot_start < end,
        CourierTask.slot_end > start,
    )
    if exclude_task_id is not None:
        stmt = stmt.where(CourierTask.id != exclude_task_id)
    return {cid for cid in session.scalars(stmt) if cid is not None}


def open_task_counts(session: Session) -> dict[int, int]:
    """courier_id → number of open (not delivered/cancelled) tasks: the courier's load."""
    rows = session.execute(
        select(CourierTask.courier_id, func.count(CourierTask.id))
        .where(CourierTask.courier_id.is_not(None), CourierTask.status.in_(OPEN_TASK_STATUSES))
        .group_by(CourierTask.courier_id)
    )
    return {cid: count for cid, count in rows}


@dataclass(frozen=True)
class SlotAvailability:
    slot: Slot
    capacity: int  # active couriers in the city
    free: int  # of them, not busy in this slot


def slot_availability(
    session: Session, city: str, now: datetime, rules: SlotRules
) -> list[SlotAvailability]:
    couriers = {c.id for c in active_couriers(session, city)}
    result = []
    for slot in bookable_slots(now, rules):
        busy = _busy_courier_ids(session, slot.start, slot.end) & couriers
        result.append(SlotAvailability(slot, len(couriers), len(couriers) - len(busy)))
    return result


def pick_courier(
    session: Session, city: str, slot: Slot, exclude_task_id: int | None = None
) -> User | None:
    """Least loaded active courier of the city who is free in the slot (ties → lowest id)."""
    busy = _busy_courier_ids(session, slot.start, slot.end, exclude_task_id)
    candidates = [c for c in active_couriers(session, city) if c.id not in busy]
    if not candidates:
        return None
    load = open_task_counts(session)
    return min(candidates, key=lambda c: (load.get(c.id, 0), c.id))


# --- Booking ------------------------------------------------------------------------------


@dataclass(frozen=True)
class VisitInput:
    city: str
    address: str
    contact_phone: str  # E.164
    slot_start: datetime
    comment: str | None = None


def _validate_visit(session: Session, data: VisitInput, now: datetime, rules: SlotRules) -> Slot:
    problems: list[Problem] = []
    if data.city not in {c for c, _ in served_cities(session)}:
        problems.append(Problem("city", "В этом городе курьерская служба пока не работает"))
    slot = find_slot(data.slot_start, now, rules)
    if slot is None:
        problems.append(Problem("slot_start", "Выберите время из списка доступных слотов"))
    if problems or slot is None:
        raise ValidationProblems(problems, "Проверьте данные для вызова курьера")
    return slot


def _courier_text(courier: User) -> str:
    phone = f", {format_kz_phone(courier.phone)}" if courier.phone else ""
    return f"{courier.full_name}{phone}"


def current_task(app: Application, kind: CourierTaskKind | None = None) -> CourierTask | None:
    """The latest non-cancelled courier task of the application."""
    tasks = [
        t
        for t in app.courier_tasks
        if t.status is not T.CANCELLED and (kind is None or t.kind is kind)
    ]
    return max(tasks, key=lambda t: (t.created_at, t.id)) if tasks else None


def book_visit(
    session: Session,
    app: Application,
    kind: CourierTaskKind,
    data: VisitInput,
    *,
    now: datetime,
    rules: SlotRules,
) -> CourierTask:
    """Create a courier task for the slot and auto-assign the least loaded free courier."""
    slot = _validate_visit(session, data, now, rules)
    courier = pick_courier(session, data.city, slot)
    if courier is None:
        raise ConflictError("Все курьеры в это время заняты — выберите другой слот")
    task = CourierTask(
        kind=kind,
        status=T.SCHEDULED,
        courier=courier,
        city=data.city,
        address=data.address,
        contact_phone=data.contact_phone,
        slot_start=slot.start,
        slot_end=slot.end,
        comment=data.comment,
    )
    app.courier_tasks.append(task)
    session.add(task)
    notify(
        session,
        courier.id,
        f"Новый выезд: {app.number}",
        f"{'Забрать изделие' if kind is CourierTaskKind.PICKUP else 'Вернуть изделие'} — "
        f"{data.city}, {data.address}; {slot.label}.",
        application=app,
    )
    return task


def schedule_pickup(
    session: Session,
    app: Application,
    user: User,
    data: VisitInput,
    *,
    now: datetime | None = None,
    rules: SlotRules,
) -> CourierTask:
    """OFFER_ACCEPTED → COURIER_SCHEDULED: book a slot and assign a courier."""
    now = now or utcnow()
    if app.status is not S.OFFER_ACCEPTED:
        raise ConflictError("Вызвать курьера можно только после принятия предложения")
    task = book_visit(session, app, CourierTaskKind.PICKUP, data, now=now, rules=rules)
    slot_text = Slot(task.slot_start, task.slot_end).label
    change_status(
        session, app, S.COURIER_SCHEDULED, user=user, comment=f"Курьер вызван на {slot_text}"
    )
    assert task.courier is not None
    notify(
        session,
        app.client_id,
        f"Курьер назначен по заявке {app.number}",
        f"Курьер приедет {slot_text} по адресу: {data.city}, {data.address}. "
        f"Курьер: {_courier_text(task.courier)}.",
        application=app,
    )
    session.flush()
    return task


def reschedule_pickup(
    session: Session,
    app: Application,
    user: User,
    data: VisitInput,
    *,
    now: datetime | None = None,
    rules: SlotRules,
) -> CourierTask:
    """Change the slot / address while the courier has not left yet."""
    now = now or utcnow()
    task = current_task(app, CourierTaskKind.PICKUP)
    if app.status is not S.COURIER_SCHEDULED or task is None or task.status is not T.SCHEDULED:
        raise ConflictError("Перенести визит можно, только пока курьер не выехал")
    slot = _validate_visit(session, data, now, rules)
    courier = task.courier
    same_city = courier is not None and courier.city == data.city and courier.is_active
    if (
        not same_city
        or courier is None
        or courier.id in _busy_courier_ids(session, slot.start, slot.end, exclude_task_id=task.id)
    ):
        courier = pick_courier(session, data.city, slot, exclude_task_id=task.id)
    if courier is None:
        raise ConflictError("Все курьеры в это время заняты — выберите другой слот")
    previous = task.courier_id
    task.courier = courier
    task.city, task.address = data.city, data.address
    task.contact_phone, task.comment = data.contact_phone, data.comment
    task.slot_start, task.slot_end = slot.start, slot.end
    # Same status, but the move is worth a line in the timeline.
    entry = StatusHistory(
        from_status=app.status,
        to_status=app.status,
        actor_id=user.id,
        actor_role=user.role,
        comment=f"Визит перенесён на {slot.label}",
    )
    app.history.append(entry)
    session.add(entry)
    notify(
        session,
        app.client_id,
        f"Визит курьера перенесён: {app.number}",
        f"Новое время: {slot.label}, {data.city}, {data.address}. "
        f"Курьер: {_courier_text(courier)}.",
        application=app,
    )
    notify(
        session,
        courier.id,
        f"Выезд {app.number}: {slot.label}",
        f"{data.city}, {data.address}.",
        application=app,
    )
    if previous is not None and previous != courier.id:
        notify(
            session,
            previous,
            f"Выезд {app.number} передан другому курьеру",
            "Клиент перенёс визит.",
            application=app,
        )
    session.flush()
    return task


# --- Courier tasks ------------------------------------------------------------------------


def _task_options():  # type: ignore[no-untyped-def]
    return (
        selectinload(CourierTask.application).selectinload(Application.client),
        selectinload(CourierTask.application).selectinload(Application.category),
        selectinload(CourierTask.courier),
    )


class TaskScope(StrEnum):
    DAY = "day"  # tasks of a calendar day (default: today), any status
    ACTIVE = "active"  # not delivered / cancelled yet
    DONE = "done"  # delivered or cancelled, newest first
    ALL = "all"


def list_tasks(
    session: Session,
    user: User,
    scope: TaskScope = TaskScope.ACTIVE,
    *,
    day: date | None = None,
    courier_id: int | None = None,
    unassigned: bool = False,
    now: datetime | None = None,
) -> list[CourierTask]:
    """Courier: own tasks. Admin: all tasks, optionally of one courier or unassigned only."""
    stmt = select(CourierTask).options(*_task_options())
    if user.role is Role.COURIER:
        stmt = stmt.where(CourierTask.courier_id == user.id)
    elif unassigned:
        stmt = stmt.where(CourierTask.courier_id.is_(None))
    elif courier_id is not None:
        stmt = stmt.where(CourierTask.courier_id == courier_id)

    if scope is TaskScope.DAY:
        day = day or (now or utcnow()).astimezone(KZ_TZ).date()
        start = datetime(day.year, day.month, day.day, tzinfo=KZ_TZ)
        stmt = stmt.where(
            CourierTask.slot_start >= start,
            CourierTask.slot_start < start + timedelta(days=1),
            CourierTask.status != T.CANCELLED,
        )
    elif scope is TaskScope.ACTIVE:
        stmt = stmt.where(CourierTask.status.in_(OPEN_TASK_STATUSES))
    elif scope is TaskScope.DONE:
        stmt = stmt.where(CourierTask.status.in_({T.DELIVERED, T.CANCELLED}))

    if scope is TaskScope.DONE:
        stmt = stmt.order_by(CourierTask.slot_start.desc(), CourierTask.id.desc())
    else:
        stmt = stmt.order_by(CourierTask.slot_start.asc(), CourierTask.id.asc())
    return list(session.scalars(stmt))


def get_task(session: Session, task_id: int, user: User) -> CourierTask:
    """Courier: only own tasks (others look missing). Admin: any."""
    task = session.scalar(
        select(CourierTask).where(CourierTask.id == task_id).options(*_task_options())
    )
    if task is None or (user.role is Role.COURIER and task.courier_id != user.id):
        raise NotFoundError(TASK_NOT_FOUND)
    if user.role not in (Role.COURIER, Role.ADMIN):
        raise NotFoundError(TASK_NOT_FOUND)
    return task


_STEP_NOTES = {
    (CourierTaskKind.PICKUP, "start"): (
        "Курьер выехал",
        "Курьер {courier} уже в пути. Подготовьте изделие и документ, удостоверяющий личность.",
    ),
    (CourierTaskKind.PICKUP, "pick_up"): (
        "Курьер забрал изделие",
        "Изделие опечатано и едет в ломбард. После доставки эксперт проведёт осмотр.",
    ),
    (CourierTaskKind.PICKUP, "deliver"): (
        "Изделие в ломбарде",
        "Изделие доставлено. Эксперт осмотрит его и подтвердит сумму займа.",
    ),
    (CourierTaskKind.RETURN, "start"): (
        "Курьер везёт изделие",
        "Курьер {courier} выехал, чтобы вернуть изделие.",
    ),
    (CourierTaskKind.RETURN, "deliver"): (
        "Изделие возвращено",
        "Курьер передал вам изделие. Спасибо, что воспользовались ломбардом!",
    ),
}


def courier_step(
    session: Session, task: CourierTask, courier: User, step: str, now: datetime | None = None
) -> CourierTask:
    """Advance the courier's own task by one step; moves the application accordingly."""
    now = now or utcnow()
    if task.courier_id != courier.id:
        raise NotFoundError(TASK_NOT_FOUND)
    try:
        new_status, app_status = step_result(task.kind, step, task.status)
    except CourierStepError as exc:
        raise ConflictError(str(exc)) from exc

    app = task.application
    if app_status is not None:
        change_status(session, app, app_status, user=courier, comment=STEP_LABELS[step])
    task.status = new_status
    if new_status is T.DELIVERED:
        task.completed_at = now

    title, body = _STEP_NOTES[(task.kind, step)]
    notify(
        session,
        app.client_id,
        f"{title}: {app.number}",
        body.format(courier=courier.full_name),
        application=app,
    )
    if (
        task.kind is CourierTaskKind.PICKUP
        and new_status is T.DELIVERED
        and app.expert_id is not None
    ):
        notify(
            session,
            app.expert_id,
            f"Нужен осмотр: {app.number}",
            "Изделие доставлено в ломбард и ждёт осмотра.",
            application=app,
        )
    session.flush()
    return task


def assign_courier(session: Session, task: CourierTask, courier: User, admin: User) -> CourierTask:
    """Admin reassigns an open task to another active courier who is free in that slot."""
    if task.status not in OPEN_TASK_STATUSES:
        raise ConflictError("Выезд уже завершён")
    if task.status is not T.SCHEDULED and task.courier_id is not None:
        raise ConflictError("Курьер уже выехал — переназначить нельзя")
    if courier.role is not Role.COURIER or not courier.is_active:
        raise ValidationProblems([Problem("courier_id", "Выберите активного курьера")])
    if task.courier_id == courier.id:
        return task
    if courier.id in _busy_courier_ids(session, task.slot_start, task.slot_end, task.id):
        raise ConflictError(f"{courier.full_name} уже занят(а) в это время")
    previous = task.courier_id
    task.courier = courier
    app = task.application
    slot = Slot(task.slot_start, task.slot_end)
    notify(
        session,
        courier.id,
        f"Новый выезд: {app.number}",
        f"Назначил администратор {admin.full_name}: {task.city}, {task.address}; {slot.label}.",
        application=app,
    )
    if previous is not None:
        notify(
            session,
            previous,
            f"Выезд {app.number} передан другому курьеру",
            f"Переназначил администратор {admin.full_name}.",
            application=app,
        )
    notify(
        session,
        app.client_id,
        f"Сменился курьер по заявке {app.number}",
        f"Курьер: {_courier_text(courier)}. Время прежнее: {slot.label}.",
        application=app,
    )
    session.flush()
    return task
