import pytest

from app.domain.phone import PhoneError, format_kz_phone, is_mobile, normalize_kz_phone


@pytest.mark.parametrize(
    "raw",
    ["+7 701 123-45-67", "87011234567", "7011234567", "+7 (701) 123 45 67", " 77011234567 "],
)
def test_normalize_variants(raw):
    assert normalize_kz_phone(raw) == "+77011234567"


@pytest.mark.parametrize(
    "raw", ["+7 912 123-45-67", "12345", "+7 701 123-45-6", "abc", "+1 701 1234567"]
)
def test_normalize_rejects(raw):
    with pytest.raises(PhoneError):
        normalize_kz_phone(raw)


def test_format_and_mobile():
    assert format_kz_phone("+77011234567") == "+7 701 123-45-67"
    assert is_mobile("+77771234567")
    assert not is_mobile("+77273001020")  # Almaty landline
