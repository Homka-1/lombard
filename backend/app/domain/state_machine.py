"""Application lifecycle state machine.

Pure functions only (no DB, no FastAPI) so the same table can be ported to the
dependency-free demo (stage 13) and unit-tested in isolation.
"""

from collections.abc import Mapping
from types import MappingProxyType

from app.domain.enums import Actor, ApplicationStatus

S = ApplicationStatus
A = Actor

# (from, to) -> actors allowed to perform the transition.
_TRANSITIONS: dict[tuple[S, S], frozenset[A]] = {
    # Client submits; the system pre-estimates automatically.
    (S.DRAFT, S.SUBMITTED): frozenset({A.CLIENT}),
    (S.SUBMITTED, S.PRE_ESTIMATED): frozenset({A.SYSTEM}),
    # Expert review.
    (S.PRE_ESTIMATED, S.UNDER_REVIEW): frozenset({A.EXPERT}),
    (S.UNDER_REVIEW, S.OFFER_SENT): frozenset({A.EXPERT}),
    (S.UNDER_REVIEW, S.REJECTED): frozenset({A.EXPERT}),
    (S.UNDER_REVIEW, S.NEED_INFO): frozenset({A.EXPERT}),
    (S.NEED_INFO, S.SUBMITTED): frozenset({A.CLIENT}),
    # Client decision (or offer expiry).
    (S.OFFER_SENT, S.OFFER_ACCEPTED): frozenset({A.CLIENT}),
    (S.OFFER_SENT, S.OFFER_DECLINED): frozenset({A.CLIENT, A.SYSTEM}),
    # Courier pickup.
    (S.OFFER_ACCEPTED, S.COURIER_SCHEDULED): frozenset({A.CLIENT, A.ADMIN}),
    (S.COURIER_SCHEDULED, S.COURIER_EN_ROUTE): frozenset({A.COURIER}),
    (S.COURIER_EN_ROUTE, S.ITEM_PICKED_UP): frozenset({A.COURIER}),
    (S.ITEM_PICKED_UP, S.ITEM_DELIVERED): frozenset({A.COURIER}),
    # Inspection and disbursement.
    (S.ITEM_DELIVERED, S.INSPECTED): frozenset({A.EXPERT}),
    (S.INSPECTED, S.FUNDS_ISSUED): frozenset({A.SYSTEM, A.ADMIN}),
    (S.FUNDS_ISSUED, S.LOAN_ACTIVE): frozenset({A.SYSTEM}),
    # Loan lifecycle.
    (S.LOAN_ACTIVE, S.REPAID): frozenset({A.CLIENT, A.SYSTEM}),
    (S.LOAN_ACTIVE, S.EXTENDED): frozenset({A.CLIENT}),
    (S.EXTENDED, S.LOAN_ACTIVE): frozenset({A.SYSTEM}),
    (S.LOAN_ACTIVE, S.OVERDUE): frozenset({A.SYSTEM, A.ADMIN}),
    # During the grace period the client may still repay or extend.
    (S.OVERDUE, S.REPAID): frozenset({A.CLIENT, A.SYSTEM}),
    (S.OVERDUE, S.EXTENDED): frozenset({A.CLIENT}),
    (S.OVERDUE, S.FORFEITED): frozenset({A.SYSTEM, A.ADMIN}),
    # Item goes back to the client.
    (S.REPAID, S.ITEM_RETURNED): frozenset({A.COURIER}),
}

TRANSITIONS: Mapping[tuple[S, S], frozenset[A]] = MappingProxyType(_TRANSITIONS)

INITIAL_STATUS = S.DRAFT
TERMINAL_STATUSES: frozenset[S] = frozenset(
    {S.REJECTED, S.OFFER_DECLINED, S.ITEM_RETURNED, S.FORFEITED}
)

# Russian labels; must match design/tokens.json -> status (checked by tests).
STATUS_LABELS: Mapping[S, str] = MappingProxyType(
    {
        S.DRAFT: "Черновик",
        S.SUBMITTED: "Отправлена",
        S.PRE_ESTIMATED: "Предоценка готова",
        S.UNDER_REVIEW: "У эксперта",
        S.NEED_INFO: "Нужны фото",
        S.OFFER_SENT: "Предложение",
        S.OFFER_ACCEPTED: "Предложение принято",
        S.OFFER_DECLINED: "Отказ клиента",
        S.REJECTED: "Отклонена",
        S.COURIER_SCHEDULED: "Курьер назначен",
        S.COURIER_EN_ROUTE: "Курьер в пути",
        S.ITEM_PICKED_UP: "Изделие у курьера",
        S.ITEM_DELIVERED: "В ломбарде",
        S.INSPECTED: "Осмотрено",
        S.FUNDS_ISSUED: "Деньги выданы",
        S.LOAN_ACTIVE: "Займ действует",
        S.EXTENDED: "Продлён",
        S.OVERDUE: "Просрочка",
        S.REPAID: "Погашен",
        S.ITEM_RETURNED: "Изделие возвращено",
        S.FORFEITED: "Перешло ломбарду",
    }
)


class TransitionError(Exception):
    """Base class for rejected status transitions."""

    def __init__(self, current: S, target: S, actor: A, message: str) -> None:
        super().__init__(message)
        self.current = current
        self.target = target
        self.actor = actor


class InvalidTransitionError(TransitionError):
    """The transition does not exist in the lifecycle."""


class TransitionForbiddenError(TransitionError):
    """The transition exists, but this actor may not perform it."""


def is_terminal(status: S) -> bool:
    return status in TERMINAL_STATUSES


def can_transition(current: S, target: S, actor: A) -> bool:
    return actor in _TRANSITIONS.get((current, target), frozenset())


def allowed_targets(current: S, actor: A | None = None) -> list[S]:
    """Statuses reachable in one step, optionally only those allowed to `actor`.

    Returned in enum declaration order for stable output.
    """
    return [
        target
        for target in S
        if (current, target) in _TRANSITIONS
        and (actor is None or actor in _TRANSITIONS[(current, target)])
    ]


def ensure_transition(current: S, target: S, actor: A) -> None:
    """Raise a `TransitionError` subclass unless the transition is allowed."""
    actors = _TRANSITIONS.get((current, target))
    if actors is None:
        raise InvalidTransitionError(
            current,
            target,
            actor,
            f"Переход «{STATUS_LABELS[current]}» → «{STATUS_LABELS[target]}» невозможен",
        )
    if actor not in actors:
        raise TransitionForbiddenError(
            current,
            target,
            actor,
            f"Роль {actor.value} не может перевести заявку "
            f"из «{STATUS_LABELS[current]}» в «{STATUS_LABELS[target]}»",
        )
