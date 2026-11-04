import pytest

from app.domain.enums import ItemCondition, Metal
from app.domain.money import NBSP, format_kzt, round_tiyn, tenge
from app.domain.pricing import (
    EstimateError,
    EstimateInput,
    estimate,
    find_brand_tier,
    jewellery_premium,
    melt_value,
    normalize_brand,
    range_half_width,
    validate_metal_params,
)

GOLD_PRICE = tenge(66_500)


def gold_ring(**kw) -> EstimateInput:
    base = dict(
        category_code="gold",
        category_name="Золото",
        requires_metal=True,
        ltv_percent=80,
        metal=Metal.GOLD,
        fineness=585,
        weight_mg=3520,
        condition=ItemCondition.EXCELLENT,
        metal_price_per_gram=GOLD_PRICE,
        photo_confidence=90,
    )
    base.update(kw)
    return EstimateInput(**base)


def watch(**kw) -> EstimateInput:
    base = dict(
        category_code="watches",
        category_name="Часы",
        requires_metal=False,
        ltv_percent=60,
        brand="Omega Seamaster",
        condition=ItemCondition.GOOD,
        photo_confidence=80,
    )
    base.update(kw)
    return EstimateInput(**base)


# --- money --------------------------------------------------------------------------------


def test_format_kzt() -> None:
    assert format_kzt(1_610_000) == f"16{NBSP}100{NBSP}₸"
    assert format_kzt(0) == f"0{NBSP}₸"
    assert format_kzt(1_610_050) == f"16{NBSP}100,50{NBSP}₸"
    assert format_kzt(123_456_789_00) == f"123{NBSP}456{NBSP}789{NBSP}₸"
    assert format_kzt(-500) == f"−5{NBSP}₸"


def test_tenge_and_rounding() -> None:
    assert tenge(16_100) == 1_610_000
    assert round_tiyn(13_693_640) == 13_690_000  # 136 936,40 ₸ → 136 900 ₸
    assert round_tiyn(13_695_000) == 13_700_000  # half up
    assert round_tiyn(123_456, step_tenge=1) == 123_500


# --- metal method -------------------------------------------------------------------------


def test_melt_value_formula() -> None:
    # 3.52 g × 0.585 × 66 500 ₸ = 136 936.8 ₸
    assert melt_value(3520, 585, GOLD_PRICE) == pytest.approx(13_693_680)


def test_gold_ring_estimate() -> None:
    r = estimate(gold_ring())
    assert r.method == "metal"
    assert r.value == 13_690_000  # 136 900 ₸, condition EXCELLENT = ×1.0
    assert r.value_min < r.value < r.value_max
    assert r.params_confidence == 90
    assert r.confidence == round(90 * 0.65 + 90 * 0.35)
    assert r.loan_max == round_tiyn(r.value * 0.8)
    assert r.loan_min <= r.loan_max
    assert "Предварительная оценка" in r.summary
    assert r.details()["loan_estimate"] == {"min": r.loan_min, "max": r.loan_max}


def test_condition_and_brand_premium_for_metal() -> None:
    plain = estimate(gold_ring())
    poor = estimate(gold_ring(condition=ItemCondition.POOR))
    tiffany = estimate(gold_ring(brand="Tiffany & Co."))
    assert poor.value < plain.value
    assert tiffany.value == round_tiyn(melt_value(3520, 585, GOLD_PRICE) * 1.3)
    assert any("ювелирный дом" in s["label"] for s in tiffany.steps)


def test_metal_requires_params_and_price() -> None:
    with pytest.raises(EstimateError):
        estimate(gold_ring(weight_mg=None))
    with pytest.raises(EstimateError, match="Нет цены"):
        estimate(gold_ring(metal_price_per_gram=None))


def test_missing_condition_lowers_confidence() -> None:
    known = estimate(gold_ring())
    unknown = estimate(gold_ring(condition=None))
    assert unknown.params_confidence == known.params_confidence - 10
    assert any("не указано" in s["label"] for s in unknown.steps)


