"""Expert workspace: review queue, taking an application, offer / need-info / reject."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.applications import CardViewDep, list_item
from app.api.offer_views import quote_read
from app.core.deps import (
    ClockDep,
    ExpertUser,
    PhotoSignerDep,
    SessionDep,
    SettingsDep,
    require_role,
)
from app.domain.enums import Role
from app.models import Application, User
from app.schemas.application import ApplicationRead
from app.schemas.logistics import InspectionCreate, InspectionPreview
from app.schemas.offer import LoanQuoteRead, UserBrief
from app.schemas.review import CommentBody, OfferCreate, OfferTerms, QueueItem, RejectBody
from app.services import applications as svc
from app.services import inspection, review
from app.storage.photos import PhotoUrlSigner

router = APIRouter(prefix="/expert", tags=["expert"])

# Actions change the status on behalf of the expert: admins can watch the queue but not act.
ExpertOnly = Annotated[User, Depends(require_role(Role.EXPERT))]


def queue_item(app: Application, signer: PhotoUrlSigner) -> QueueItem:
    base = list_item(app, signer)
    pre = svc.latest_auto_appraisal(app)
    return QueueItem(
        **base.model_dump(),
        client=UserBrief.model_validate(app.client),
        expert=UserBrief.model_validate(app.expert) if app.expert else None,
        pre_estimate_value=pre.value if pre else None,
        pre_estimate_confidence=pre.confidence if pre else None,
        requested_amount=app.requested_amount,
    )


def offer_input(
    data: OfferTerms, app: Application, comment: str | None = None
) -> review.OfferInput:
    category = app.category
    return review.OfferInput(
        market_value=data.market_value,
        ltv_percent=data.ltv_percent if data.ltv_percent is not None else category.ltv_percent,
        daily_rate_bp=(
            data.daily_rate_bp if data.daily_rate_bp is not None else category.daily_rate_bp
        ),
        term_days=data.term_days,
        loan_amount=data.loan_amount,
        value_min=data.value_min,
        value_max=data.value_max,
        confidence=data.confidence,
        hallmark_confirmed=data.hallmark_confirmed,
        comment=(comment or "").strip() or None,
    )


@router.get(
    "/queue",
    response_model=list[QueueItem],
    summary=(
        "Очередь эксперта: new — ждут эксперта, mine — мои в работе, "
        "inspection — ждут осмотра в ломбарде, all — все"
    ),
)
def get_queue(
    session: SessionDep,
    user: ExpertUser,
    signer: PhotoSignerDep,
    scope: Annotated[review.QueueScope, Query()] = review.QueueScope.NEW,
) -> list[QueueItem]:
    return [queue_item(a, signer) for a in review.expert_queue(session, user, scope)]


@router.post(
    "/applications/{application_id}/take",
    response_model=ApplicationRead,
    summary="Взять заявку в работу",
)
def take(
    application_id: int,
    session: SessionDep,
    card: CardViewDep,
    user: ExpertOnly,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    review.take_application(session, app, user)
    session.commit()
    return card(app, user)


@router.post(
    "/applications/{application_id}/quote",
    response_model=LoanQuoteRead,
    summary="Живой калькулятор: условия займа без сохранения",
)
def preview(
    application_id: int,
    data: OfferTerms,
    session: SessionDep,
    user: ExpertOnly,
) -> LoanQuoteRead:
    app = svc.get_application(session, application_id, user)
    return quote_read(review.preview_offer(app, user, offer_input(data, app)))


@router.post(
    "/applications/{application_id}/offer",
    response_model=ApplicationRead,
    summary="Экспертная оценка и предложение клиенту",
)
def send_offer(
    application_id: int,
    data: OfferCreate,
    session: SessionDep,
    card: CardViewDep,
    user: ExpertOnly,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    review.send_offer(
        session, app, user, offer_input(data, app, data.comment), ttl_hours=settings.offer_ttl_hours
    )
    session.commit()
    return card(app, user)


@router.post(
    "/applications/{application_id}/need-info",
    response_model=ApplicationRead,
    summary="Запросить у клиента дополнительные фото или сведения",
)
def need_info(
    application_id: int,
    data: CommentBody,
    session: SessionDep,
    card: CardViewDep,
    user: ExpertOnly,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    review.request_info(session, app, user, data.comment)
    session.commit()
    return card(app, user)


@router.post(
    "/applications/{application_id}/reject",
    response_model=ApplicationRead,
    summary="Отклонить заявку",
)
def reject(
    application_id: int,
    data: RejectBody,
    session: SessionDep,
    card: CardViewDep,
    user: ExpertOnly,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    review.reject_application(session, app, user, data.reason)
    session.commit()
    return card(app, user)


# --- Inspection after delivery ------------------------------------------------------------


def inspection_input(data: InspectionCreate) -> inspection.InspectionInput:
    return inspection.InspectionInput(
        market_value=data.market_value,
        loan_amount=data.loan_amount,
        hallmark_confirmed=data.hallmark_confirmed,
        weight_g=data.weight_g,
        comment=data.comment,
    )


@router.post(
    "/applications/{application_id}/inspection/quote",
    response_model=InspectionPreview,
    summary="Осмотр: расчёт итоговой суммы без сохранения",
)
def preview_inspection(
    application_id: int,
    data: InspectionCreate,
    session: SessionDep,
    user: ExpertOnly,
    clock: ClockDep,
) -> InspectionPreview:
    app = svc.get_application(session, application_id, user)
    plan = inspection.plan_inspection(app, inspection_input(data), clock.now())
    return InspectionPreview(
        market_value=plan.market_value,
        offer_loan_amount=plan.offer.loan_amount,
        adjusted=plan.adjusted,
        quote=quote_read(plan.quote),
    )


@router.post(
    "/applications/{application_id}/inspection",
    response_model=ApplicationRead,
    summary="Осмотр доставленного изделия: подтвердить (или уменьшить) сумму займа",
)
def inspect(
    application_id: int,
    data: InspectionCreate,
    session: SessionDep,
    card: CardViewDep,
    user: ExpertOnly,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    inspection.inspect(session, app, user, inspection_input(data), now=card.now)
    session.commit()
    return card(app, user)
