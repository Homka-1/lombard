"""Expert review and the loan offer: queue, take, offer / need-info / reject, client decision.

Functions do not commit; the API layer commits.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domain.enums import ApplicationStatus, AppraisalKind, OfferStatus, Role
from app.domain.loan_calc import CategoryTerms, LoanQuote, max_loan_amount, quote, validate_terms
from app.domain.logistics import KZ_TZ
from app.domain.money import format_kzt
from app.models import Application, Appraisal, Category, Offer, User
from app.models.base import utcnow
from app.services.applications import latest_auto_appraisal
from app.services.errors import ConflictError, ForbiddenError, Problem, ValidationProblems
from app.services.notifications import notify
from app.services.status import change_status

S = ApplicationStatus

EXPERT_DEFAULT_CONFIDENCE = 90
REVIEW_STATUSES = frozenset({S.UNDER_REVIEW, S.NEED_INFO, S.OFFER_SENT})


def local_today(now: datetime | None = None) -> date:
    return (now or utcnow()).astimezone(KZ_TZ).date()


def category_terms(category: Category) -> CategoryTerms:
    return CategoryTerms(
        name=category.name,
        ltv_percent=category.ltv_percent,
        daily_rate_bp=category.daily_rate_bp,
        min_term_days=category.min_term_days,
        max_term_days=category.max_term_days,
    )


# --- Queue --------------------------------------------------------------------------------


class QueueScope(StrEnum):
    NEW = "new"  # waiting for an expert (PRE_ESTIMATED)
    MINE = "mine"  # taken by me: under review, waiting for photos, offer sent
    INSPECTION = "inspection"  # delivered to the pawnshop, waiting for an in-person check
    ALL = "all"  # everything in the review stage


def expert_queue(session: Session, user: User, scope: QueueScope) -> list[Application]:
    """Applications for the expert screen. Oldest submissions first (FIFO)."""
    stmt = select(Application).options(
        selectinload(Application.category),
        selectinload(Application.photos),
        selectinload(Application.appraisals),
        selectinload(Application.client),
        selectinload(Application.expert),
    )
    if scope is QueueScope.NEW:
        stmt = stmt.where(Application.status == S.PRE_ESTIMATED)
    elif scope is QueueScope.INSPECTION:
        stmt = stmt.where(Application.status == S.ITEM_DELIVERED)
    elif scope is QueueScope.MINE:
        stmt = stmt.where(Application.status.in_(REVIEW_STATUSES))
        if user.role is Role.EXPERT:
            stmt = stmt.where(Application.expert_id == user.id)
    else:
        stmt = stmt.where(Application.status.in_(REVIEW_STATUSES | {S.PRE_ESTIMATED}))
    stmt = stmt.order_by(Application.submitted_at.asc(), Application.id.asc())
    return list(session.scalars(stmt))


# --- Expert actions -----------------------------------------------------------------------


def take_application(session: Session, app: Application, expert: User) -> None:
    """PRE_ESTIMATED → UNDER_REVIEW; the expert becomes responsible for the application."""
    if app.status is S.UNDER_REVIEW:
        if app.expert_id == expert.id:
            return  # idempotent
        raise ConflictError("Заявку уже взял в работу другой эксперт")
    change_status(session, app, S.UNDER_REVIEW, user=expert, comment="Эксперт взял в работу")
    app.expert = expert
    session.flush()


def ensure_assigned(app: Application, expert: User) -> None:
    if app.status is not S.UNDER_REVIEW:
        raise ConflictError("Сначала возьмите заявку в работу")
    if app.expert_id != expert.id:
        raise ForbiddenError("Заявку ведёт другой эксперт")


@dataclass(frozen=True)
class OfferInput:
    market_value: int
    ltv_percent: int
    daily_rate_bp: int
    term_days: int
    loan_amount: int | None = None  # None — maximum for the LTV
    value_min: int | None = None
    value_max: int | None = None
    confidence: int | None = None
    hallmark_confirmed: bool | None = None
    comment: str | None = None


def build_quote(category: Category, data: OfferInput, today: date) -> LoanQuote:
    """Validate the terms against the category and compute the loan. Raises 422."""
    errors = validate_terms(
        category_terms(category),
        market_value=data.market_value,
        ltv_percent=data.ltv_percent,
        daily_rate_bp=data.daily_rate_bp,
        term_days=data.term_days,
        loan_amount=data.loan_amount,
    )
    if data.value_min is not None and data.value_min > data.market_value:
        errors.append(("value_min", "Нижняя граница не больше рыночной стоимости"))
    if data.value_max is not None and data.value_max < data.market_value:
        errors.append(("value_max", "Верхняя граница не меньше рыночной стоимости"))
    if errors:
        raise ValidationProblems([Problem(f, m) for f, m in errors], "Проверьте условия займа")
    amount = data.loan_amount
    if amount is None:
        amount = max_loan_amount(data.market_value, data.ltv_percent)
    return quote(amount, data.daily_rate_bp, data.term_days, today)


def preview_offer(app: Application, expert: User, data: OfferInput) -> LoanQuote:
    """Live calculator on the expert screen: same checks as `send_offer`, nothing saved."""
    ensure_assigned(app, expert)
    return build_quote(app.category, data, local_today())


def current_offer(app: Application) -> Offer | None:
    """The latest offer of the application (any status)."""
    return max(app.offers, key=lambda o: (o.created_at, o.id)) if app.offers else None


def latest_expert_appraisal(app: Application) -> Appraisal | None:
    experts = [a for a in app.appraisals if a.kind is AppraisalKind.EXPERT]
    return max(experts, key=lambda a: (a.created_at, a.id)) if experts else None


def send_offer(
    session: Session,
    app: Application,
    expert: User,
    data: OfferInput,
    *,
    ttl_hours: int,
    now: datetime | None = None,
) -> Offer:
    """Expert appraisal + loan terms → OFFER_SENT. The client is notified."""
    ensure_assigned(app, expert)
    now = now or utcnow()
    terms = build_quote(app.category, data, local_today(now))
    auto = latest_auto_appraisal(app)

    details: dict = {
        "ltv_percent": data.ltv_percent,
        "category_ltv_percent": app.category.ltv_percent,
        "max_loan_amount": max_loan_amount(data.market_value, data.ltv_percent),
        "hallmark_confirmed": data.hallmark_confirmed,
    }
    if auto is not None:
        details["auto_appraisal_id"] = auto.id
        details["auto_value"] = auto.value
        details["deviation_percent"] = round((data.market_value - auto.value) / auto.value * 100, 1)
    appraisal = Appraisal(
        kind=AppraisalKind.EXPERT,
        appraiser_id=expert.id,
        value=data.market_value,
        value_min=data.value_min if data.value_min is not None else data.market_value,
        value_max=data.value_max if data.value_max is not None else data.market_value,
        confidence=data.confidence if data.confidence is not None else EXPERT_DEFAULT_CONFIDENCE,
        comment=data.comment,
        details=details,
    )
    app.appraisals.append(appraisal)

    for old in app.offers:
        if old.status is OfferStatus.SENT:
            old.status = OfferStatus.SUPERSEDED
    offer = Offer(
        appraisal=appraisal,
        expert_id=expert.id,
        loan_amount=terms.loan_amount,
        daily_rate_bp=terms.daily_rate_bp,
        term_days=terms.term_days,
        total_to_repay=terms.total_to_repay,
        status=OfferStatus.SENT,
        comment=data.comment,
        expires_at=now + timedelta(hours=ttl_hours),
        created_at=now,
    )
    app.offers.append(offer)
    session.add_all([appraisal, offer])

    change_status(session, app, S.OFFER_SENT, user=expert, comment=terms.summary)
    notify(
        session,
        app.client_id,
        f"Предложение по заявке {app.number}",
        f"Эксперт оценил изделие в {format_kzt(data.market_value)}. "
        f"Готовы выдать {format_kzt(terms.loan_amount)} на {terms.term_days} дн. "
        f"Предложение действует до {offer.expires_at.astimezone(KZ_TZ):%d.%m.%Y %H:%M}.",
        application=app,
    )
    session.flush()
    return offer


def _require_comment(comment: str | None, field: str, message: str) -> str:
    text = (comment or "").strip()
    if len(text) < 5:
        raise ValidationProblems([Problem(field, message)])
    return text


def request_info(session: Session, app: Application, expert: User, comment: str | None) -> None:
    """UNDER_REVIEW → NEED_INFO: the client must add photos or details and resubmit."""
    ensure_assigned(app, expert)
    text = _require_comment(comment, "comment", "Напишите клиенту, что нужно добавить")
    change_status(session, app, S.NEED_INFO, user=expert, comment=text)
    notify(
        session,
        app.client_id,
        f"Нужны дополнения к заявке {app.number}",
        text,
        application=app,
    )


def reject_application(
    session: Session, app: Application, expert: User, reason: str | None
) -> None:
    """UNDER_REVIEW → REJECTED (terminal)."""
    ensure_assigned(app, expert)
    text = _require_comment(reason, "reason", "Укажите причину отказа")
    change_status(session, app, S.REJECTED, user=expert, comment=text)
    notify(session, app.client_id, f"Заявка {app.number} отклонена", text, application=app)


# --- Client decision ----------------------------------------------------------------------


class OfferExpiredError(ConflictError):
    """The offer expired; the application was moved to OFFER_DECLINED (commit, then 409)."""


def _active_offer(app: Application) -> Offer:
    offer = current_offer(app)
    if app.status is not S.OFFER_SENT or offer is None or offer.status is not OfferStatus.SENT:
        raise ConflictError("Нет действующего предложения по заявке")
    return offer


def expire_offer_if_needed(session: Session, app: Application, now: datetime | None = None) -> bool:
    """Expire an overdue offer: offer → EXPIRED, application → OFFER_DECLINED (system)."""
    if app.status is not S.OFFER_SENT:
        return False
    offer = current_offer(app)
    now = now or utcnow()
    if offer is None or offer.expires_at is None or offer.expires_at > now:
        return False
    offer.status = OfferStatus.EXPIRED
    offer.decided_at = now
    change_status(session, app, S.OFFER_DECLINED, comment="Срок действия предложения истёк")
    notify(
        session,
        app.client_id,
        f"Предложение по заявке {app.number} истекло",
        "Срок действия предложения закончился. Создайте новую заявку, если займ ещё нужен.",
        application=app,
    )
    return True


def expire_offers(session: Session, now: datetime | None = None) -> int:
    """Expire all overdue offers (for a periodic job / time simulation). Returns the count."""
    now = now or utcnow()
    apps = session.scalars(
        select(Application)
        .join(Offer, Offer.application_id == Application.id)
        .where(
            Application.status == S.OFFER_SENT,
            Offer.status == OfferStatus.SENT,
            Offer.expires_at <= now,
        )
        .options(selectinload(Application.offers))
    ).unique()
    return sum(expire_offer_if_needed(session, app, now) for app in apps)


def accept_offer(
    session: Session, app: Application, client: User, now: datetime | None = None
) -> Offer:
    """OFFER_SENT → OFFER_ACCEPTED. Raises `OfferExpiredError` if the offer has expired."""
    now = now or utcnow()
    if expire_offer_if_needed(session, app, now):
        raise OfferExpiredError("Срок действия предложения истёк")
    offer = _active_offer(app)
    offer.status = OfferStatus.ACCEPTED
    offer.decided_at = now
    change_status(
        session,
        app,
        S.OFFER_ACCEPTED,
        user=client,
        comment=f"Клиент принял предложение: {format_kzt(offer.loan_amount)}",
    )
    if app.expert_id is not None:
        notify(
            session,
            app.expert_id,
            f"Предложение по заявке {app.number} принято",
            f"Клиент согласился на {format_kzt(offer.loan_amount)}. Следующий шаг — курьер.",
            application=app,
        )
    session.flush()
    return offer


def decline_offer(
    session: Session,
    app: Application,
    client: User,
    reason: str | None = None,
    now: datetime | None = None,
) -> Offer:
    """OFFER_SENT → OFFER_DECLINED (terminal)."""
    now = now or utcnow()
    if expire_offer_if_needed(session, app, now):
        raise OfferExpiredError("Срок действия предложения истёк")
    offer = _active_offer(app)
    offer.status = OfferStatus.DECLINED
    offer.decided_at = now
    text = (reason or "").strip() or None
    change_status(
        session,
        app,
        S.OFFER_DECLINED,
        user=client,
        comment=f"Клиент отказался: {text}" if text else "Клиент отказался от предложения",
    )
    if app.expert_id is not None:
        notify(
            session,
            app.expert_id,
            f"Отказ по заявке {app.number}",
            text or "Клиент отказался от предложения без комментария.",
            application=app,
        )
    session.flush()
    return offer
