"""Money helpers. All amounts are integers in tiyn (1 ₸ = 100 tiyn)."""

NBSP = " "
TIYN_PER_TENGE = 100


def tenge(amount: int | float) -> int:
    """Tenge → tiyn: `tenge(16_100) == 1_610_000`."""
    return round(amount * TIYN_PER_TENGE)


def round_tiyn(amount: float, step_tenge: int = 100) -> int:
    """Round an amount in tiyn to a whole number of `step_tenge` tenge (half up)."""
    step = step_tenge * TIYN_PER_TENGE
    return int((amount + step / 2) // step * step)


def format_kzt(amount: int) -> str:
    """`1_610_000` → `16 100 ₸` (non-breaking spaces between groups and before the sign).

    Tiyn are shown only when non-zero: `1_610_050` → `16 100,50 ₸`.
    """
    sign = "−" if amount < 0 else ""
    whole, frac = divmod(abs(amount), TIYN_PER_TENGE)
    groups = f"{whole:,}".replace(",", NBSP)
    tail = f",{frac:02d}" if frac else ""
    return f"{sign}{groups}{tail}{NBSP}₸"
