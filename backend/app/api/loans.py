"""Disbursement, loans (pledge tickets), repayment, extension and item return."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse

from app.api.applications import CardViewDep
from app.api.loan_views import loan_read
from app.api.logistics import ClientOrAdmin, visit_input
from app.core.deps import (
    ClockDep,
    PaymentGatewayDep,
    SessionDep,
    SettingsDep,
    require_role,
)
from app.domain.enums import LoanStatus, Role
from app.models import User
from app.schemas.application import ApplicationRead
from app.schemas.loan import CardBody, ExtendBody, ExtensionQuoteRead, LoanRead
from app.schemas.logistics import VisitCreate
from app.services import applications as app_svc
from app.services import loans as svc
from app.services.loans import PaymentDeclinedError
from app.services.ticket import render_ticket

LoanReader = Annotated[User, Depends(require_role(Role.CLIENT, Role.ADMIN))]
ClientOnly = Annotated[User, Depends(require_role(Role.CLIENT))]

# --- Application steps: payout and item return --------------------------------------------

application_router = APIRouter(prefix="/applications", tags=["loans"])


@application_router.post(
    "/{application_id}/payout",
    response_model=ApplicationRead,
    summary="Получить деньги на карту после осмотра → займ (залоговый билет)",
    responses={402: {"description": "Банк отклонил перевод (мок)"}},
)
def payout(
    application_id: int,
    data: CardBody,
    session: SessionDep,
    card: CardViewDep,
    user: ClientOrAdmin,
    gateway: PaymentGatewayDep,
) -> ApplicationRead:
    app = app_svc.get_application(session, application_id, user)
    svc.issue_funds(session, app, user, data.card_number, gateway=gateway, now=card.now)
    session.commit()
    return card(app, user)


@application_router.post(
    "/{application_id}/return",
    response_model=ApplicationRead,
    summary="После погашения: вызвать курьера, чтобы вернуть изделие",
)
def schedule_return(
    application_id: int,
    data: VisitCreate,
    session: SessionDep,
    card: CardViewDep,
    user: ClientOrAdmin,
    settings: SettingsDep,
) -> ApplicationRead:
    app = app_svc.get_application(session, application_id, user)
    svc.schedule_return(
        session,
        app,
        user,
        visit_input(data, app.client),
        now=card.now,
        rules=settings.slot_rules,
    )
    session.commit()
    return card(app, user)


# --- Loans --------------------------------------------------------------------------------

router = APIRouter(prefix="/loans", tags=["loans"])


@router.get("", response_model=list[LoanRead], summary="Займы (клиент — свои, админ — все)")
def list_loans(
    session: SessionDep,
    user: LoanReader,
    settings: SettingsDep,
    clock: ClockDep,
    status: LoanStatus | None = None,
) -> list[LoanRead]:
    now = clock.now()
    loans = svc.list_loans(session, user, status)
    if any(svc.sync_loan(session, loan, now, settings.grace_period_days) for loan in loans):
        session.commit()
        loans = [loan for loan in loans if status is None or loan.status is status]
    return [loan_read(loan, user, now, settings) for loan in loans]


@router.get("/{loan_id}", response_model=LoanRead, summary="Займ: суммы на сегодня, платежи")
def get_loan(
    loan_id: int, session: SessionDep, user: LoanReader, settings: SettingsDep, clock: ClockDep
) -> LoanRead:
    now = clock.now()
    loan = svc.get_loan(session, loan_id, user)
    if svc.sync_loan(session, loan, now, settings.grace_period_days):
        session.commit()
    return loan_read(loan, user, now, settings)


@router.get(
    "/{loan_id}/ticket",
    response_class=HTMLResponse,
    summary="Залоговый билет (HTML для печати; «Сохранить как PDF» в браузере)",
)
def get_ticket(
    loan_id: int,
    session: SessionDep,
    user: LoanReader,
    settings: SettingsDep,
    clock: ClockDep,
    download: Annotated[bool, Query(description="Отдать как файл")] = False,
) -> HTMLResponse:
    now = clock.now()
    loan = svc.get_loan(session, loan_id, user)
    if svc.sync_loan(session, loan, now, settings.grace_period_days):
        session.commit()
    html = render_ticket(loan, now, settings.grace_period_days)
    headers = {}
    if download:
        name = loan.ticket_number.encode("ascii", "ignore").decode().strip("-") or "ticket"
        headers["Content-Disposition"] = f'attachment; filename="ticket-{name}.html"'
    return HTMLResponse(html, headers=headers)


@router.get(
    "/{loan_id}/extension",
    response_model=ExtensionQuoteRead,
    summary="Сколько стоит продление на выбранный срок",
)
def extension_quote(
    loan_id: int,
    session: SessionDep,
    user: LoanReader,
    settings: SettingsDep,
    clock: ClockDep,
    term_days: Annotated[int | None, Query(ge=1, le=365)] = None,
) -> ExtensionQuoteRead:
    now = clock.now()
    loan = svc.get_loan(session, loan_id, user)
    if svc.sync_loan(session, loan, now, settings.grace_period_days):
        session.commit()
    q = svc.extension_quote(
        loan,
        term_days,
        now,
        max_extensions=settings.max_loan_extensions,
        grace_days=settings.grace_period_days,
    )
    return ExtensionQuoteRead(
        term_days=q.term_days,
        pay_now=q.pay_now,
        days_used=q.days_used,
        new_due_date=q.new_due_date,  # type: ignore[arg-type]
        total_at_new_due=q.total_at_new_due,
        extensions_left=q.extensions_left,
    )


@router.post(
    "/{loan_id}/repay",
    response_model=LoanRead,
    summary="Погасить займ полностью: тело + проценты за фактические дни",
    responses={402: {"description": "Оплата не прошла (мок-банк)"}},
)
def repay(
    loan_id: int,
    data: CardBody,
    session: SessionDep,
    user: ClientOnly,
    settings: SettingsDep,
    clock: ClockDep,
    gateway: PaymentGatewayDep,
) -> LoanRead:
    now = clock.now()
    loan = svc.get_loan(session, loan_id, user)
    try:
        svc.repay(
            session,
            loan,
            user,
            data.card_number,
            gateway=gateway,
            now=now,
            grace_days=settings.grace_period_days,
        )
    except PaymentDeclinedError:
        session.commit()  # keep the failed payment (and a status sync) in the history
        raise
    session.commit()
    return loan_read(loan, user, now, settings)


@router.post(
    "/{loan_id}/extend",
    response_model=LoanRead,
    summary="Продлить займ: оплатить начисленные проценты, новый срок — от сегодня",
    responses={402: {"description": "Оплата не прошла (мок-банк)"}},
)
def extend(
    loan_id: int,
    data: ExtendBody,
    session: SessionDep,
    user: ClientOnly,
    settings: SettingsDep,
    clock: ClockDep,
    gateway: PaymentGatewayDep,
) -> LoanRead:
    now = clock.now()
    loan = svc.get_loan(session, loan_id, user)
    try:
        svc.extend(
            session,
            loan,
            user,
            data.card_number,
            data.term_days,
            gateway=gateway,
            now=now,
            max_extensions=settings.max_loan_extensions,
            grace_days=settings.grace_period_days,
        )
    except PaymentDeclinedError:
        session.commit()
        raise
    session.commit()
    return loan_read(loan, user, now, settings)