# --- brand method -------------------------------------------------------------------------


def test_brand_normalization_and_tiers() -> None:
    assert normalize_brand("  Tiffany   and  Co. ") == "tiffany & co"
    assert find_brand_tier("watches", "OMEGA Seamaster").code == "premium"
    assert find_brand_tier("watches", "Rolex Submariner").code == "luxury"
    assert find_brand_tier("watches", "Ролекс").code == "luxury"
    assert find_brand_tier("electronics", "Apple iPhone 15 Pro").code == "flagship"
    assert find_brand_tier("electronics", "Айфон 13").code == "flagship"
    assert find_brand_tier("watches", "Noname") is None
    assert find_brand_tier("watches", None) is None
    # Whole words only: "homega" is not "omega".
    assert find_brand_tier("watches", "Homega") is None
    assert jewellery_premium("Pandora")[0] == 1.1
    assert jewellery_premium(None) == (1.0, None)


def test_watch_estimate_by_brand_and_condition() -> None:
    good = estimate(watch())
    assert good.method == "brand"
    assert good.value == tenge(1_500_000 * 0.7)
    new = estimate(watch(condition=ItemCondition.NEW))
    assert new.value == tenge(1_500_000)
    rolex = estimate(watch(brand="Rolex"))
    assert rolex.value > good.value


def test_unknown_brand_has_low_confidence_and_wide_range() -> None:
    known = estimate(watch())
    unknown = estimate(watch(brand="Заря"))
    assert unknown.confidence < known.confidence
    rel = lambda r: (r.value_max - r.value_min) / r.value  # noqa: E731
    assert rel(unknown) > rel(known)
    assert any("бренд" in w.lower() for w in unknown.warnings)


def test_gold_watch_melt_value_is_floor() -> None:
    # Cheap brand, but 40 g of 750 gold: the metal is worth more than the brand base.
    r = estimate(
        watch(
            brand="Заря",
            metal=Metal.GOLD,
            fineness=750,
            weight_mg=40_000,
            metal_price_per_gram=GOLD_PRICE,
        )
    )
    assert r.value == round_tiyn(melt_value(40_000, 750, GOLD_PRICE))
    assert any("Стоимость металла" in s["label"] for s in r.steps)


def test_unknown_category_uses_generic_table() -> None:
    r = estimate(
        EstimateInput(
            category_code="furs",
            category_name="Шубы",
            requires_metal=False,
            ltv_percent=40,
            condition=ItemCondition.NEW,
            photo_confidence=50,
        )
    )
    assert r.value == tenge(50_000)


def test_no_photos_reduces_confidence() -> None:
    with_photos = estimate(gold_ring(photo_confidence=100))
    without = estimate(gold_ring(photo_confidence=None))
    assert without.confidence < with_photos.confidence
    assert "Фото не анализировались" in without.warnings


def test_confidence_bounds_and_range_width() -> None:
    assert range_half_width(100) == pytest.approx(0.04)
    assert range_half_width(0) == pytest.approx(0.44)
    low = estimate(watch(brand=None, condition=None, photo_confidence=0))
    assert 5 <= low.confidence <= 95
    assert low.value_min >= tenge(100)


# --- validation ---------------------------------------------------------------------------


def test_validate_metal_params() -> None:
    assert validate_metal_params("gold", True, Metal.GOLD, 585) == []
    assert validate_metal_params("gold", True, None, None) == []
    errors = dict(validate_metal_params("gold", True, Metal.GOLD, 925))
    assert "Проба 925" in errors["fineness"]
    errors = dict(validate_metal_params("gold", True, Metal.SILVER, 925))
    assert "metal" in errors and "fineness" not in errors
    errors = dict(validate_metal_params("watches", False, None, 750))
    assert "вместе с металлом" in errors["fineness"]
    # Non-metal categories accept any metal (a gold watch).
    assert validate_metal_params("watches", False, Metal.GOLD, 750) == []
    assert validate_metal_params("platinum", True, Metal.PALLADIUM, 950) == []
