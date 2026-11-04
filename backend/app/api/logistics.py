"""Courier logistics: delivery slots, calling a courier, courier workspace, assignment."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.applications import CardViewDep
from app.core.deps import (
    AdminUser,
    ClockDep,
    CurrentUser,
    SessionDep,
    SettingsDep,
    require_role,
)
from app.domain.enums import CourierTaskStatus, Role
from app.domain.logistics import (
    TASK_KIND_LABELS,
    TASK_STATUS_LABELS,
    CourierStep,
    Slot,
    next_steps,
)
from app.domain.phone import format_kz_phone
from app.domain.state_machine import STATUS_LABELS
from app.models import CourierTask, User
from app.schemas.application import ApplicationRead
from app.schemas.logistics import (
    AssignCourierBody,
    CityRead,
    CourierLoadRead,
    CourierTaskRead,
    SlotRead,
    TaskApplicationBrief,
    VisitCreate,
)
from app.schemas.offer import UserBrief
from app.services import applications as svc
from app.services import logistics
from app.services.errors import NotFoundError, Problem, ValidationProblems

# --- Serialisation ------------------------------------------------------------------------


def task_actions(task: CourierTask, viewer: User) -> list[str]:
    if viewer.role is Role.COURIER and task.courier_id == viewer.id:
        return next_steps(task.kind, task.status)
    if viewer.role is Role.ADMIN and (
        task.status is CourierTaskStatus.SCHEDULED
        or (task.courier_id is None and task.status in logistics.OPEN_TASK_STATUSES)
    ):
        return ["assign"]
    return []


def task_read(task: CourierTask, viewer: User) -> CourierTaskRead:
    app = task.application
    return CourierTaskRead(
        id=task.id,
        kind=task.kind,
        kind_label=TASK_KIND_LABELS[task.kind],
        status=task.status,
        status_label=TASK_STATUS_LABELS[task.status],
        application=TaskApplicationBrief(
            id=app.id,
            number=app.number,
            title=app.title,
            category_name=app.category.name,
            status=app.status,
            status_label=STATUS_LABELS[app.status],
        ),
        client=UserBrief.model_validate(app.client),
        courier=UserBrief.model_validate(task.courier) if task.courier else None,
        city=task.city,
        address=task.address,
        contact_phone=task.contact_phone,
        contact_phone_display=format_kz_phone(task.contact_phone),
        slot_start=task.slot_start,
        slot_end=task.slot_end,
        slot_label=Slot(task.slot_start, task.slot_end).label,
        comment=task.comment,
        completed_at=task.completed_at,
        created_at=task.created_at,
        updated_at=task.updated_at,
        actions=task_actions(task, viewer),
    )


# --- Delivery slots (any signed-in user) --------------------------------------------------

delivery_router = APIRouter(prefix="/delivery", tags=["logistics"])


@delivery_router.get(
    "/cities", response_model=list[CityRead], summary="Города, где работают курьеры"
)
def get_cities(session: SessionDep, _user: CurrentUser) -> list[CityRead]:
    return [CityRead(city=c, couriers=n) for c, n in logistics.served_cities(session)]


@delivery_router.get(
    "/slots",
    response_model=list[SlotRead],
    summary="Слоты визита курьера (время Казахстана, UTC+5) на ближайшие дни",
)
def get_slots(
    session: SessionDep,
    _user: CurrentUser,
    settings: SettingsDep,
    clock: ClockDep,
    city: Annotated[str, Query(min_length=2, max_length=100)],
) -> list[SlotRead]:
    if city not in {c for c, _ in logistics.served_cities(session)}:
        raise ValidationProblems(
            [Problem("city", "В этом городе курьерская служба пока не работает")],
            "Проверьте город",
        )
    return [
        SlotRead(
            start=a.slot.start,
            end=a.slot.end,
            date=a.slot.local_date,
            label=a.slot.label,
            capacity=a.capacity,
            free=a.free,
            available=a.free > 0,
        )
        for a in logistics.slot_availability(session, city, clock.now(), settings.slot_rules)
    ]


# --- Calling a courier (client or admin) --------------------------------------------------

visit_router = APIRouter(prefix="/applications", tags=["logistics"])
ClientOrAdmin = Annotated[User, Depends(require_role(Role.CLIENT, Role.ADMIN))]


def visit_input(data: VisitCreate, client: User) -> logistics.VisitInput:
    phone = data.contact_phone or client.phone
    if not phone:
        raise ValidationProblems(
            [Problem("contact_phone", "Укажите телефон для связи с курьером")],
            "Проверьте данные для вызова курьера",
        )
    return logistics.VisitInput(
        city=data.city,
        address=data.address,
        contact_phone=phone,
        slot_start=data.slot_start,
        comment=data.comment,
    )


@visit_router.post(
    "/{application_id}/courier",
    response_model=ApplicationRead,
    summary="Вызвать курьера: слот, адрес, телефон (после принятия предложения)",
    responses={409: {"description": "Статус не позволяет или слот занят"}},
)
def schedule_courier(
    application_id: int,
    data: VisitCreate,
    session: SessionDep,
    card: CardViewDep,
    user: ClientOrAdmin,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    logistics.schedule_pickup(
        session, app, user, visit_input(data, app.client), now=card.now, rules=settings.slot_rules
    )
    session.commit()
    return card(app, user)


@visit_router.put(
    "/{application_id}/courier",
    response_model=ApplicationRead,
    summary="Перенести визит курьера (пока курьер не выехал)",
)
def reschedule_courier(
    application_id: int,
    data: VisitCreate,
    session: SessionDep,
    card: CardViewDep,
    user: ClientOrAdmin,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    logistics.reschedule_pickup(
        session, app, user, visit_input(data, app.client), now=card.now, rules=settings.slot_rules
    )
    session.commit()
    return card(app, user)


# --- Courier workspace --------------------------------------------------------------------

courier_router = APIRouter(prefix="/courier", tags=["courier"])
CourierOnly = Annotated[User, Depends(require_role(Role.COURIER))]
CourierOrAdmin = Annotated[User, Depends(require_role(Role.COURIER, Role.ADMIN))]


@courier_router.get(
    "/tasks",
    response_model=list[CourierTaskRead],
    summary="Выезды: day — на день (по умолчанию сегодня), active — незавершённые, done, all",
)
def get_tasks(
    session: SessionDep,
    user: CourierOrAdmin,
    scope: Annotated[logistics.TaskScope, Query()] = logistics.TaskScope.DAY,
    day: Annotated[date | None, Query(description="Дата для scope=day")] = None,
) -> list[CourierTaskRead]:
    tasks = logistics.list_tasks(session, user, scope, day=day)
    return [task_read(t, user) for t in tasks]


@courier_router.get("/tasks/{task_id}", response_model=CourierTaskRead, summary="Выезд")
def get_task(task_id: int, session: SessionDep, user: CourierOrAdmin) -> CourierTaskRead:
    return task_read(logistics.get_task(session, task_id, user), user)


def _step(task_id: int, step: str, session: Session, user: User) -> CourierTaskRead:
    task = logistics.get_task(session, task_id, user)
    logistics.courier_step(session, task, user, step)
    session.commit()
    return task_read(task, user)


@courier_router.post("/tasks/{task_id}/start", response_model=CourierTaskRead, summary="«Выехал»")
def start(task_id: int, session: SessionDep, user: CourierOnly) -> CourierTaskRead:
    return _step(task_id, CourierStep.START, session, user)


@courier_router.post(
    "/tasks/{task_id}/pick-up", response_model=CourierTaskRead, summary="«Забрал изделие»"
)
def pick_up(task_id: int, session: SessionDep, user: CourierOnly) -> CourierTaskRead:
    return _step(task_id, CourierStep.PICK_UP, session, user)


@courier_router.post(
    "/tasks/{task_id}/deliver",
    response_model=CourierTaskRead,
    summary="«Доставил»: в ломбард (забор) или клиенту (возврат)",
)
def deliver(task_id: int, session: SessionDep, user: CourierOnly) -> CourierTaskRead:
    return _step(task_id, CourierStep.DELIVER, session, user)


# --- Admin: couriers and assignment -------------------------------------------------------

admin_router = APIRouter(prefix="/admin", tags=["admin"])


@admin_router.get(
    "/couriers", response_model=list[CourierLoadRead], summary="Курьеры и их загрузка"
)
def get_couriers(
    session: SessionDep,
    _admin: AdminUser,
    city: str | None = None,
) -> list[CourierLoadRead]:
    load = logistics.open_task_counts(session)
    today = logistics.list_tasks(session, _admin, logistics.TaskScope.DAY)
    today_counts: dict[int, int] = {}
    for t in today:
        if t.courier_id is not None:
            today_counts[t.courier_id] = today_counts.get(t.courier_id, 0) + 1
    return [
        CourierLoadRead(
            courier=UserBrief.model_validate(c),
            open_tasks=load.get(c.id, 0),
            today_tasks=today_counts.get(c.id, 0),
        )
        for c in logistics.active_couriers(session, city)
    ]


@admin_router.get(
    "/courier-tasks",
    response_model=list[CourierTaskRead],
    summary="Все выезды (фильтры: курьер, без курьера, период)",
)
def get_all_tasks(
    session: SessionDep,
    admin: AdminUser,
    scope: Annotated[logistics.TaskScope, Query()] = logistics.TaskScope.ACTIVE,
    day: date | None = None,
    courier_id: int | None = None,
    unassigned: bool = False,
) -> list[CourierTaskRead]:
    tasks = logistics.list_tasks(
        session, admin, scope, day=day, courier_id=courier_id, unassigned=unassigned
    )
    return [task_read(t, admin) for t in tasks]


@admin_router.post(
    "/courier-tasks/{task_id}/assign",
    response_model=CourierTaskRead,
    summary="Назначить (переназначить) курьера",
)
def assign(
    task_id: int, data: AssignCourierBody, session: SessionDep, admin: AdminUser
) -> CourierTaskRead:
    task = logistics.get_task(session, task_id, admin)
    courier = session.get(User, data.courier_id)
    if courier is None:
        raise NotFoundError("Курьер не найден")
    logistics.assign_courier(session, task, courier, admin)
    session.commit()
    return task_read(task, admin)
