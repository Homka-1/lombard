"""Kazakhstan phone numbers: normalisation to E.164 and display formatting.

All Kazakhstan numbers are +7 7XX XXX-XX-XX (mobile 700–708, 747, 771, 775–778;
landlines e.g. Almaty +7 727, Astana +7 717). Stored as E.164: "+77011234567".
"""

import re

MOBILE_CODES = frozenset(
    {*(str(c) for c in range(700, 709)), "747", "771", "775", "776", "777", "778"}
)

_DIGITS = re.compile(r"\D")


class PhoneError(ValueError):
    pass


def normalize_kz_phone(raw: str) -> str:
    """Accept "+7 701 123-45-67", "87011234567", "7011234567" → "+77011234567"."""
    text = raw.strip()
    if not re.fullmatch(r"[\d\s()+\-.]+", text):
        raise PhoneError("Телефон может содержать только цифры, пробелы, скобки и дефисы")
    digits = _DIGITS.sub("", text)
    if text.startswith("+") and not (len(digits) == 11 and digits[0] == "7"):
        raise PhoneError("Введите номер в формате +7 7XX XXX-XX-XX")
    if len(digits) == 11 and digits[0] in "78":
        digits = "7" + digits[1:]
    elif len(digits) == 10:
        digits = "7" + digits
    else:
        raise PhoneError("Введите номер в формате +7 7XX XXX-XX-XX")
    if digits[1] != "7":
        raise PhoneError("Номер Казахстана должен начинаться с +7 7…")
    return "+" + digits


def is_mobile(e164: str) -> bool:
    return e164[2:5] in MOBILE_CODES


def format_kz_phone(e164: str) -> str:
    """ "+77011234567" → "+7 701 123-45-67"."""
    d = e164.removeprefix("+")
    if len(d) != 11:
        return e164
    return f"+{d[0]} {d[1:4]} {d[4:7]}-{d[7:9]}-{d[9:11]}"
