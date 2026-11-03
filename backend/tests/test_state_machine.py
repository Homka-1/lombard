import json
from collections import deque
from pathlib import Path

import pytest

from app.domain.enums import Actor, ApplicationStatus
from app.domain.state_machine import (
    INITIAL_STATUS,
    STATUS_LABELS,
    TERMINAL_STATUSES,
    TRANSITIONS,
    InvalidTransitionError,
    TransitionError,
    TransitionForbiddenError,
    allowed_targets,
    can_transition,
    ensure_transition,
    is_terminal,
)

S = ApplicationStatus
A = Actor

TOKENS = Path(__file__).resolve().parents[2] / "design" / "tokens.json"

HAPPY_PATH: list[tuple[S, A]] = [
    (S.SUBMITTED, A.CLIENT),
    (S.PRE_ESTIMATED, A.SYSTEM),
    (S.UNDER_REVIEW, A.EXPERT),
    (S.OFFER_SENT, A.EXPERT),
    (S.OFFER_ACCEPTED, A.CLIENT),
    (S.COURIER_SCHEDULED, A.CLIENT),
    (S.COURIER_EN_ROUTE, A.COURIER),
    (S.ITEM_PICKED_UP, A.COURIER),
    (S.ITEM_DELIVERED, A.COURIER),
    (S.INSPECTED, A.EXPERT),
    (S.FUNDS_ISSUED, A.SYSTEM),
    (S.LOAN_ACTIVE, A.SYSTEM),
    (S.EXTENDED, A.CLIENT),
    (S.LOAN_ACTIVE, A.SYSTEM),
    (S.REPAID, A.CLIENT),
    (S.ITEM_RETURNED, A.COURIER),
]


def _walk(path: list[tuple[S, A]]) -> S:
    status = INITIAL_STATUS
    for target, actor in path:
        ensure_transition(status, target, actor)
        status = target
    return status


def test_happy_path_from_draft_to_item_returned():
    assert _walk(HAPPY_PATH) is S.ITEM_RETURNED


def test_overdue_then_forfeited():
    path = [*HAPPY_PATH[:12], (S.OVERDUE, A.SYSTEM), (S.FORFEITED, A.SYSTEM)]
    assert _walk(path) is S.FORFEITED


def test_overdue_client_can_still_repay_or_extend_during_grace():
    assert can_transition(S.OVERDUE, S.REPAID, A.CLIENT)
    assert can_transition(S.OVERDUE, S.EXTENDED, A.CLIENT)
    assert not can_transition(S.OVERDUE, S.FORFEITED, A.CLIENT)


def test_need_info_loop_returns_to_submitted():
    path = [*HAPPY_PATH[:3], (S.NEED_INFO, A.EXPERT), (S.SUBMITTED, A.CLIENT)]
    assert _walk(path) is S.SUBMITTED


@pytest.mark.parametrize(
    ("current", "target"),
    [
        (S.DRAFT, S.OFFER_SENT),
        (S.SUBMITTED, S.UNDER_REVIEW),  # pre-estimate cannot be skipped
        (S.OFFER_SENT, S.FUNDS_ISSUED),
        (S.ITEM_DELIVERED, S.FUNDS_ISSUED),  # inspection is mandatory
        (S.REPAID, S.LOAN_ACTIVE),
        (S.FORFEITED, S.LOAN_ACTIVE),
    ],
)
def test_invalid_transitions_raise(current, target):
    with pytest.raises(InvalidTransitionError) as exc:
        ensure_transition(current, target, A.ADMIN)
    assert exc.value.current is current
    assert exc.value.target is target
    assert "невозможен" in str(exc.value)


@pytest.mark.parametrize(
    ("current", "target", "actor"),
    [
        (S.DRAFT, S.SUBMITTED, A.EXPERT),  # only the owner submits
        (S.SUBMITTED, S.PRE_ESTIMATED, A.CLIENT),  # only the system pre-estimates
        (S.UNDER_REVIEW, S.OFFER_SENT, A.CLIENT),  # client cannot make own offer
        (S.OFFER_SENT, S.OFFER_ACCEPTED, A.EXPERT),  # expert cannot accept for client
        (S.COURIER_SCHEDULED, S.COURIER_EN_ROUTE, A.CLIENT),
        (S.ITEM_DELIVERED, S.INSPECTED, A.COURIER),
        (S.LOAN_ACTIVE, S.OVERDUE, A.CLIENT),
        (S.REPAID, S.ITEM_RETURNED, A.CLIENT),
    ],
)
def test_forbidden_actor_raises(current, target, actor):
    assert not can_transition(current, target, actor)
    with pytest.raises(TransitionForbiddenError) as exc:
        ensure_transition(current, target, actor)
    assert isinstance(exc.value, TransitionError)
    assert actor.value in str(exc.value)


def test_terminal_statuses_have_no_outgoing_transitions():
    for status in TERMINAL_STATUSES:
        assert is_terminal(status)
        assert allowed_targets(status) == []


def test_non_terminal_statuses_have_a_way_out():
    for status in S:
        if status not in TERMINAL_STATUSES:
            assert allowed_targets(status), f"{status} is a dead end"


def test_every_status_reachable_from_draft():
    seen = {INITIAL_STATUS}
    queue = deque([INITIAL_STATUS])
    while queue:
        for target in allowed_targets(queue.popleft()):
            if target not in seen:
                seen.add(target)
                queue.append(target)
    assert seen == set(S)


def test_every_non_terminal_status_can_reach_a_terminal_one():
    for start in S:
        seen, queue = {start}, deque([start])
        while queue:
            for t in allowed_targets(queue.popleft()):
                if t not in seen:
                    seen.add(t)
                    queue.append(t)
        assert seen & TERMINAL_STATUSES, f"{start} never ends"


def test_allowed_targets_filters_by_actor():
    assert allowed_targets(S.UNDER_REVIEW, A.EXPERT) == [S.NEED_INFO, S.OFFER_SENT, S.REJECTED]
    assert allowed_targets(S.UNDER_REVIEW, A.CLIENT) == []
    assert allowed_targets(S.OFFER_SENT, A.CLIENT) == [S.OFFER_ACCEPTED, S.OFFER_DECLINED]
    assert allowed_targets(S.LOAN_ACTIVE, A.CLIENT) == [S.EXTENDED, S.REPAID]


def test_transition_table_is_read_only():
    with pytest.raises(TypeError):
        TRANSITIONS[(S.DRAFT, S.REPAID)] = frozenset({A.CLIENT})  # type: ignore[index]


def test_labels_match_design_tokens():
    tokens = json.loads(TOKENS.read_text(encoding="utf-8"))["status"]
    assert set(tokens) == {s.value for s in S}
    for status in S:
        assert STATUS_LABELS[status] == tokens[status.value]["label"]
