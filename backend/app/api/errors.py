"""Map domain exceptions to HTTP responses; Russian messages for validation errors."""

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.domain.state_machine import InvalidTransitionError, TransitionForbiddenError

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

    @app.exception_handler(RequestValidationError)
    async def _validation(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [_translate(e) for e in exc.errors()]
        return JSONResponse(
            {"detail": jsonable_encoder(errors)},
            status_code=422,
        )
