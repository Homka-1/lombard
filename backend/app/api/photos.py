"""Serve application photos by short-lived signed URLs (works in `<img src>`)."""

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.core.deps import PhotoSignerDep, PhotoStorageDep, SessionDep
from app.models import Photo
from app.storage.photos import PhotoVariant

router = APIRouter(prefix="/photos", tags=["photos"])


@router.get(
    "/{photo_id}/{variant}",
    summary="Файл фото по подписанной ссылке",
    response_class=FileResponse,
    responses={200: {"content": {"image/jpeg": {}}}},
)
def get_photo(
    photo_id: int,
    variant: PhotoVariant,
    session: SessionDep,
    storage: PhotoStorageDep,
    signer: PhotoSignerDep,
    exp: int = Query(description="Срок действия ссылки, unix time"),
    sig: str = Query(max_length=64, description="Подпись"),
) -> FileResponse:
    if not signer.verify(photo_id, variant, exp, sig):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Ссылка на фото недействительна или устарела"
        )
    photo = session.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Фото не найдено")
    path = storage.path(photo.storage_key, variant)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл фото не найден")
    return FileResponse(
        path,
        media_type=photo.content_type,
        headers={
            "Cache-Control": "private, max-age=600",
            "X-Content-Type-Options": "nosniff",
        },
    )
