"""Admin: reference data, staff accounts, statistics, background jobs, time travel, outbox."""

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import select

from app.core.deps import AdminUser, ClockDep, SessionDep, SettingsDep
from app.core.security import hash_password
from app.domain.enums import Metal, NotificationChannel
from app.models import Category, MetalPrice, User
from app.schemas.admin import (
    AdminCategoryRead,
    CategoryCreate,
    CategoryUpdate,
    MetalPriceCreate,
    MetalPriceRead,
    StaffCreate,
)
from app.schemas.loan import (
    ClockAdvance,
    ClockAdvanceResult,
    ClockRead,
    FunnelRead,
    JobsResult,
    OutboxItem,
    StatsRead,
)
from app.schemas.offer import UserBrief
from app.schemas.user import UserRead
from app.services import loans, review, stats
from app.services.catalog import current_metal_prices
from app.services.clock import Clock
from app.services.errors import ConflictError, NotFoundError, Problem, ValidationProblems
from app.services.notifications import outbox

router = APIRouter(prefix="/admin", tags=["admin"])


# --- Categories ---------------------------------------------------------------------------


@router.get("/categories", response_model=list[AdminCategoryRead], summary="Категории (все)")
def list_categories(session: SessionDep, _admin: AdminUser) -> list[Category]:
    return list(session.scalars(select(Category).order_by(Category.sort_order, Category.id)))


@router.post(
    "/categories",
    response_model=AdminCategoryRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить категорию",
)
def create_category(data: CategoryCreate, session: SessionDep, _admin: AdminUser) -> Category:
    if session.scalar(select(Category.id).where(Category.code == data.code)):
        raise ConflictError("Категория с таким кодом уже есть")
    category = Category(**data.model_dump(), is_active=True)
    session.add(category)
    session.commit()
    return category


@router.patch(
    "/categories/{category_id}",
    response_model=AdminCategoryRead,
    summary="Изменить LTV, ставку, сроки, активность",
)
def update_category(
    category_id: int, data: CategoryUpdate, session: SessionDep, _admin: AdminUser
) -> Category:
    category = session.get(Category, category_id)
    if category is None:
        raise NotFoundError("Категория не найдена")
    changes = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    tmin = changes.get("min_term_days", category.min_term_days)
    tmax = changes.get("max_term_days", category.max_term_days)
    if tmax < tmin:
        raise ValidationProblems(
            [Problem("max_term_days", "Максимальный срок меньше минимального")],
            "Проверьте условия категории",
        )
    for field, value in changes.items():
        setattr(category, field, value)
    session.commit()
    return category


# --- Metal prices -------------------------------------------------------------------------


@router.get(
    "/metal-prices",
    response_model=list[MetalPriceRead],
    summary="История цен металлов (новые сверху)",
)
def list_metal_prices(
    session: SessionDep, _admin: AdminUser, clock: ClockDep, metal: Metal | None = None
) -> list[MetalPriceRead]:
    stmt = select(MetalPrice).order_by(MetalPrice.effective_from.desc(), MetalPrice.id.desc())
    if metal is not None:
        stmt = stmt.where(MetalPrice.metal == metal)
    current = {p.id for p in current_metal_prices(session, clock.now()).values()}
    return [
        MetalPriceRead.model_validate(p).model_copy(update={"is_current": p.id in current})
        for p in session.scalars(stmt)
    ]


@router.post(
    "/metal-prices",
    response_model=MetalPriceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Новая цена металла (действует с effective_from)",
)
def create_metal_price(
    data: MetalPriceCreate, session: SessionDep, _admin: AdminUser, clock: ClockDep
) -> MetalPriceRead:
    effective = data.effective_from or clock.now()
    exists = session.scalar(
        select(MetalPrice.id).where(
            MetalPrice.metal == data.metal, MetalPrice.effective_from == effective
        )
    )
    if exists:
        raise ConflictError("Цена на это время уже задана")
    price = MetalPrice(
        metal=data.metal,
        price_per_gram=data.price_per_gram,
        effective_from=effective,
        source=data.source,
    )
    session.add(price)
    session.commit()
    current = current_metal_prices(session, clock.now()).get(data.metal)
    return MetalPriceRead.model_validate(price).model_copy(
        update={"is_current": current is not None and current.id == price.id}
    )


# --- Staff --------------------------------------------------------------------------------


@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Создать сотрудника (эксперт, курьер, админ) или клиента",
)
def create_user(data: StaffCreate, session: SessionDep, _admin: AdminUser) -> User:
    if session.scalar(select(User.id).where(User.email == data.email)):
        raise ConflictError("Пользователь с таким e-mail уже существует")
    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        city=data.city,
        role=data.role,
        password_hash=hash_password(data.password),
    )
    session.add(user)
    session.commit()
    return user


