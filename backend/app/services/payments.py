"""Payment gateway: payouts to a bank card and card charges.

`PaymentGateway` is the replacement point for a real acquiring bank (Kaspi, Halyk,
CloudPayments…). `MockPaymentGateway` approves everything except a few test cards, so
the failure path can be shown and tested.
"""

import logging
import uuid
from dataclasses import dataclass
from typing import Protocol

from app.domain.loans import mask_card, normalize_card

log = logging.getLogger("lombard.payments")

# Test cards (Luhn-valid). Any other valid card number is approved.
DECLINED_CARD = "4000000000000002"  # «Банк отклонил операцию»
NO_FUNDS_CARD = "4000000000009995"  # «Недостаточно средств»
DEMO_CARD = "4400430123456789"  # a card that works, for README / UI hints


@dataclass(frozen=True)
class GatewayResult:
    ok: bool
    provider_ref: str | None
    message: str


class PaymentGateway(Protocol):
    def payout(self, card_number: str, amount: int, reference: str) -> GatewayResult:
        """Send `amount` tiyn to the client's card."""
        ...

    def charge(self, card_number: str, amount: int, reference: str) -> GatewayResult:
        """Take `amount` tiyn from the client's card."""
        ...


class MockPaymentGateway:
    """Instant, in-process "bank". Keeps a log of operations for tests and debugging."""

    def __init__(self) -> None:
        self.operations: list[tuple[str, str, int, str, bool]] = []

    def _process(self, op: str, card_number: str, amount: int, reference: str) -> GatewayResult:
        digits = normalize_card(card_number)
        if amount <= 0:
            result = GatewayResult(False, None, "Некорректная сумма операции")
        elif digits == DECLINED_CARD:
            result = GatewayResult(False, None, "Банк отклонил операцию")
        elif digits == NO_FUNDS_CARD and op == "charge":
            result = GatewayResult(False, None, "Недостаточно средств на карте")
        else:
            ref = f"MOCK-{op.upper()}-{uuid.uuid4().hex[:12].upper()}"
            result = GatewayResult(True, ref, "Операция проведена")
        self.operations.append((op, mask_card(digits), amount, reference, result.ok))
        log.info(
            "mock %s %s %s tiyn ref=%s → %s",
            op,
            mask_card(digits),
            amount,
            reference,
            result.message,
        )
        return result

    def payout(self, card_number: str, amount: int, reference: str) -> GatewayResult:
        return self._process("payout", card_number, amount, reference)

    def charge(self, card_number: str, amount: int, reference: str) -> GatewayResult:
        return self._process("charge", card_number, amount, reference)
