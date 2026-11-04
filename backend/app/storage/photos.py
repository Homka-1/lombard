"""Photo storage: validation and normalisation with Pillow, local files, signed URLs.

Uploaded images are never stored as-is: they are decoded, rotated by EXIF, converted to
RGB, downscaled and re-encoded to JPEG. This drops EXIF metadata (GPS coordinates of the
client's home!) and anything that is not a real image. A thumbnail is stored next to it.

`PhotoStorage` is the interface; `LocalPhotoStorage` keeps files on disk under
`upload_dir`. An S3-like storage can implement the same four methods.
"""

import hashlib
import hmac
import io
import uuid
import warnings
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageOps, UnidentifiedImageError

ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
ALLOWED_CONTENT_TYPES = frozenset(ALLOWED_FORMATS.values())
MAX_PIXELS = 40_000_000  # decompression-bomb guard (≈ 7300×5500)
MIN_SIDE = 200
FULL_MAX_SIDE = 2560
THUMB_MAX_SIDE = 480
JPEG_QUALITY = 88
THUMB_QUALITY = 80


class PhotoError(ValueError):
    """The upload is not an acceptable photo. Message is user-facing (Russian)."""


class PhotoVariant(StrEnum):
    FULL = "full"
    THUMB = "thumb"


@dataclass(frozen=True)
class NormalizedPhoto:
    full: bytes
    thumb: bytes
    width: int
    height: int
    source_format: str
    image: Image.Image  # decoded full-size RGB image, for analysis

    content_type = "image/jpeg"


def _encode_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def normalize_photo(data: bytes) -> NormalizedPhoto:
    """Validate an uploaded image and produce JPEG full size + thumbnail without EXIF."""
    if not data:
        raise PhotoError("Файл пустой")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            probe = Image.open(io.BytesIO(data))
            fmt = probe.format or ""
            if fmt not in ALLOWED_FORMATS:
                raise PhotoError("Поддерживаются только фото в форматах JPEG, PNG и WebP")
            width, height = probe.size
            if width * height > MAX_PIXELS:
                raise PhotoError("Слишком большое разрешение изображения")
            probe.verify()  # structural check; the image must be reopened afterwards
            img = Image.open(io.BytesIO(data))
            img.load()
    except PhotoError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise PhotoError("Файл не является изображением или повреждён") from None
    except (OSError, SyntaxError, ValueError) as exc:  # truncated / corrupt data
        raise PhotoError("Файл не является изображением или повреждён") from exc

    img = ImageOps.exif_transpose(img) or img
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    if min(img.size) < MIN_SIDE:
        raise PhotoError(
            f"Фото слишком маленькое: нужно не меньше {MIN_SIDE} px по короткой стороне"
        )

    full = img.copy()
    full.thumbnail((FULL_MAX_SIDE, FULL_MAX_SIDE), Image.Resampling.LANCZOS)
    thumb = img.copy()
    thumb.thumbnail((THUMB_MAX_SIDE, THUMB_MAX_SIDE), Image.Resampling.LANCZOS)
    return NormalizedPhoto(
        full=_encode_jpeg(full, JPEG_QUALITY),
        thumb=_encode_jpeg(thumb, THUMB_QUALITY),
        width=full.width,
        height=full.height,
        source_format=fmt,
        image=full,
    )


class PhotoStorage(Protocol):
    def save(self, application_id: int, photo: NormalizedPhoto) -> str:
        """Store both variants; return the storage key of the full-size image."""
        ...

    def path(self, key: str, variant: PhotoVariant = PhotoVariant.FULL) -> Path:
        """Local path of a stored variant (for FileResponse and analysis)."""
        ...

    def read(self, key: str, variant: PhotoVariant = PhotoVariant.FULL) -> bytes: ...

    def delete(self, key: str) -> None:
        """Remove both variants; missing files are ignored."""
        ...


def thumb_key(key: str) -> str:
    stem, _, ext = key.rpartition(".")
    return f"{stem}_thumb.{ext}"


class LocalPhotoStorage:
    """Files under `root/applications/<id>/<uuid>.jpg` (+ `<uuid>_thumb.jpg`)."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()

    def _resolve(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise PhotoError("Недопустимый путь к файлу")
        return path

    def save(self, application_id: int, photo: NormalizedPhoto) -> str:
        key = f"applications/{application_id}/{uuid.uuid4().hex}.jpg"
        full = self._resolve(key)
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_bytes(photo.full)
        self._resolve(thumb_key(key)).write_bytes(photo.thumb)
        return key

    def path(self, key: str, variant: PhotoVariant = PhotoVariant.FULL) -> Path:
        return self._resolve(key if variant is PhotoVariant.FULL else thumb_key(key))

    def read(self, key: str, variant: PhotoVariant = PhotoVariant.FULL) -> bytes:
        return self.path(key, variant).read_bytes()

    def delete(self, key: str) -> None:
        for variant in PhotoVariant:
            self.path(key, variant).unlink(missing_ok=True)


class PhotoUrlSigner:
    """Short-lived HMAC-signed URLs, so `<img src>` works without an Authorization header.

    Expiry is rounded up to `bucket_seconds`, so URLs stay identical (and cacheable by the
    browser) for a while instead of changing on every API response.
    """

    def __init__(
        self,
        secret: str,
        *,
        prefix: str = "/api",
        ttl_seconds: int = 3600,
        bucket_seconds: int = 600,
    ) -> None:
        self._key = hashlib.sha256(f"photo-url:{secret}".encode()).digest()
        self.prefix = prefix
        self.ttl = ttl_seconds
        self.bucket = bucket_seconds

    def _sig(self, photo_id: int, variant: PhotoVariant, exp: int) -> str:
        msg = f"{photo_id}:{variant.value}:{exp}".encode()
        return hmac.new(self._key, msg, hashlib.sha256).hexdigest()[:32]

    def expiry(self, now: datetime | None = None) -> int:
        ts = int((now or datetime.now(UTC)).timestamp()) + self.ttl
        return -(-ts // self.bucket) * self.bucket

    def url(self, photo_id: int, variant: PhotoVariant, now: datetime | None = None) -> str:
        exp = self.expiry(now)
        sig = self._sig(photo_id, variant, exp)
        return f"{self.prefix}/photos/{photo_id}/{variant.value}?exp={exp}&sig={sig}"

    def verify(
        self, photo_id: int, variant: PhotoVariant, exp: int, sig: str, now: datetime | None = None
    ) -> bool:
        if exp < int((now or datetime.now(UTC)).timestamp()):
            return False
        return hmac.compare_digest(self._sig(photo_id, variant, exp), sig)
