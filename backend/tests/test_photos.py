"""Photo normalisation, storage, signed URLs and the heuristic photo appraiser."""

import io
from datetime import UTC, datetime, timedelta

import pytest
from PIL import Image, ImageFilter

from app.services.photo_appraiser import HeuristicPhotoAppraiser, average_hash
from app.storage.photos import (
    FULL_MAX_SIDE,
    THUMB_MAX_SIDE,
    LocalPhotoStorage,
    PhotoError,
    PhotoUrlSigner,
    PhotoVariant,
    normalize_photo,
)
from tests.conftest import image_bytes, jpeg, make_scene

# --- normalize_photo ----------------------------------------------------------------------


def test_normalize_jpeg_resizes_and_makes_thumbnail() -> None:
    norm = normalize_photo(jpeg(size=(3000, 2000)))
    assert (norm.width, norm.height) == (FULL_MAX_SIDE, round(2000 * FULL_MAX_SIDE / 3000))
    assert norm.source_format == "JPEG"
    with Image.open(io.BytesIO(norm.thumb)) as thumb:
        assert max(thumb.size) == THUMB_MAX_SIDE
        assert thumb.format == "JPEG"


def test_normalize_strips_exif_and_applies_orientation() -> None:
    img = make_scene(size=(800, 600))
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° CW
    exif[0x010F] = "SpyCam"  # Make
    norm = normalize_photo(image_bytes(img, "JPEG", exif=exif.tobytes()))
    assert (norm.width, norm.height) == (600, 800)
    with Image.open(io.BytesIO(norm.full)) as out:
        assert not out.getexif()


def test_normalize_png_with_alpha_on_white() -> None:
    img = Image.new("RGBA", (400, 300), (0, 0, 0, 0))
    norm = normalize_photo(image_bytes(img, "PNG"))
    assert norm.source_format == "PNG"
    assert norm.image.mode == "RGB"
    assert norm.image.getpixel((10, 10)) == (255, 255, 255)


def test_normalize_webp() -> None:
    assert normalize_photo(image_bytes(make_scene(size=(500, 400)), "WEBP")).width == 500


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"", "пустой"),
        (b"%PDF-1.4 not an image", "не является изображением"),
        (image_bytes(make_scene(size=(400, 300)), "GIF"), "JPEG, PNG и WebP"),
        (jpeg(size=(300, 150)), "слишком маленькое"),
        (jpeg()[:2000], "повреждён"),
    ],
)
def test_normalize_rejects_bad_input(data: bytes, message: str) -> None:
    with pytest.raises(PhotoError, match=message):
        normalize_photo(data)


def test_normalize_rejects_decompression_bomb() -> None:
    bomb = image_bytes(Image.new("L", (10_000, 5_000)), "PNG", optimize=True)
    assert len(bomb) < 1_000_000  # small file, huge image
    with pytest.raises(PhotoError, match="разрешение"):
        normalize_photo(bomb)


# --- storage ------------------------------------------------------------------------------


def test_local_storage_roundtrip(tmp_path) -> None:
    storage = LocalPhotoStorage(tmp_path)
    key = storage.save(7, normalize_photo(jpeg()))
    assert key.startswith("applications/7/") and key.endswith(".jpg")
    assert storage.path(key).is_file()
    assert storage.path(key, PhotoVariant.THUMB).is_file()
    assert storage.read(key)[:2] == b"\xff\xd8"
    storage.delete(key)
    assert not storage.path(key).exists()
    assert not storage.path(key, PhotoVariant.THUMB).exists()
    storage.delete(key)  # idempotent


def test_local_storage_blocks_path_traversal(tmp_path) -> None:
    storage = LocalPhotoStorage(tmp_path / "uploads")
    with pytest.raises(PhotoError):
        storage.path("../secret.jpg")


# --- signed URLs --------------------------------------------------------------------------


def test_signer_roundtrip_and_tampering() -> None:
    signer = PhotoUrlSigner("s" * 40, ttl_seconds=3600, bucket_seconds=600)
    now = datetime(2026, 11, 4, 12, 0, 5, tzinfo=UTC)
    url = signer.url(5, PhotoVariant.THUMB, now)
    assert url.startswith("/api/photos/5/thumb?exp=")
    exp = signer.expiry(now)
    assert exp % 600 == 0 and exp >= now.timestamp() + 3600
    sig = url.rsplit("sig=", 1)[1]
    assert signer.verify(5, PhotoVariant.THUMB, exp, sig, now)
    assert not signer.verify(6, PhotoVariant.THUMB, exp, sig, now)  # other photo
    assert not signer.verify(5, PhotoVariant.FULL, exp, sig, now)  # other variant
    assert not signer.verify(5, PhotoVariant.THUMB, exp + 600, sig, now)  # extended expiry
    assert not signer.verify(5, PhotoVariant.THUMB, exp, sig, now + timedelta(hours=2))
    other = PhotoUrlSigner("x" * 40)
    assert not other.verify(5, PhotoVariant.THUMB, exp, sig, now)


def test_signer_urls_are_stable_within_bucket() -> None:
    signer = PhotoUrlSigner("s" * 40)
    t = datetime(2026, 11, 4, 12, 0, 1, tzinfo=UTC)
    assert signer.url(1, PhotoVariant.FULL, t) == signer.url(
        1, PhotoVariant.FULL, t + timedelta(minutes=5)
    )


# --- heuristic appraiser ------------------------------------------------------------------

appraiser = HeuristicPhotoAppraiser()


def score(img: Image.Image):
    return appraiser.analyze([img]).photos[0]


def test_sharp_photo_scores_high() -> None:
    m = score(make_scene(1))
    assert m.score >= 85
    assert m.issues == []


def test_blurry_dark_bright_small_photos_flagged() -> None:
    sharp = score(make_scene(1)).score
    blurry = score(make_scene(1).filter(ImageFilter.GaussianBlur(6)))
    dark = score(make_scene(3).point(lambda v: v // 6))
    bright = score(make_scene(4).point(lambda v: 200 + v // 5))
    small = score(make_scene(5, (300, 220)))
    assert "нерезкое" in blurry.issues and blurry.score < sharp
    assert "слишком тёмное" in dark.issues and dark.score < sharp
    assert "пересвечено" in bright.issues and bright.score < sharp
    assert "низкое разрешение" in small.issues and small.score < sharp


def test_duplicates_and_photo_count_affect_confidence() -> None:
    one = appraiser.analyze([make_scene(1)])
    three = appraiser.analyze([make_scene(1), make_scene(2), make_scene(3)])
    dup = appraiser.analyze([make_scene(1), make_scene(1).copy(), make_scene(2)])
    assert one.confidence < three.confidence
    assert dup.photos[1].duplicate_of == 1
    assert dup.confidence < three.confidence
    assert any("Добавьте ещё ракурсы" in i for i in one.issues)
    assert not any("ракурсы" in i for i in three.issues)


def test_empty_analysis_and_hash() -> None:
    assert appraiser.analyze([]).confidence == 0
    gray = make_scene(1).convert("L")
    assert average_hash(gray) == average_hash(gray.resize((600, 450)))
