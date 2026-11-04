"""Client applications: CRUD, photos, submission with automatic pre-estimate."""

from typing import Annotated

from fastapi import APIRouter, File, Query, Response, UploadFile, status

from app.core.deps import (
    ApplicationReader,
    ClientUser,
    PhotoAppraiserDep,
    PhotoSignerDep,
    PhotoStorageDep,
    SessionDep,
    SettingsDep,
)
from app.domain.enums import ApplicationStatus
from app.domain.state_machine import STATUS_LABELS
from app.models import Application, Photo, StatusHistory
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
from app.services import applications as svc
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


def application_read(app: Application, signer: PhotoUrlSigner, max_photos: int) -> ApplicationRead:
    pre = svc.latest_auto_appraisal(app)
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
        history=[history_read(h) for h in sorted(app.history, key=lambda h: h.id)],
    )


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
    user: ClientUser,
    signer: PhotoSignerDep,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.create_application(session, user, data.model_dump())
    session.commit()
    app = svc.get_application(session, app.id, user)
    return application_read(app, signer, settings.max_photos)


@router.get("/{application_id}", response_model=ApplicationRead, summary="Карточка заявки")
def get_application(
    application_id: int,
    session: SessionDep,
    user: ApplicationReader,
    signer: PhotoSignerDep,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    return application_read(app, signer, settings.max_photos)


@router.patch(
    "/{application_id}",
    response_model=ApplicationRead,
    summary="Изменить параметры (черновик или «Нужны фото»)",
)
def update_application(
    application_id: int,
    data: ApplicationUpdate,
    session: SessionDep,
    user: ClientUser,
    signer: PhotoSignerDep,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    svc.update_application(session, app, data.model_dump(exclude_unset=True))
    session.commit()
    return application_read(app, signer, settings.max_photos)


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
    user: ClientUser,
    storage: PhotoStorageDep,
    appraiser: PhotoAppraiserDep,
    signer: PhotoSignerDep,
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
    return application_read(app, signer, settings.max_photos)


@router.delete(
    "/{application_id}/photos/{photo_id}",
    response_model=ApplicationRead,
    summary="Удалить фото",
)
def delete_photo(
    application_id: int,
    photo_id: int,
    session: SessionDep,
    user: ClientUser,
    storage: PhotoStorageDep,
    signer: PhotoSignerDep,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    key = svc.delete_photo(session, app, photo_id)
    session.commit()
    storage.delete(key)
    return application_read(app, signer, settings.max_photos)


@router.put(
    "/{application_id}/photos/order",
    response_model=ApplicationRead,
    summary="Изменить порядок фото (первое — обложка)",
)
def reorder_photos(
    application_id: int,
    data: PhotoOrder,
    session: SessionDep,
    user: ClientUser,
    signer: PhotoSignerDep,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    svc.reorder_photos(app, data.photo_ids)
    session.commit()
    return application_read(app, signer, settings.max_photos)


@router.post(
    "/{application_id}/submit",
    response_model=ApplicationRead,
    summary="Отправить на оценку → автоматическая предоценка",
)
def submit_application(
    application_id: int,
    session: SessionDep,
    user: ClientUser,
    storage: PhotoStorageDep,
    appraiser: PhotoAppraiserDep,
    signer: PhotoSignerDep,
    settings: SettingsDep,
) -> ApplicationRead:
    app = svc.get_application(session, application_id, user)
    svc.submit_application(session, app, user, storage=storage, appraiser=appraiser)
    session.commit()
    return application_read(app, signer, settings.max_photos)
