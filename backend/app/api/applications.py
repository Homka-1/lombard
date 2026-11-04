"""Client applications: CRUD, photos, submission with automatic pre-estimate."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status

from app.api.loan_views import loan_summary_read
from app.api.offer_views import offer_read
from app.core.config import Settings
from app.core.deps import (
    ApplicationReader,
    ClientUser,
    ClockDep,
    PhotoAppraiserDep,
    PhotoSignerDep,
    PhotoStorageDep,
    SessionDep,
    SettingsDep,
)
from app.domain.enums import (
    ApplicationStatus,
    CourierTaskKind,
    CourierTaskStatus,
    OfferStatus,
    Role,
)
from app.domain.logistics import TASK_KIND_LABELS, TASK_STATUS_LABELS, Slot
from app.domain.phone import format_kz_phone
from app.domain.state_machine import STATUS_LABELS
from app.models import Application, CourierTask, Photo, StatusHistory, User
from app.models.base import utcnow
from app.schemas.application import (
    ApplicationCreate,
    ApplicationListItem,
    ApplicationRead,
    ApplicationUpdate,
    AppraisalRead,
    CategoryBrief,
    PhotoOrder,
    PhotoRead,
    StatusHistoryRead,
)
from app.schemas.logistics import CourierVisitRead
from app.schemas.offer import UserBrief
from app.schemas.review import DeclineBody
from app.services import applications as svc
from app.services import inspection, loans, logistics, review
from app.storage.photos import PhotoStorage, PhotoUrlSigner, PhotoVariant

router = APIRouter(prefix="/applications", tags=["applications"])


# --- Serialisation ------------------------------------------------------------------------


def photo_read(photo: Photo, signer: PhotoUrlSigner) -> PhotoRead:
    return PhotoRead(
        id=photo.id,
        position=photo.position,
        original_name=photo.original_name,
        content_type=photo.content_type,
        size_bytes=photo.size_bytes,
        width=photo.width,
        height=photo.height,
        quality_score=photo.quality_score,
        url=signer.url(photo.id, PhotoVariant.FULL),
        thumb_url=signer.url(photo.id, PhotoVariant.THUMB),
        created_at=photo.created_at,
    )


def history_read(entry: StatusHistory) -> StatusHistoryRead:
    return StatusHistoryRead(
        id=entry.id,
        from_status=entry.from_status,
        to_status=entry.to_status,
        to_status_label=STATUS_LABELS[entry.to_status],
        actor_role=entry.actor_role,
        comment=entry.comment,
        created_at=entry.created_at,
    )


def visit_read(task: CourierTask) -> CourierVisitRead:
    return CourierVisitRead(
        id=task.id,
        kind=task.kind,
        kind_label=TASK_KIND_LABELS[task.kind],
        status=task.status,
        status_label=TASK_STATUS_LABELS[task.status],
        courier=UserBrief.model_validate(task.courier) if task.courier else None,
        city=task.city,
        address=task.address,
        contact_phone=task.contact_phone,
        contact_phone_display=format_kz_phone(task.contact_phone),
        slot_start=task.slot_start,
        slot_end=task.slot_end,
        slot_label=Slot(task.slot_start, task.slot_end).label,
        comment=task.comment,
        completed_at=task.completed_at,
    )


def _courier_actions(app: Application) -> list[str]:
    S = ApplicationStatus
    if app.status is S.OFFER_ACCEPTED:
        return ["schedule_courier"]
    task = logistics.current_task(app, CourierTaskKind.PICKUP)
    if (
        app.status is S.COURIER_SCHEDULED
        and task is not None
        and task.status is CourierTaskStatus.SCHEDULED
    ):
        return ["reschedule_courier"]
    return []


def _loan_actions(app: Application) -> list[str]:
    S = ApplicationStatus
    if app.status is S.INSPECTED and app.loan is None:
        return ["issue_funds"]
    if app.status in (S.LOAN_ACTIVE, S.OVERDUE):
        return ["repay", "extend"]
    if loans.can_schedule_return(app):
        return ["schedule_return"]
    return []


def available_actions(app: Application, viewer: User) -> list[str]:
    """What `viewer` can do with the application right now (for the UI)."""
    S = ApplicationStatus
    actions: list[str] = []
    if viewer.role is Role.CLIENT and app.client_id == viewer.id:
        if svc.is_editable(app):
            actions += ["edit", "submit"]
        if app.status is S.DRAFT:
            actions.append("delete")
        offer = review.current_offer(app)
        if app.status is S.OFFER_SENT and offer is not None and offer.status is OfferStatus.SENT:
            actions += ["accept_offer", "decline_offer"]
        actions += _courier_actions(app)
        actions += _loan_actions(app)
    elif viewer.role is Role.EXPERT:
        if app.status is S.PRE_ESTIMATED:
            actions.append("take")
        elif app.status is S.UNDER_REVIEW and app.expert_id == viewer.id:
            actions += ["send_offer", "request_info", "reject"]
        elif app.status is S.ITEM_DELIVERED:
            actions.append("inspect")
    elif viewer.role is Role.ADMIN:
        actions += _courier_actions(app)
        actions += [a for a in _loan_actions(app) if a == "issue_funds"]
    return actions


def application_read(
    app: Application,
    signer: PhotoUrlSigner,
    max_photos: int,
    viewer: User,
    *,
    now: datetime | None = None,
    settings: Settings | None = None,
) -> ApplicationRead:
    pre = svc.latest_auto_appraisal(app)
    expert_appraisal = review.latest_expert_appraisal(app)
    offer = review.current_offer(app)
    visit = logistics.current_task(app)
    inspected = inspection.latest_inspection(app)
    photos = sorted(app.photos, key=lambda p: p.position)
    return ApplicationRead(
        id=app.id,
        number=app.number,
        client_id=app.client_id,
        status=app.status,
        status_label=STATUS_LABELS[app.status],
        category=CategoryBrief.model_validate(app.category),
        title=app.title,
        description=app.description,
        metal=app.metal,
        fineness=app.fineness,
        weight_g=app.weight_mg / 1000 if app.weight_mg is not None else None,
        brand=app.brand,
        condition=app.condition,
        requested_amount=app.requested_amount,
        created_at=app.created_at,
        updated_at=app.updated_at,
        submitted_at=app.submitted_at,
        editable=svc.is_editable(app),
        can_submit=svc.is_editable(app),
        max_photos=max_photos,
        photos=[photo_read(p, signer) for p in photos],
        pre_estimate=AppraisalRead.model_validate(pre) if pre else None,
        client=UserBrief.model_validate(app.client),
        expert=UserBrief.model_validate(app.expert) if app.expert else None,
        expert_appraisal=(
            AppraisalRead.model_validate(expert_appraisal) if expert_appraisal else None
        ),
        offer=offer_read(offer, review.local_today(now)) if offer else None,
        courier_visit=visit_read(visit) if visit else None,
        inspection=AppraisalRead.model_validate(inspected) if inspected else None,
        loan=(
            loan_summary_read(app.loan, now or utcnow(), settings or Settings(_env_file=None))
            if app.loan
            else None
        ),
        actions=available_actions(app, viewer),
        history=[history_read(h) for h in sorted(app.history, key=lambda h: h.id)],
    )


class CardView:
    """Renders the application card with the app's photo signer, settings and clock."""

    def __init__(self, signer: PhotoUrlSigner, settings: Settings, now: datetime) -> None:
        self.signer, self.settings, self.now = signer, settings, now

    def __call__(self, app: Application, viewer: User) -> ApplicationRead:
        return application_read(
            app,
            self.signer,
            self.settings.max_photos,
            viewer,
            now=self.now,
            settings=self.settings,
        )


