"""Courier logistics: delivery time slots and the courier task flow.

Pure functions only (no DB, no FastAPI) so they can be ported to the demo (stage 13).
Slots are local Kazakhstan time windows (UTC+5); everything returned is UTC-aware.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, timezone
from types import MappingProxyType

from app.domain.enums import ApplicationStatus, CourierTaskKind, CourierTaskStatus

# Kazakhstan has a single time zone, UTC+5, since 2024-03-01. Calendar dates of a loan
# and courier slots are local; timestamps are stored in UTC.
KZ_TZ = timezone(timedelta(hours=5), "Asia/Almaty")

T = CourierTaskStatus
K = CourierTaskKind
S = ApplicationStatus


def local_today(now: datetime) -> date:
    return now.astimezone(KZ_TZ).date()


# --- Slots --------------------------------------------------------------------------------


@dataclass(frozen=True)
class SlotRules:
    day_start_hour: int = 10  # first slot starts at 10:00 local time
    day_end_hour: int = 20  # last slot ends at 20:00
    slot_hours: int = 2
    lead_hours: int = 2  # a slot must start at least this long after "now"
    horizon_days: int = 7  # today + 7 days ahead

    def __post_init__(self) -> None:
        if not (0 <= self.day_start_hour < self.day_end_hour <= 24):
            raise ValueError("Некорректные часы работы курьеров")
        if self.slot_hours < 1 or (self.day_end_hour - self.day_start_hour) % self.slot_hours:
            raise ValueError("Рабочий день должен делиться на слоты целиком")


DEFAULT_RULES = SlotRules()


@dataclass(frozen=True)
class Slot:
    start: datetime  # UTC
    end: datetime  # UTC

    @property
    def local_date(self) -> date:
        return self.start.astimezone(KZ_TZ).date()

    @property
    def label(self) -> str:
        """«05.11, 10:00–12:00» (local time)."""
        s, e = self.start.astimezone(KZ_TZ), self.end.astimezone(KZ_TZ)
        return f"{s:%d.%m}, {s:%H:%M}–{e:%H:%M}"


def day_slots(day: date, rules: SlotRules = DEFAULT_RULES) -> list[Slot]:
    """All slots of a local calendar day, in order."""
    slots = []
    for hour in range(rules.day_start_hour, rules.day_end_hour, rules.slot_hours):
        start = datetime.combine(day, time(hour), KZ_TZ)
        slots.append(
            Slot(start.astimezone(UTC), (start + timedelta(hours=rules.slot_hours)).astimezone(UTC))
        )
    return slots


def bookable_slots(now: datetime, rules: SlotRules = DEFAULT_RULES) -> list[Slot]:
    """Slots a client may book right now: from now + lead time up to the horizon."""
    earliest = now + timedelta(hours=rules.lead_hours)
    today = local_today(now)
    result: list[Slot] = []
    for offset in range(rules.horizon_days + 1):
        day = today + timedelta(days=offset)
        result += [s for s in day_slots(day, rules) if s.start >= earliest]
    return result


def find_slot(start: datetime, now: datetime, rules: SlotRules = DEFAULT_RULES) -> Slot | None:
    """The bookable slot starting exactly at `start` (any time zone), or None."""
    if start.tzinfo is None:
        return None
    start = start.astimezone(UTC)
    return next((s for s in bookable_slots(now, rules) if s.start == start), None)


# --- Courier task flow --------------------------------------------------------------------


class CourierStep:
    START = "start"  # «Выехал»
    PICK_UP = "pick_up"  # «Забрал изделие»
    DELIVER = "deliver"  # «Доставил»


# (kind, step) -> (task status before, task status after, application status after).
# A pickup goes client → pawnshop; a return (stage 8) goes pawnshop → client, so it has
# no separate "picked up" step: the courier takes the item at the pawnshop when leaving.
_STEPS: dict[tuple[K, str], tuple[T, T, S]] = {
    (K.PICKUP, CourierStep.START): (T.SCHEDULED, T.EN_ROUTE, S.COURIER_EN_ROUTE),
    (K.PICKUP, CourierStep.PICK_UP): (T.EN_ROUTE, T.PICKED_UP, S.ITEM_PICKED_UP),
    (K.PICKUP, CourierStep.DELIVER): (T.PICKED_UP, T.DELIVERED, S.ITEM_DELIVERED),
    (K.RETURN, CourierStep.DELIVER): (T.EN_ROUTE, T.DELIVERED, S.ITEM_RETURNED),
}
# Return trips change only the task status on start (the application stays REPAID).
_TASK_ONLY_STEPS: dict[tuple[K, str], tuple[T, T]] = {
    (K.RETURN, CourierStep.START): (T.SCHEDULED, T.EN_ROUTE),
}

STEPS: Mapping[tuple[K, str], tuple[T, T, S]] = MappingProxyType(_STEPS)

OPEN_TASK_STATUSES: frozenset[T] = frozenset({T.SCHEDULED, T.EN_ROUTE, T.PICKED_UP})

TASK_STATUS_LABELS: Mapping[T, str] = MappingProxyType(
    {
        T.SCHEDULED: "Назначен",
        T.EN_ROUTE: "В пути",
        T.PICKED_UP: "Изделие у курьера",
        T.DELIVERED: "Доставлено",
        T.CANCELLED: "Отменён",
    }
)
TASK_KIND_LABELS: Mapping[K, str] = MappingProxyType(
    {K.PICKUP: "Забрать у клиента", K.RETURN: "Вернуть клиенту"}
)
STEP_LABELS: Mapping[str, str] = MappingProxyType(
    {
        CourierStep.START: "Выехал",
        CourierStep.PICK_UP: "Забрал изделие",
        CourierStep.DELIVER: "Доставил",
    }
)


class CourierStepError(ValueError):
    pass


def step_result(kind: K, step: str, current: T) -> tuple[T, S | None]:
    """New task status and the application status to move to (None — unchanged).

    Raises `CourierStepError` with a user-facing message if the step is not possible now.
    """
    if (kind, step) in _STEPS:
        before, after, app_status = _STEPS[(kind, step)]
    elif (kind, step) in _TASK_ONLY_STEPS:
        before, after = _TASK_ONLY_STEPS[(kind, step)]
        app_status = None
    else:
        raise CourierStepError(f"Шаг «{STEP_LABELS.get(step, step)}» не применим к этому выезду")
    if current is not before:
        raise CourierStepError(
            f"Шаг «{STEP_LABELS[step]}» невозможен: выезд в статусе «{TASK_STATUS_LABELS[current]}»"
        )
    return after, app_status


def next_steps(kind: K, current: T) -> list[str]:
    """Steps available for a task in `current` status (0 or 1 item, for the UI)."""
    table = {**{k: v[:2] for k, v in _STEPS.items()}, **_TASK_ONLY_STEPS}
    return [step for (k, step), (before, _) in table.items() if k is kind and before is current]