# --- Statistics ---------------------------------------------------------------------------


@router.get("/stats", response_model=StatsRead, summary="Дашборд: заявки, займы, деньги, курьеры")
def get_stats(
    session: SessionDep, _admin: AdminUser, settings: SettingsDep, clock: ClockDep
) -> StatsRead:
    now = clock.now()
    st = stats.collect(session, now, settings.grace_period_days)
    return StatsRead(
        now=now,
        applications_total=st.applications_total,
        by_status=st.by_status,
        funnel=FunnelRead(**st.funnel),
        loans_active=st.loans_active,
        loans_overdue=st.loans_overdue,
        loans_repaid=st.loans_repaid,
        loans_forfeited=st.loans_forfeited,
        loans_due_soon=st.due_soon,
        portfolio_principal=st.portfolio_principal,
        accrued_interest=st.accrued_interest,
        issued_total=st.issued_total,
        repaid_total=st.repaid_total,
        interest_income=st.interest_income,
        failed_payments=st.failed_payments,
        users_by_role=st.users_by_role,
        couriers_open_tasks=st.couriers_open_tasks,
        courier_tasks_today=st.courier_tasks_today,
    )


# --- Jobs and time travel -----------------------------------------------------------------


def run_jobs(session, now: datetime, grace_days: int) -> JobsResult:  # type: ignore[no-untyped-def]
    """Everything a periodic scheduler would do: expire offers, overdue / forfeit loans."""
    offers = review.expire_offers(session, now)
    counts = loans.process_loans(session, now, grace_days)
    session.commit()
    return JobsResult(
        now=now,
        offers_expired=offers,
        loans_overdue=counts["overdue"],
        loans_forfeited=counts["forfeited"],
    )


@router.post(
    "/jobs/run",
    response_model=JobsResult,
    summary="Запустить фоновые задачи: истечение офферов, просрочка и изъятие залога",
)
def post_jobs(
    session: SessionDep, _admin: AdminUser, settings: SettingsDep, clock: ClockDep
) -> JobsResult:
    return run_jobs(session, clock.now(), settings.grace_period_days)


def clock_read(clock: Clock, enabled: bool) -> ClockRead:
    seconds = int(clock.offset.total_seconds())
    return ClockRead(
        now=clock.now(),
        offset_seconds=seconds,
        offset_days=round(seconds / 86400, 2),
        enabled=enabled,
    )


def _ensure_time_travel(enabled: bool) -> None:
    if not enabled:
        raise ConflictError("Перемотка времени отключена (LOMBARD_TIME_TRAVEL=false)")


@router.get("/clock", response_model=ClockRead, summary="Часы приложения (с учётом перемотки)")
def get_clock(_admin: AdminUser, clock: ClockDep, settings: SettingsDep) -> ClockRead:
    return clock_read(clock, settings.time_travel_enabled)


@router.post(
    "/clock",
    response_model=ClockAdvanceResult,
    summary="Перемотать время вперёд (демо продления, просрочки, изъятия)",
)
def advance_clock(
    data: ClockAdvance,
    session: SessionDep,
    _admin: AdminUser,
    clock: ClockDep,
    settings: SettingsDep,
) -> ClockAdvanceResult:
    _ensure_time_travel(settings.time_travel_enabled)
    clock.advance(timedelta(days=data.days, hours=data.hours))
    jobs = run_jobs(session, clock.now(), settings.grace_period_days) if data.run_jobs else None
    return ClockAdvanceResult(**clock_read(clock, True).model_dump(), jobs=jobs)


@router.delete("/clock", response_model=ClockRead, summary="Вернуть реальное время")
def reset_clock(_admin: AdminUser, clock: ClockDep, settings: SettingsDep) -> ClockRead:
    _ensure_time_travel(settings.time_travel_enabled)
    clock.reset()
    return clock_read(clock, True)


# --- Outbox (mock SMS / e-mail) -----------------------------------------------------------


@router.get(
    "/messages",
    response_model=list[OutboxItem],
    summary="Журнал SMS и e-mail (мок-отправка)",
)
def list_messages(
    session: SessionDep,
    _admin: AdminUser,
    channel: NotificationChannel | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[OutboxItem]:
    if channel is NotificationChannel.IN_APP:
        raise ValidationProblems(
            [Problem("channel", "Журнал содержит только SMS и EMAIL")], "Проверьте фильтр"
        )
    return [
        OutboxItem(
            id=n.id,
            channel=n.channel,
            title=n.title,
            body=n.body,
            is_read=n.is_read,
            application_id=n.application_id,
            created_at=n.created_at,
            user=UserBrief.model_validate(n.user),
            email=n.user.email,
        )
        for n in outbox(session, channel, limit)
    ]
