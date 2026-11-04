"""Pre-estimate formula: market value from category, metal, fineness, weight, brand, condition.

Pure functions and reference tables only (no DB, no FastAPI), so the same formula can be
ported to the dependency-free demo (stage 13). Prices are educational, not market quotes.

Two methods:
- **metal** (categories with `requires_metal`): melt value
  `weight_g × fineness / 1000 × price_per_gram(999)`, × jewellery brand premium,
  × condition factor (small: metal is metal).
- **brand** (watches, electronics, other): base value of the brand tier for the category,
  × condition factor (large). If metal and weight are also given (a gold watch), the melt
  value works as a floor.

Confidence = 65 % parameters + 35 % photos; the range around the point value widens as
confidence drops.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from app.domain.enums import ItemCondition, Metal
from app.domain.money import format_kzt, round_tiyn, tenge

C = ItemCondition

METAL_LABELS: Mapping[Metal, str] = MappingProxyType(
    {
        Metal.GOLD: "Золото",
        Metal.SILVER: "Серебро",
        Metal.PLATINUM: "Платина",
        Metal.PALLADIUM: "Палладий",
    }
)

CONDITION_LABELS: Mapping[ItemCondition, str] = MappingProxyType(
    {
        C.NEW: "Новое",
        C.EXCELLENT: "Отличное",
        C.GOOD: "Хорошее",
        C.FAIR: "Удовлетворительное",
        C.POOR: "Плохое",
    }
)

# Hallmarks accepted in Kazakhstan / CIS (metric system, parts per 1000).
FINENESS_BY_METAL: Mapping[Metal, tuple[int, ...]] = MappingProxyType(
    {
        Metal.GOLD: (375, 500, 583, 585, 750, 850, 875, 900, 916, 958, 999),
        Metal.SILVER: (800, 830, 875, 900, 916, 925, 960, 999),
        Metal.PLATINUM: (585, 850, 900, 950, 999),
        Metal.PALLADIUM: (500, 850, 950, 999),
    }
)

# Metal categories: which metals they accept (category code → metals).
CATEGORY_METALS: Mapping[str, frozenset[Metal]] = MappingProxyType(
    {
        "gold": frozenset({Metal.GOLD}),
        "silver": frozenset({Metal.SILVER}),
        "platinum": frozenset({Metal.PLATINUM, Metal.PALLADIUM}),
    }
)

# Condition factor by method.
CONDITION_FACTORS: Mapping[str, Mapping[ItemCondition, float]] = MappingProxyType(
    {
        "metal": {C.NEW: 1.0, C.EXCELLENT: 1.0, C.GOOD: 0.97, C.FAIR: 0.93, C.POOR: 0.85},
        "watches": {C.NEW: 1.0, C.EXCELLENT: 0.85, C.GOOD: 0.7, C.FAIR: 0.5, C.POOR: 0.3},
        "electronics": {C.NEW: 1.0, C.EXCELLENT: 0.75, C.GOOD: 0.6, C.FAIR: 0.4, C.POOR: 0.2},
        "generic": {C.NEW: 1.0, C.EXCELLENT: 0.85, C.GOOD: 0.7, C.FAIR: 0.5, C.POOR: 0.3},
    }
)
DEFAULT_CONDITION = C.GOOD


@dataclass(frozen=True)
class BrandTier:
    code: str
    label: str
    base_value: int  # tiyn, item in NEW condition
    brands: tuple[str, ...]
    params_confidence: int  # how well the tier predicts the price


# Brand tables for the "brand" method, by category code.
BRAND_TIERS: Mapping[str, tuple[BrandTier, ...]] = MappingProxyType(
    {
        "watches": (
            BrandTier(
                "luxury",
                "Люкс",
                tenge(3_500_000),
                (
                    "rolex",
                    "patek philippe",
                    "audemars piguet",
                    "richard mille",
                    "vacheron constantin",
                    "a. lange & sohne",
                    "breguet",
                    "ролекс",
                ),
                55,
            ),
            BrandTier(
                "premium",
                "Премиум",
                tenge(1_500_000),
                (
                    "omega",
                    "cartier",
                    "breitling",
                    "iwc",
                    "jaeger-lecoultre",
                    "panerai",
                    "hublot",
                    "zenith",
                    "chopard",
                    "омега",
                    "картье",
                ),
                60,
            ),
            BrandTier(
                "middle",
                "Средний сегмент",
                tenge(500_000),
                (
                    "tag heuer",
                    "longines",
                    "tudor",
                    "rado",
                    "oris",
                    "maurice lacroix",
                    "frederique constant",
                    "baume & mercier",
                    "лонжин",
                ),
                60,
            ),
            BrandTier(
                "entry",
                "Массовый сегмент",
                tenge(120_000),
                (
                    "tissot",
                    "seiko",
                    "citizen",
                    "orient",
                    "casio",
                    "g-shock",
                    "swatch",
                    "hamilton",
                    "certina",
                    "mido",
                    "тиссо",
                    "сейко",
                    "касио",
                ),
                60,
            ),
        ),
        "electronics": (
            BrandTier(
                "flagship",
                "Флагманы",
                tenge(350_000),
                ("apple", "iphone", "macbook", "ipad", "эппл", "айфон", "макбук"),
                55,
            ),
            BrandTier(
                "upper",
                "Верхний сегмент",
                tenge(220_000),
                (
                    "samsung",
                    "sony",
                    "google",
                    "microsoft",
                    "dell",
                    "lenovo",
                    "asus",
                    "hp",
                    "самсунг",
                ),
                50,
            ),
            BrandTier(
                "middle",
                "Средний сегмент",
                tenge(110_000),
                (
                    "xiaomi",
                    "huawei",
                    "honor",
                    "oneplus",
                    "acer",
                    "realme",
                    "oppo",
                    "vivo",
                    "nothing",
                    "сяоми",
                    "хуавей",
                ),
                50,
            ),
        ),
    }
)
UNKNOWN_BRAND_VALUE: Mapping[str, int] = MappingProxyType(
    {"watches": tenge(40_000), "electronics": tenge(60_000), "generic": tenge(50_000)}
)
UNKNOWN_BRAND_CONFIDENCE = 25

# Jewellery brand premium for the "metal" method (on top of melt value).
JEWELLERY_PREMIUMS: tuple[tuple[float, str, tuple[str, ...]], ...] = (
    (
        1.3,
        "ювелирный дом",
        (
            "cartier",
            "tiffany",
            "tiffany & co",
            "bvlgari",
            "bulgari",
            "van cleef & arpels",
            "chopard",
            "graff",
            "harry winston",
            "картье",
            "тиффани",
        ),
    ),
    (1.1, "известный бренд", ("pandora", "sokolov", "sunlight", "swarovski", "пандора", "соколов")),
)

PARAMS_WEIGHT = 0.65
PHOTOS_WEIGHT = 0.35
CONFIDENCE_MIN, CONFIDENCE_MAX = 5, 95
METHOD_VERSION = "formula-v1"


def normalize_brand(brand: str | None) -> str:
    """Lowercase, `ё`→`е`, unify `&`/`and`, collapse spaces and dashes."""
    if not brand:
        return ""
    s = brand.casefold().replace("ё", "е").replace("ö", "o").replace("é", "e")
    s = re.sub(r"\band\b", "&", s)
    s = re.sub(r"[\s\-_.]+", " ", s)
    return s.strip()


def _brand_matches(normalized: str, candidates: tuple[str, ...]) -> bool:
    # Match by whole words: "Apple iPhone 15" → "apple"; "Omega Seamaster" → "omega".
    padded = f" {normalized} "
    return any(f" {normalize_brand(c)} " in padded for c in candidates)


def find_brand_tier(category_code: str, brand: str | None) -> BrandTier | None:
    normalized = normalize_brand(brand)
    if not normalized:
        return None
    for tier in BRAND_TIERS.get(category_code, ()):
        if _brand_matches(normalized, tier.brands):
            return tier
    return None


def jewellery_premium(brand: str | None) -> tuple[float, str | None]:
    normalized = normalize_brand(brand)
    if normalized:
        for factor, label, brands in JEWELLERY_PREMIUMS:
            if _brand_matches(normalized, brands):
                return factor, label
    return 1.0, None


def melt_value(weight_mg: int, fineness: int, price_per_gram_999: int) -> float:
    """Value of pure metal in the item, in tiyn (not rounded)."""
    return weight_mg / 1000 * fineness / 1000 * price_per_gram_999


def confidence_label(confidence: int) -> str:
    if confidence >= 75:
        return "высокая"
    if confidence >= 45:
        return "средняя"
    return "низкая"


def range_half_width(confidence: int) -> float:
    """Relative half-width of the range: 4 % at full confidence, 44 % at zero."""
    return 0.04 + (100 - confidence) / 100 * 0.40


@dataclass(frozen=True)
class EstimateInput:
    category_code: str
    category_name: str
    requires_metal: bool
    ltv_percent: int
    metal: Metal | None = None
    fineness: int | None = None
    weight_mg: int | None = None
    brand: str | None = None
    condition: ItemCondition | None = None
    # Price of 999 metal per gram in tiyn, for the item's metal (if any).
    metal_price_per_gram: int | None = None
    # 0–100 from PhotoAppraiser; None — photos not analysed.
    photo_confidence: int | None = None


@dataclass
class EstimateResult:
    value: int
    value_min: int
    value_max: int
    confidence: int
    method: str
    params_confidence: int
    photo_confidence: int | None
    loan_min: int
    loan_max: int
    steps: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def summary(self) -> str:
        return (
            f"Предварительная оценка {format_kzt(self.value_min)} – "
            f"{format_kzt(self.value_max)}, уверенность {confidence_label(self.confidence)} "
            f"({self.confidence} %)."
        )

    def details(self) -> dict[str, Any]:
        return {
            "version": METHOD_VERSION,
            "method": self.method,
            "params_confidence": self.params_confidence,
            "photo_confidence": self.photo_confidence,
            "confidence_label": confidence_label(self.confidence),
            "loan_estimate": {"min": self.loan_min, "max": self.loan_max},
            "steps": self.steps,
            "warnings": self.warnings,
        }


class EstimateError(ValueError):
    """Not enough data for the formula (e.g. no metal price)."""


def _condition(inp: EstimateInput, table: str, steps: list[dict[str, Any]]) -> tuple[float, int]:
    """Condition factor and a confidence penalty if the condition is unknown."""
    condition = inp.condition or DEFAULT_CONDITION
    factor = CONDITION_FACTORS[table][condition]
    note = "" if inp.condition else " (не указано — принято «Хорошее»)"
    steps.append(
        {
            "label": f"Состояние: {CONDITION_LABELS[condition]}{note}",
            "factor": factor,
        }
    )
    return factor, 0 if inp.condition else 10


def _estimate_metal(inp: EstimateInput, steps: list[dict[str, Any]]) -> tuple[float, int]:
    if inp.metal is None or inp.fineness is None or inp.weight_mg is None:
        raise EstimateError("Для оценки по металлу нужны металл, проба и вес")
    if not inp.metal_price_per_gram:
        raise EstimateError(f"Нет цены на металл «{METAL_LABELS[inp.metal]}»")
    melt = melt_value(inp.weight_mg, inp.fineness, inp.metal_price_per_gram)
    steps.append(
        {
            "label": (
                f"{METAL_LABELS[inp.metal]} {inp.fineness} пробы, "
                f"{inp.weight_mg / 1000:g} г × {format_kzt(inp.metal_price_per_gram)}/г (999)"
            ),
            "amount": round(melt),
        }
    )
    premium, premium_label = jewellery_premium(inp.brand)
    if premium != 1.0:
        steps.append({"label": f"Бренд «{inp.brand}» — {premium_label}", "factor": premium})
    factor, penalty = _condition(inp, "metal", steps)
    return melt * premium * factor, 90 - penalty


def _estimate_brand(
    inp: EstimateInput, steps: list[dict[str, Any]], warnings: list[str]
) -> tuple[float, int]:
    table = inp.category_code if inp.category_code in UNKNOWN_BRAND_VALUE else "generic"
    tier = find_brand_tier(inp.category_code, inp.brand)
    if tier is not None:
        base, params_conf = tier.base_value, tier.params_confidence
        steps.append(
            {"label": f"{inp.category_name}: «{inp.brand}» — {tier.label}", "amount": base}
        )
    else:
        base, params_conf = UNKNOWN_BRAND_VALUE[table], UNKNOWN_BRAND_CONFIDENCE
        what = f"бренд «{inp.brand}» не найден в справочнике" if inp.brand else "бренд не указан"
        steps.append({"label": f"{inp.category_name}: {what}", "amount": base})
        warnings.append("Укажите бренд и модель — это заметно уточнит оценку")
    factor, penalty = _condition(inp, table, steps)
    value = base * factor
    params_conf -= penalty

    # Precious-metal case (gold watch): melt value is a floor.
    if inp.metal and inp.fineness and inp.weight_mg and inp.metal_price_per_gram:
        melt = melt_value(inp.weight_mg, inp.fineness, inp.metal_price_per_gram)
        params_conf += 10
        if melt > value:
            steps.append(
                {
                    "label": (
                        f"Стоимость металла ({METAL_LABELS[inp.metal]} {inp.fineness}, "
                        f"{inp.weight_mg / 1000:g} г) выше — берём её"
                    ),
                    "amount": round(melt),
                }
            )
            value = melt
    return value, params_conf


def estimate(inp: EstimateInput) -> EstimateResult:
    """Compute the pre-estimate. Raises `EstimateError` if the formula has no basis."""
    steps: list[dict[str, Any]] = []
    warnings: list[str] = []
    if inp.requires_metal:
        method = "metal"
        raw, params_conf = _estimate_metal(inp, steps)
    else:
        method = "brand"
        raw, params_conf = _estimate_brand(inp, steps, warnings)

    params_conf = max(0, min(100, params_conf))
    if inp.photo_confidence is None:
        confidence = params_conf * PARAMS_WEIGHT  # no photos — the photo share is lost
        warnings.append("Фото не анализировались")
    else:
        confidence = params_conf * PARAMS_WEIGHT + inp.photo_confidence * PHOTOS_WEIGHT
    confidence_i = int(max(CONFIDENCE_MIN, min(CONFIDENCE_MAX, round(confidence))))

    value = max(round_tiyn(raw), tenge(100))
    half = range_half_width(confidence_i)
    value_min = max(round_tiyn(raw * (1 - half)), tenge(100))
    value_max = max(round_tiyn(raw * (1 + half)), value)
    value_min = min(value_min, value)
    steps.append(
        {
            "label": f"Диапазон ±{round(half * 100)} % при уверенности {confidence_i} %",
            "amount": value,
        }
    )
    loan_min = round_tiyn(value_min * inp.ltv_percent / 100)
    loan_max = round_tiyn(value * inp.ltv_percent / 100)
    return EstimateResult(
        value=value,
        value_min=value_min,
        value_max=value_max,
        confidence=confidence_i,
        method=method,
        params_confidence=params_conf,
        photo_confidence=inp.photo_confidence,
        loan_min=loan_min,
        loan_max=loan_max,
        steps=steps,
        warnings=warnings,
    )


def validate_metal_params(
    category_code: str,
    requires_metal: bool,
    metal: Metal | None,
    fineness: int | None,
) -> list[tuple[str, str]]:
    """Cross-field checks for metal and fineness. Returns `(field, message)` pairs."""
    errors: list[tuple[str, str]] = []
    allowed_metals = CATEGORY_METALS.get(category_code)
    if metal is not None and requires_metal and allowed_metals and metal not in allowed_metals:
        names = ", ".join(METAL_LABELS[m] for m in sorted(allowed_metals))
        errors.append(("metal", f"Для этой категории допустимы металлы: {names}"))
    if fineness is not None:
        if metal is None:
            errors.append(("fineness", "Проба указывается вместе с металлом"))
        elif fineness not in FINENESS_BY_METAL[metal]:
            allowed = ", ".join(str(f) for f in FINENESS_BY_METAL[metal])
            errors.append(
                (
                    "fineness",
                    f"Проба {fineness} не используется для металла "
                    f"«{METAL_LABELS[metal]}». Допустимо: {allowed}",
                )
            )
    return errors
