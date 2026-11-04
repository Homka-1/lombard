"""Photo analysis for the pre-estimate (mock of an ML model).

`PhotoAppraiser` is the interface: it receives decoded images and returns per-photo
quality scores plus an overall photo confidence. `HeuristicPhotoAppraiser` uses simple
Pillow statistics — resolution, exposure, contrast, sharpness (variance of the Laplacian)
and an average hash to spot duplicate shots. A real model (item recognition, hallmark
reading, fake detection) can implement the same `analyze()`.
"""

from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from itertools import pairwise
from typing import Any, Protocol

from PIL import Image, ImageFilter, ImageStat

ANALYSIS_SIDE = 512
RECOMMENDED_PHOTOS = 3
DUPLICATE_DISTANCE = 6  # max Hamming distance of 64-bit aHash to call two shots the same

# Laplacian kernel; offset 128 keeps negative responses inside 0–255.
_LAPLACIAN = ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], scale=1, offset=128)


@dataclass
class PhotoMetrics:
    index: int  # 1-based position in the analysed list
    width: int
    height: int
    brightness: float  # mean luma 0–255
    contrast: float  # luma standard deviation
    sharpness: float  # variance of the Laplacian at ANALYSIS_SIDE
    resolution_score: int
    exposure_score: int
    contrast_score: int
    sharpness_score: int
    score: int  # 0–100, stored in Photo.quality_score
    duplicate_of: int | None = None
    issues: list[str] = field(default_factory=list)


@dataclass
class PhotoAnalysis:
    photos: list[PhotoMetrics]
    confidence: int  # 0–100: how much the photos support the estimate
    issues: list[str]

    def details(self) -> dict[str, Any]:
        return {
            "confidence": self.confidence,
            "issues": self.issues,
            "photos": [asdict(p) for p in self.photos],
        }


class PhotoAppraiser(Protocol):
    name: str

    def analyze(self, images: Sequence[Image.Image]) -> PhotoAnalysis: ...


def _scale(value: float, points: Sequence[tuple[float, float]]) -> int:
    """Piecewise-linear interpolation over sorted `(x, score)` points, clamped."""
    if value <= points[0][0]:
        return round(points[0][1])
    for (x0, y0), (x1, y1) in pairwise(points):
        if value <= x1:
            return round(y0 + (y1 - y0) * (value - x0) / (x1 - x0))
    return round(points[-1][1])


def average_hash(gray: Image.Image) -> int:
    small = gray.resize((8, 8), Image.Resampling.BILINEAR)
    pixels = list(small.tobytes())  # mode "L": one byte per pixel
    mean = sum(pixels) / len(pixels)
    bits = 0
    for p in pixels:
        bits = (bits << 1) | (p > mean)
    return bits


def _hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


class HeuristicPhotoAppraiser:
    name = "heuristic-v1"

    def measure(self, index: int, image: Image.Image) -> tuple[PhotoMetrics, int]:
        width, height = image.size
        gray = image.convert("L")
        gray.thumbnail((ANALYSIS_SIDE, ANALYSIS_SIDE), Image.Resampling.BILINEAR)
        stat = ImageStat.Stat(gray)
        brightness, contrast = stat.mean[0], stat.stddev[0]
        sharpness = ImageStat.Stat(gray.filter(_LAPLACIAN)).var[0]

        short = min(width, height)
        resolution_score = _scale(short, [(200, 20), (480, 55), (800, 85), (1200, 100)])
        # Ideal exposure: mean luma 90–180.
        if brightness < 90:
            exposure_score = _scale(brightness, [(20, 0), (50, 40), (90, 100)])
        else:
            exposure_score = _scale(brightness, [(180, 100), (215, 50), (245, 0)])
        contrast_score = _scale(contrast, [(8, 0), (25, 60), (45, 100)])
        sharpness_score = _scale(sharpness, [(5, 0), (30, 40), (100, 80), (250, 100)])
        score = round(
            0.25 * resolution_score
            + 0.25 * exposure_score
            + 0.15 * contrast_score
            + 0.35 * sharpness_score
        )

        issues: list[str] = []
        if resolution_score < 55:
            issues.append("низкое разрешение")
        if brightness < 60:
            issues.append("слишком тёмное")
        elif brightness > 215:
            issues.append("пересвечено")
        if contrast_score < 40:
            issues.append("низкий контраст")
        if sharpness_score < 40:
            issues.append("нерезкое")
        metrics = PhotoMetrics(
            index=index,
            width=width,
            height=height,
            brightness=round(brightness, 1),
            contrast=round(contrast, 1),
            sharpness=round(sharpness, 1),
            resolution_score=resolution_score,
            exposure_score=exposure_score,
            contrast_score=contrast_score,
            sharpness_score=sharpness_score,
            score=score,
            issues=issues,
        )
        return metrics, average_hash(gray)

    def analyze(self, images: Sequence[Image.Image]) -> PhotoAnalysis:
        if not images:
            return PhotoAnalysis(photos=[], confidence=0, issues=["Нет фотографий"])

        photos: list[PhotoMetrics] = []
        hashes: list[int] = []
        for i, image in enumerate(images, start=1):
            metrics, ahash = self.measure(i, image)
            for j, other in enumerate(hashes):
                if _hamming(ahash, other) <= DUPLICATE_DISTANCE:
                    metrics.duplicate_of = j + 1
                    metrics.issues.append(f"похоже на фото {j + 1}")
                    break
            photos.append(metrics)
            hashes.append(ahash)

        unique = [p for p in photos if p.duplicate_of is None]
        mean_score = sum(p.score for p in unique) / len(unique)
        coverage = {1: 0.6, 2: 0.8}.get(len(unique), 1.0)
        confidence = round(mean_score * coverage)

        issues = [f"Фото {p.index}: {', '.join(p.issues)}" for p in photos if p.issues]
        if len(unique) < RECOMMENDED_PHOTOS:
            issues.append(
                f"Добавьте ещё ракурсы: рекомендуем не меньше {RECOMMENDED_PHOTOS} разных фото "
                "(общий вид, клеймо/проба, бирка или документы)"
            )
        return PhotoAnalysis(photos=photos, confidence=confidence, issues=issues)
