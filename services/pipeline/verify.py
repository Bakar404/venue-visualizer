"""Offline structure check: did the engine keep the room's architecture?

Edge maps (Canny) of the original and the render are blurred (to tolerate small shifts) and compared with
SSIM over the top 40% of the frame (ceiling, windows, upper walls), where decor rarely belongs.
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

register_heif()


def _load_gray(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        return np.asarray(im.convert("L"))


def _edges(gray: np.ndarray) -> np.ndarray:
    smooth = cv2.GaussianBlur(gray, (5, 5), 0)
    median = float(np.median(smooth))
    lo, hi = int(max(0, 0.66 * median)), int(min(255, 1.33 * median))
    if hi - lo < 30:
        lo, hi = 50, 150
    edges = cv2.Canny(smooth, lo, hi)
    return cv2.GaussianBlur(edges, (0, 0), sigmaX=3)


def structure_score(original: Path, render: Path) -> float:
    """Edge-map SSIM in [0, 1] over the upper 40% of the frame (1 = identical structure)."""
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
    ea, eb = _edges(a)[:top], _edges(b)[:top]
    win = min(7, ea.shape[0], ea.shape[1])
    if win % 2 == 0:
        win -= 1
    if win < 3:
        return 1.0 if np.array_equal(ea, eb) else 0.0
    score = structural_similarity(ea, eb, data_range=255, win_size=win)
    return float(min(1.0, max(0.0, score)))


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
