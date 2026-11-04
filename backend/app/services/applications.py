"""Client applications: CRUD, photos, submission and automatic pre-estimate.

Functions do not commit unless stated; the API layer commits. File operations happen
around the commit so that the DB never points to a missing file.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domain.enums import ApplicationStatus, AppraisalKind, Role
from app.domain.pricing import EstimateError, EstimateInput, estimate, validate_metal_params
from app.models import Application, Appraisal, Category, Offer, Photo, User
from app.services.catalog import current_metal_prices
from app.services.errors import (
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    Problem,
    ValidationProblems,
)
from app.services.photo_appraiser import PhotoAppraiser
from app.services.status import change_status, record_created
from app.storage.photos import NormalizedPhoto, PhotoError, PhotoStorage, normalize_photo

S = ApplicationStatus
EDITABLE_STATUSES = frozenset({S.DRAFT, S.NEED_INFO})
NOT_FOUND = "Заявка не найдена"


@dataclass(frozen=True)
class UploadedFile:
    filename: str
    content_type: str | None
    data: bytes


def _load_options():  # type: ignore[no-untyped-def]
    return (
        selectinload(Application.category),
        selectinload(Application.photos),
        selectinload(Application.appraisals),
        selectinload(Application.history),
        selectinload(Application.offers).selectinload(Offer.appraisal),
        selectinload(Application.offers).selectinload(Offer.expert),
        selectinload(Application.client),
        selectinload(Application.expert),
    )


def get_application(session: Session, application_id: int, user: User) -> Application:
    """Application visible to `user`: own for clients, any for experts and admins.

    Someone else's application looks exactly like a missing one (404).
    """
    app = session.scalar(
        select(Application).where(Application.id == application_id).options(*_load_options())
    )
    if app is None or (user.role is Role.CLIENT and app.client_id != user.id):
        raise NotFoundError(NOT_FOUND)
    if user.role not in (Role.CLIENT, Role.EXPERT, Role.ADMIN):
        raise NotFoundError(NOT_FOUND)
    return app


def list_applications(
    session: Session, user: User, status: ApplicationStatus | None = None
) -> list[Application]:
    stmt = (
        select(Application)
        .options(
            selectinload(Application.category),
            selectinload(Application.photos),
            selectinload(Application.appraisals),
        )
        .order_by(Application.created_at.desc(), Application.id.desc())
    )
    if user.role is Role.CLIENT:
        stmt = stmt.where(Application.client_id == user.id)
    if status is not None:
        stmt = stmt.where(Application.status == status)
    return list(session.scalars(stmt))


def latest_auto_appraisal(app: Application) -> Appraisal | None:
    autos = [a for a in app.appraisals if a.kind is AppraisalKind.AUTO]
    return max(autos, key=lambda a: (a.created_at, a.id)) if autos else None


def is_editable(app: Application) -> bool:
    return app.status in EDITABLE_STATUSES


def ensure_editable(app: Application) -> None:
    if not is_editable(app):
        raise ConflictError("Заявку можно менять только в статусах «Черновик» и «Нужны фото»")


def _get_category(session: Session, category_id: int) -> Category:
    category = session.get(Category, category_id)
    if category is None or not category.is_active:
        raise ValidationProblems([Problem("category_id", "Категория не найдена")])
    return category


def _check_params(app: Application, category: Category) -> None:
    problems = [
        Problem(f, m)
        for f, m in validate_metal_params(
            category.code, category.requires_metal, app.metal, app.fineness
        )
    ]
    if problems:
        raise ValidationProblems(problems)


def _weight_mg(weight_g: Decimal | None) -> int | None:
    return None if weight_g is None else int((weight_g * 1000).to_integral_value())


def create_application(session: Session, user: User, data: dict) -> Application:
    category = _get_category(session, data.pop("category_id"))
    weight_g = data.pop("weight_g", None)
    app = Application(client=user, category=category, weight_mg=_weight_mg(weight_g), **data)
    _check_params(app, category)
    session.add(app)
    session.flush()
    record_created(session, app, user)
    return app


def update_application(session: Session, app: Application, changes: dict) -> Application:
    ensure_editable(app)
    if "title" in changes and changes["title"] is None:
        changes.pop("title")  # title is required; null means "unchanged"
    if "category_id" in changes:
        category_id = changes.pop("category_id")
        if category_id is not None:
            app.category = _get_category(session, category_id)
    if "weight_g" in changes:
        app.weight_mg = _weight_mg(changes.pop("weight_g"))
    for field, value in changes.items():
        setattr(app, field, value)
    _check_params(app, app.category)
    return app


def delete_application(session: Session, app: Application) -> list[str]:
    """Delete a draft. Returns storage keys to remove after the commit."""
    if app.status is not S.DRAFT:
        raise ConflictError("Удалить можно только черновик")
    keys = [p.storage_key for p in app.photos]
    session.delete(app)
    return keys


# --- Photos -------------------------------------------------------------------------------


def add_photos(
    session: Session,
    app: Application,
    files: Sequence[UploadedFile],
    *,
    storage: PhotoStorage,
    appraiser: PhotoAppraiser,
    max_photos: int,
    max_bytes: int,
) -> tuple[list[Photo], list[str]]:
    """Validate, normalise and store photos. Returns new photos and their storage keys.

    All files are validated before anything is written; on a bad file nothing is saved.
    """
    ensure_editable(app)
    if not files:
        raise ValidationProblems([Problem("files", "Выберите хотя бы одно фото")])
    free = max_photos - len(app.photos)
    if len(files) > free:
        raise ValidationProblems(
            [
                Problem(
                    "files",
                    f"К заявке можно приложить не больше {max_photos} фото"
                    + (f", осталось мест: {free}" if free > 0 else ", лимит исчерпан"),
                )
            ]
        )

    normalized: list[tuple[UploadedFile, NormalizedPhoto]] = []
    problems: list[Problem] = []
    for f in files:
        if len(f.data) > max_bytes:
            raise PayloadTooLargeError(
                f"Фото «{f.filename}» больше {max_bytes // (1024 * 1024)} МБ"
            )
        try:
            normalized.append((f, normalize_photo(f.data)))
        except PhotoError as exc:
            problems.append(Problem("files", f"«{f.filename}»: {exc}"))
    if problems:
        raise ValidationProblems(problems, "Не удалось принять фото")

    keys: list[str] = []
    photos: list[Photo] = []
    position = max((p.position for p in app.photos), default=-1) + 1
    try:
        for f, norm in normalized:
            score = appraiser.analyze([norm.image]).photos[0].score
            key = storage.save(app.id, norm)
            keys.append(key)
            photo = Photo(
                storage_key=key,
                original_name=(f.filename or "photo")[:255],
                content_type=norm.content_type,
                size_bytes=len(norm.full),
                width=norm.width,
                height=norm.height,
                quality_score=score,
                position=position,
            )
            position += 1
            app.photos.append(photo)
            photos.append(photo)
    except Exception:
        for key in keys:
            storage.delete(key)
        raise
    session.flush()
    return photos, keys


def _renumber(app: Application) -> None:
    for i, photo in enumerate(sorted(app.photos, key=lambda p: (p.position, p.id))):
        photo.position = i


def delete_photo(session: Session, app: Application, photo_id: int) -> str:
    """Remove a photo from the application. Returns its storage key to delete after commit."""
    ensure_editable(app)
    photo = next((p for p in app.photos if p.id == photo_id), None)
    if photo is None:
        raise NotFoundError("Фото не найдено")
    app.photos.remove(photo)
    _renumber(app)
    session.flush()
    return photo.storage_key


def reorder_photos(app: Application, photo_ids: list[int]) -> None:
    ensure_editable(app)
    current = {p.id: p for p in app.photos}
    if sorted(photo_ids) != sorted(current):
        raise ValidationProblems(
            [Problem("photo_ids", "Передайте все фото заявки ровно по одному разу")]
        )
    for i, pid in enumerate(photo_ids):
        current[pid].position = i
    app.photos.sort(key=lambda p: p.position)


# --- Submission and pre-estimate ----------------------------------------------------------


def submit_problems(app: Application) -> list[Problem]:
    """What is missing before the application can be submitted."""
    problems: list[Problem] = []
    category = app.category
    if not category.is_active:
        problems.append(Problem("category_id", "Категория больше не принимается"))
    if not app.photos:
        problems.append(Problem("photos", "Добавьте хотя бы одно фото изделия"))
    if app.condition is None:
        problems.append(Problem("condition", "Укажите состояние изделия"))
    if category.requires_metal:
        if app.metal is None:
            problems.append(Problem("metal", "Укажите металл"))
        if app.fineness is None:
            problems.append(Problem("fineness", "Укажите пробу"))
        if app.weight_mg is None:
            problems.append(Problem("weight_g", "Укажите вес изделия"))
    problems += [
        Problem(f, m)
        for f, m in validate_metal_params(
            category.code, category.requires_metal, app.metal, app.fineness
        )
    ]
    return problems


def compute_pre_estimate(
    session: Session, app: Application, storage: PhotoStorage, appraiser: PhotoAppraiser
) -> Appraisal:
    """Analyse photos and apply the formula. Updates photo scores; does not change status."""
    photos = sorted(app.photos, key=lambda p: p.position)
    images: list[Image.Image] = []
    for photo in photos:
        with Image.open(storage.path(photo.storage_key)) as img:
            images.append(img.convert("RGB"))
    analysis = appraiser.analyze(images)
    for photo, metrics in zip(photos, analysis.photos, strict=True):
        photo.quality_score = metrics.score

    price = current_metal_prices(session).get(app.metal) if app.metal else None
    category = app.category
    try:
        result = estimate(
            EstimateInput(
                category_code=category.code,
                category_name=category.name,
                requires_metal=category.requires_metal,
                ltv_percent=category.ltv_percent,
                metal=app.metal,
                fineness=app.fineness,
                weight_mg=app.weight_mg,
                brand=app.brand,
                condition=app.condition,
                metal_price_per_gram=price.price_per_gram if price else None,
                photo_confidence=analysis.confidence,
            )
        )
    except EstimateError as exc:
        problem = Problem("metal", str(exc))
        raise ValidationProblems([problem], "Не удалось оценить изделие") from exc

    details = result.details()
    details["photos"] = analysis.details()
    details["photo_appraiser"] = appraiser.name
    details["ltv_percent"] = category.ltv_percent
    if price is not None:
        details["metal_price"] = {
            "metal": price.metal.value,
            "price_per_gram": price.price_per_gram,
            "effective_from": price.effective_from.isoformat(),
        }
    appraisal = Appraisal(
        kind=AppraisalKind.AUTO,
        value_min=result.value_min,
        value_max=result.value_max,
        value=result.value,
        confidence=result.confidence,
        comment=result.summary,
        details=details,
    )
    app.appraisals.append(appraisal)
    session.add(appraisal)
    return appraisal


def submit_application(
    session: Session,
    app: Application,
    user: User,
    *,
    storage: PhotoStorage,
    appraiser: PhotoAppraiser,
) -> Appraisal:
    """DRAFT/NEED_INFO → SUBMITTED (client) → PRE_ESTIMATED (system) in one transaction."""
    if app.status not in EDITABLE_STATUSES:
        raise ConflictError("Заявка уже отправлена")
    problems = submit_problems(app)
    if problems:
        raise ValidationProblems(problems, "Заявку пока нельзя отправить")
    resubmit = app.status is S.NEED_INFO
    change_status(
        session,
        app,
        S.SUBMITTED,
        user=user,
        comment="Повторно отправлена с дополнениями" if resubmit else "Отправлена на оценку",
    )
    appraisal = compute_pre_estimate(session, app, storage, appraiser)
    change_status(session, app, S.PRE_ESTIMATED, comment=appraisal.comment)
    session.flush()
    return appraisal
