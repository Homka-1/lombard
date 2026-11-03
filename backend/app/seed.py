"""Seed reference data and demo users. Idempotent: safe to run repeatedly.

    python -m app.seed            # uses LOMBARD_DATABASE_URL
    python -m app.seed --reset-passwords

Prices and rates are educational, not real market quotes.
"""

import argparse
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import make_engine, make_session_factory
from app.core.security import hash_password, verify_password
from app.domain.enums import ApplicationStatus, ItemCondition, Metal, Role
from app.models import Application, Category, MetalPrice, StatusHistory, User

DEMO_PASSWORD = "demo1234"

# code, name, ltv %, rate bp/day, min term, max term, requires metal, description
CATEGORIES: list[tuple[str, str, int, int, int, int, bool, str]] = [
    ("gold", "Золото", 80, 25, 7, 60, True, "Кольца, серьги, цепи, браслеты, слитки"),
    ("silver", "Серебро", 70, 30, 7, 60, True, "Украшения и столовое серебро"),
    ("platinum", "Платина и палладий", 75, 25, 7, 60, True, "Украшения из платины"),
    ("watches", "Часы", 60, 30, 7, 60, False, "Швейцарские и японские часы с документами"),
    ("electronics", "Электроника", 50, 40, 7, 30, False, "Смартфоны, ноутбуки, планшеты"),
]

# Price of 999 metal per gram, in tiyn (1 ₸ = 100 tiyn).
METAL_PRICES: dict[Metal, int] = {
    Metal.GOLD: 66_500_00,
    Metal.SILVER: 820_00,
    Metal.PLATINUM: 26_000_00,
    Metal.PALLADIUM: 23_500_00,
}
PRICES_EFFECTIVE_FROM = datetime(2026, 11, 1, tzinfo=UTC)


@dataclass(frozen=True)
class DemoUser:
    email: str
    full_name: str
    role: Role
    phone: str
    city: str | None = None


DEMO_USERS: list[DemoUser] = [
    DemoUser("client@lombard.kz", "Айгерим Садыкова", Role.CLIENT, "+77011234567", "Алматы"),
    DemoUser("client2@lombard.kz", "Данияр Ахметов", Role.CLIENT, "+77771234568", "Астана"),
    DemoUser("expert@lombard.kz", "Ерлан Касымов", Role.EXPERT, "+77052223344", "Алматы"),
    DemoUser("courier@lombard.kz", "Нурлан Жумабаев", Role.COURIER, "+77475556677", "Алматы"),
    DemoUser("courier2@lombard.kz", "Асель Нурланова", Role.COURIER, "+77758889900", "Астана"),
    DemoUser("admin@lombard.kz", "Гульнара Беккожина", Role.ADMIN, "+77273001020", "Алматы"),
]


@dataclass
class SeedReport:
    created: dict[str, int] = field(default_factory=dict)

    def add(self, kind: str, n: int = 1) -> None:
        self.created[kind] = self.created.get(kind, 0) + n

    def __str__(self) -> str:
        if not self.created:
            return "Seed: всё уже на месте, изменений нет."
        parts = ", ".join(f"{k}: +{v}" for k, v in sorted(self.created.items()))
        return f"Seed: {parts}"


def seed_categories(session: Session, report: SeedReport) -> dict[str, Category]:
    existing = {c.code: c for c in session.scalars(select(Category))}
    for order, (code, name, ltv, rate, tmin, tmax, metal, desc) in enumerate(CATEGORIES):
        if code in existing:
            continue
        cat = Category(
            code=code,
            name=name,
            ltv_percent=ltv,
            daily_rate_bp=rate,
            min_term_days=tmin,
            max_term_days=tmax,
            requires_metal=metal,
            description=desc,
            sort_order=order * 10,
        )
        session.add(cat)
        existing[code] = cat
        report.add("categories")
    return existing


def seed_metal_prices(session: Session, report: SeedReport) -> None:
    for metal, price in METAL_PRICES.items():
        found = session.scalar(
            select(MetalPrice).where(
                MetalPrice.metal == metal, MetalPrice.effective_from == PRICES_EFFECTIVE_FROM
            )
        )
        if found is None:
            session.add(
                MetalPrice(
                    metal=metal,
                    price_per_gram=price,
                    effective_from=PRICES_EFFECTIVE_FROM,
                    source="seed",
                )
            )
            report.add("metal_prices")


def seed_users(session: Session, report: SeedReport, *, reset_passwords: bool) -> dict[str, User]:
    users: dict[str, User] = {}
    for demo in DEMO_USERS:
        user = session.scalar(select(User).where(User.email == demo.email))
        if user is None:
            user = User(
                email=demo.email,
                full_name=demo.full_name,
                role=demo.role,
                phone=demo.phone,
                city=demo.city,
                password_hash=hash_password(DEMO_PASSWORD),
            )
            session.add(user)
            report.add("users")
        elif reset_passwords and not verify_password(DEMO_PASSWORD, user.password_hash):
            user.password_hash = hash_password(DEMO_PASSWORD)
            report.add("password_resets")
        users[demo.email] = user
    return users


def seed_demo_application(
    session: Session, report: SeedReport, client: User, gold: Category
) -> None:
    """One draft application so the client cabinet is not empty."""
    session.flush()
    if session.scalar(select(Application.id).where(Application.client_id == client.id)):
        return
    app = Application(
        client=client,
        category=gold,
        title="Кольцо с бриллиантом",
        description="Золотое кольцо 585 пробы, бриллиант 0,2 карат, есть бирка.",
        metal=Metal.GOLD,
        fineness=585,
        weight_mg=3520,
        condition=ItemCondition.EXCELLENT,
        requested_amount=150_000_00,
    )
    app.history.append(
        StatusHistory(
            from_status=None,
            to_status=ApplicationStatus.DRAFT,
            actor=client,
            actor_role=client.role,
            comment="Заявка создана",
        )
    )
    session.add(app)
    report.add("applications")


def run_seed(session: Session, *, reset_passwords: bool = False) -> SeedReport:
    report = SeedReport()
    categories = seed_categories(session, report)
    seed_metal_prices(session, report)
    users = seed_users(session, report, reset_passwords=reset_passwords)
    seed_demo_application(session, report, users["client@lombard.kz"], categories["gold"])
    session.commit()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Заполнить БД справочниками и демо-аккаунтами")
    parser.add_argument(
        "--reset-passwords",
        action="store_true",
        help=f"вернуть демо-аккаунтам пароль «{DEMO_PASSWORD}»",
    )
    args = parser.parse_args()

    settings = Settings()
    engine = make_engine(settings.database_url)
    factory = make_session_factory(engine)
    with factory() as session:
        print(run_seed(session, reset_passwords=args.reset_passwords))
    engine.dispose()
    print(f"Демо-аккаунты (пароль «{DEMO_PASSWORD}»):")
    for demo in DEMO_USERS:
        print(f"  {demo.role.value:<8} {demo.email}")


if __name__ == "__main__":
    main()
