"""Offline structure check: did the engine keep the room's architecture?

Edge maps (Canny) of the original and the render are blurred (to tolerate small shifts) and compared with
SSIM over the top 40% of the frame (ceiling, windows, upper walls), where decor rarely belongs. When that region
of the original has almost no edges, blurred grayscale is compared instead (see `structure_report`).
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from skimage.metrics import structural_similarity

from ._images import register_heif

STRUCTURE_OK = 0.55  # to be calibrated on sample runs (docs/decisions.md)
TOP_FRACTION = 0.40
_WORK_WIDTH = 768
_ASPECT_TOLERANCE = 0.02
MIN_EDGE_DENSITY = 0.005  # < 0.5% edge pixels in the original's protected region: compare grayscale instead
FLAT_STD = 2.0  # blurred-grayscale std below this = featureless region
NEUTRAL_SCORE = 0.75  # both regions featureless: nothing to compare

register_heif()


def _load_gray(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        return np.asarray(im.convert("L"))


def _raw_edges(gray: np.ndarray) -> np.ndarray:
    smooth = cv2.GaussianBlur(gray, (5, 5), 0)
    median = float(np.median(smooth))
    lo, hi = int(max(0, 0.66 * median)), int(min(255, 1.33 * median))
    if hi - lo < 30:
        lo, hi = 50, 150
    return cv2.Canny(smooth, lo, hi)


def _edges(gray: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(_raw_edges(gray), (0, 0), sigmaX=3)


def _ssim(a: np.ndarray, b: np.ndarray) -> float:
    win = min(7, a.shape[0], a.shape[1])
    if win % 2 == 0:
        win -= 1
    if win < 3:
        return 1.0 if np.array_equal(a, b) else 0.0
    return float(min(1.0, max(0.0, structural_similarity(a, b, data_range=255, win_size=win))))


def structure_report(original: Path, render: Path) -> dict:
    """Structure similarity over the protected upper 40% of the frame, with how it was measured.

    Returns {score, method, edge_density, flat}. method is "edges" (SSIM of blurred edge maps) normally;
    "gray" (SSIM of the blurred grayscale) when the original's protected region has too few edges
    (< MIN_EDGE_DENSITY, e.g. a plain ceiling) so edge maps would be near-empty and meaningless; and "flat"
    (neutral NEUTRAL_SCORE, flat=True) when both regions are featureless and nothing can be compared.
    """
    a = _load_gray(Path(original))
    b = _load_gray(Path(render))
    h, w = a.shape[:2]
    if (b.shape[1], b.shape[0]) != (w, h):
        b = cv2.resize(b, (w, h), interpolation=cv2.INTER_AREA)
    if w > _WORK_WIDTH:
        size = (_WORK_WIDTH, max(1, round(h * _WORK_WIDTH / w)))
        a = cv2.resize(a, size, interpolation=cv2.INTER_AREA)
        b = cv2.resize(b, size, interpolation=cv2.INTER_AREA)
    top = max(7, int(a.shape[0] * TOP_FRACTION))
    density = float(np.count_nonzero(_raw_edges(a)[:top])) / float(max(1, a[:top].size))
    if density >= MIN_EDGE_DENSITY:
        score = _ssim(_edges(a)[:top], _edges(b)[:top])
        return {"score": score, "method": "edges", "edge_density": density, "flat": False}
    ga = cv2.GaussianBlur(a, (0, 0), sigmaX=3)[:top]
    gb = cv2.GaussianBlur(b, (0, 0), sigmaX=3)[:top]
    if float(ga.std()) < FLAT_STD and float(gb.std()) < FLAT_STD:
        return {"score": NEUTRAL_SCORE, "method": "flat", "edge_density": density, "flat": True}
    return {"score": _ssim(ga, gb), "method": "gray", "edge_density": density, "flat": False}


def structure_score(original: Path, render: Path) -> float:
    """Structure similarity in [0, 1] over the upper 40% of the frame (1 = identical); see structure_report."""
    return float(structure_report(original, render)["score"])


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        return im.size


def aspect_ok(original: Path, render: Path, tolerance: float = _ASPECT_TOLERANCE) -> bool:
    """True when the render has (almost) the same aspect ratio as the original."""
    ow, oh = image_size(Path(original))
    rw, rh = image_size(Path(render))
    if not (ow and oh and rw and rh):
        return False
    a, b = ow / oh, rw / rh
    return abs(a - b) / a <= tolerance