def get_card_view(signer: PhotoSignerDep, settings: SettingsDep, clock: ClockDep) -> CardView:
    return CardView(signer, settings, clock.now())


CardViewDep = Annotated[CardView, Depends(get_card_view)]


def list_item(app: Application, signer: PhotoUrlSigner) -> ApplicationListItem:
    pre = svc.latest_auto_appraisal(app)
    cover = min(app.photos, key=lambda p: p.position) if app.photos else None
    return ApplicationListItem(
        id=app.id,
        number=app.number,
        status=app.status,
        status_label=STATUS_LABELS[app.status],
        title=app.title,
        category=CategoryBrief.model_validate(app.category),
        photo_count=len(app.photos),
        cover_thumb_url=signer.url(cover.id, PhotoVariant.THUMB) if cover else None,
        pre_estimate_min=pre.value_min if pre else None,
        pre_estimate_max=pre.value_max if pre else None,
        created_at=app.created_at,
        submitted_at=app.submitted_at,
        updated_at=app.updated_at,
    )


def _delete_files(storage: PhotoStorage, keys: list[str]) -> None:
    for key in keys:
        storage.delete(key)


# --- Endpoints ----------------------------------------------------------------------------


@router.get(
    "",
    response_model=list[ApplicationListItem],
    summary="Список заявок (клиент — свои, эксперт/админ — все)",
)
def list_applications(
    session: SessionDep,
    user: ApplicationReader,
    signer: PhotoSignerDep,
    status_filter: Annotated[ApplicationStatus | None, Query(alias="status")] = None,
) -> list[ApplicationListItem]:
    apps = svc.list_applications(session, user, status_filter)
    return [list_item(a, signer) for a in apps]


