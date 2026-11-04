"""Map domain exceptions to HTTP responses; Russian messages for validation errors."""

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.domain.state_machine import InvalidTransitionError, TransitionForbiddenError
from app.services.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    PayloadTooLargeError,
    ValidationProblems,
)
from app.services.loans import PaymentDeclinedError

# Pydantic error type → Russian message (ctx placeholders as in pydantic).
_RU_MESSAGES: dict[str, str] = {
    "missing": "Обязательное поле",
    "string_too_short": "Минимальная длина — {min_length} симв.",
    "string_too_long": "Максимальная длина — {max_length} симв.",
    "string_type": "Ожидается строка",
    "int_parsing": "Ожидается целое число",
    "bool_parsing": "Ожидается логическое значение",
    "enum": "Допустимые значения: {expected}",
    "json_invalid": "Некорректный JSON",
    "greater_than": "Значение должно быть больше {gt}",
    "greater_than_equal": "Значение должно быть не меньше {ge}",
    "less_than_equal": "Значение должно быть не больше {le}",
    "decimal_parsing": "Ожидается число",
    "decimal_max_places": "Не больше {decimal_places} знаков после запятой",
    "too_short": "Нужно хотя бы {min_length} элемент(ов)",
}


def _translate(error: dict[str, Any]) -> dict[str, Any]:
    err = dict(error)
    err.pop("url", None)
    etype = err.get("type", "")
    ctx = err.get("ctx") or {}
    if etype == "value_error":
        # Our validators raise ValueError with Russian text; drop pydantic's prefix.
        err["msg"] = str(err.get("msg", "")).removeprefix("Value error, ")
    elif etype in _RU_MESSAGES:
        try:
            err["msg"] = _RU_MESSAGES[etype].format(**ctx)
        except (KeyError, IndexError):
            err["msg"] = _RU_MESSAGES[etype]
    if "email" in str(err.get("msg", "")).lower() and etype == "value_error":
        err["msg"] = "Некорректный адрес e-mail"
    return err


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(TransitionForbiddenError)
    async def _forbidden(_request: Request, exc: TransitionForbiddenError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status.HTTP_403_FORBIDDEN)

    @app.exception_handler(InvalidTransitionError)
    async def _invalid(_request: Request, exc: InvalidTransitionError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status.HTTP_409_CONFLICT)

    @app.exception_handler(ValidationProblems)
    async def _problems(_request: Request, exc: ValidationProblems) -> JSONResponse:
        detail = [
            {"loc": ["body", p.field], "msg": p.message, "type": "business_rule"}
            for p in exc.problems
        ]
        return JSONResponse({"detail": detail, "message": exc.message}, status_code=422)

    @app.exception_handler(ConflictError)
    async def _conflict(_request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status.HTTP_409_CONFLICT)

    @app.exception_handler(ForbiddenError)
    async def _forbidden_action(_request: Request, exc: ForbiddenError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status.HTTP_403_FORBIDDEN)

    @app.exception_handler(NotFoundError)
    async def _not_found(_request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status.HTTP_404_NOT_FOUND)

    @app.exception_handler(PaymentDeclinedError)
    async def _declined(_request: Request, exc: PaymentDeclinedError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status.HTTP_402_PAYMENT_REQUIRED)

    @app.exception_handler(PayloadTooLargeError)
    async def _too_large(_request: Request, exc: PayloadTooLargeError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=413)

    @app.exception_handler(RequestValidationError)
    async def _validation(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [_translate(e) for e in exc.errors()]
        return JSONResponse(
            {"detail": jsonable_encoder(errors)},
            status_code=422,
        )
