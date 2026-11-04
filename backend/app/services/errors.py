"""Service-level errors mapped to HTTP in `app/api/errors.py`."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Problem:
    field: str
    message: str


class ValidationProblems(Exception):
    """Business validation failed (→ 422, same shape as FastAPI validation errors)."""

    def __init__(self, problems: list[Problem], message: str = "Проверьте данные заявки") -> None:
        super().__init__(message)
        self.problems = problems
        self.message = message


class ConflictError(Exception):
    """Operation not allowed in the current state (→ 409). Message is user-facing."""


class NotFoundError(Exception):
    """Entity missing or not visible to the user (→ 404). Message is user-facing."""


class PayloadTooLargeError(Exception):
    """Upload exceeds limits (→ 413)."""