@router.post(
    "",
    response_model=ApplicationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Создать черновик заявки",
)
def create_application(
    data: ApplicationCreate,
    session: SessionDep,
    card: CardViewDep,
    user: ClientUser,
) -> ApplicationRead:
    app = svc.create_application(session, user, data.model_dump())
    session.commit()
    app = svc.get_application(session, app.id, user)
    return card(app, user)


@router.get("/{application_id}", response_model=ApplicationRead, summary="Карточка заявки")
def get_application(
    application_id: int,
    session: SessionDep,
    card: CardViewDep,
    user: ApplicationReader,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    return card(app, user)


@router.patch(
    "/{application_id}",
    response_model=ApplicationRead,
    summary="Изменить параметры (черновик или «Нужны фото»)",
)
def update_application(
    application_id: int,
    data: ApplicationUpdate,
    session: SessionDep,
    card: CardViewDep,
    user: ClientUser,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    svc.update_application(session, app, data.model_dump(exclude_unset=True))
    session.commit()
    return card(app, user)


@router.delete(
    "/{application_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить черновик",
)
def delete_application(
    application_id: int,
    session: SessionDep,
    user: ClientUser,
    storage: PhotoStorageDep,
) -> Response:
    app = svc.get_application(session, application_id, user)
    keys = svc.delete_application(session, app)
    session.commit()
    _delete_files(storage, keys)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{application_id}/photos",
    response_model=ApplicationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить фото (JPEG/PNG/WebP, до 6 на заявку)",
)
def upload_photos(
    application_id: int,
    files: Annotated[list[UploadFile], File(description="Одно или несколько фото")],
    session: SessionDep,
    card: CardViewDep,
    user: ClientUser,
    storage: PhotoStorageDep,
    appraiser: PhotoAppraiserDep,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    limit = settings.max_photo_bytes
    uploaded = [
        # Read one byte past the limit: enough to detect an oversized file.
        svc.UploadedFile(f.filename or "photo", f.content_type, f.file.read(limit + 1))
        for f in files
    ]
    _, keys = svc.add_photos(
        session,
        app,
        uploaded,
        storage=storage,
        appraiser=appraiser,
        max_photos=settings.max_photos,
        max_bytes=limit,
    )
    try:
        session.commit()
    except Exception:
        _delete_files(storage, keys)
        raise
    return card(app, user)


@router.delete(
    "/{application_id}/photos/{photo_id}",
    response_model=ApplicationRead,
    summary="Удалить фото",
)
def delete_photo(
    application_id: int,
    photo_id: int,
    session: SessionDep,
    card: CardViewDep,
    user: ClientUser,
    storage: PhotoStorageDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    key = svc.delete_photo(session, app, photo_id)
    session.commit()
    storage.delete(key)
    return card(app, user)


@router.put(
    "/{application_id}/photos/order",
    response_model=ApplicationRead,
    summary="Изменить порядок фото (первое — обложка)",
)
def reorder_photos(
    application_id: int,
    data: PhotoOrder,
    session: SessionDep,
    card: CardViewDep,
    user: ClientUser,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    svc.reorder_photos(app, data.photo_ids)
    session.commit()
    return card(app, user)


@router.post(
    "/{application_id}/submit",
    response_model=ApplicationRead,
    summary="Отправить на оценку → автоматическая предоценка",
)
def submit_application(
    application_id: int,
    session: SessionDep,
    card: CardViewDep,
    user: ClientUser,
    storage: PhotoStorageDep,
    appraiser: PhotoAppraiserDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    svc.submit_application(session, app, user, storage=storage, appraiser=appraiser)
    session.commit()
    return card(app, user)


# --- Offer decision (client) --------------------------------------------------------------


@router.post(
    "/{application_id}/offer/accept",
    response_model=ApplicationRead,
    summary="Принять предложение эксперта",
    responses={409: {"description": "Нет действующего предложения или истёк срок"}},
)
def accept_offer(
    application_id: int,
    session: SessionDep,
    card: CardViewDep,
    user: ClientUser,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    try:
        review.accept_offer(session, app, user, now=card.now)
    except review.OfferExpiredError:
        session.commit()  # keep the expiry, then report the conflict
        raise
    session.commit()
    return card(app, user)


@router.post(
    "/{application_id}/offer/decline",
    response_model=ApplicationRead,
    summary="Отказаться от предложения",
)
def decline_offer(
    application_id: int,
    session: SessionDep,
    card: CardViewDep,
    user: ClientUser,
    data: DeclineBody | None = None,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    try:
        review.decline_offer(session, app, user, data.reason if data else None, now=card.now)
    except review.OfferExpiredError:
        session.commit()
        raise
    session.commit()
    return card(app, user)
