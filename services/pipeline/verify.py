"""Offline structure check: did the engine keep the room's architecture?

The render is aligned to the original photo, then edges are compared over the top 40% of the frame (ceiling,
windows, upper walls), where decor rarely belongs. See `structure_report` for the calibrated method.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from skimage.metrics import structural_similarity

from ._images import register_heif

STRUCTURE_OK = 0.70  # calibrated 2026-11-21: good renders 0.79-0.96 aligned; wrong room/angle fails alignment
MISALIGNED_CAP = 0.35  # renders that do not line up with the photo can never pass
MIN_KEYPOINTS = 20
MIN_INLIERS = 25
MIN_INLIER_RATIO = 0.30
SCALE_RANGE = (0.75, 1.33)
MAX_ROTATION_DEG = 5.0
MAX_SHIFT_X = 0.06  # fraction of width; engines reframe vertically when changing 4:3 -> 3:2, not sideways
MAX_SHIFT_Y = 0.15  # fraction of height
MIN_COVERAGE = 0.50
EDGE_TOLERANCE_PX = 3
_ALIGN_WIDTH = 1024
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


def _clahe(gray: np.ndarray) -> np.ndarray:
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)


def _resize_width(gray: np.ndarray, width: int) -> np.ndarray:
    h, w = gray.shape[:2]
    if w == width:
        return gray
    return cv2.resize(gray, (width, max(1, round(h * width / w))), interpolation=cv2.INTER_AREA)


def _align(a: np.ndarray, b: np.ndarray) -> dict | None:
    """Similarity transform mapping render `b` into original `a`'s frame (SIFT + RANSAC), or None."""
    sift = cv2.SIFT_create(4000)
    ka, da = sift.detectAndCompute(_clahe(a), None)
    kb, db = sift.detectAndCompute(_clahe(b), None)
    if da is None or db is None or len(ka) < MIN_KEYPOINTS or len(kb) < MIN_KEYPOINTS:
        return None
    pairs = cv2.BFMatcher().knnMatch(db, da, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < MIN_KEYPOINTS:
        return {"valid": False, "inliers": 0, "ratio": 0.0}
    src = np.float32([kb[m.queryIdx].pt for m in good])
    dst = np.float32([ka[m.trainIdx].pt for m in good])
    matrix, mask = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    if matrix is None:
        return {"valid": False, "inliers": 0, "ratio": 0.0}
    inliers = int(mask.sum())
    ratio = inliers / len(good)
    scale = float(np.hypot(matrix[0, 0], matrix[1, 0]))
    rotation = float(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0])))
    shift_x = abs(float(matrix[0, 2])) / a.shape[1]
    shift_y = abs(float(matrix[1, 2])) / a.shape[0]
    valid = (inliers >= MIN_INLIERS and ratio >= MIN_INLIER_RATIO
             and SCALE_RANGE[0] <= scale <= SCALE_RANGE[1] and abs(rotation) <= MAX_ROTATION_DEG
             and shift_x <= MAX_SHIFT_X and shift_y <= MAX_SHIFT_Y)
    return {"valid": valid, "matrix": matrix, "inliers": inliers, "ratio": ratio,
            "scale": scale, "rotation": rotation}


def _norm_edges(gray: np.ndarray) -> np.ndarray:
    """Canny on contrast-normalised (CLAHE) grayscale so relighting/uplighting does not erase edges."""
    norm = _clahe(cv2.GaussianBlur(gray, (3, 3), 0))
    median = float(np.median(norm))
    return cv2.Canny(norm, int(max(0, 0.66 * median)), int(min(255, 1.33 * median))) > 0


def _edge_f1(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    """Edge F1 with a few pixels of tolerance: robust to relighting, sensitive to moved/missing architecture."""
    ea = _norm_edges(a) & mask
    eb = _norm_edges(b) & mask
    if not ea.any():
        return 1.0 if not eb.any() else 0.0
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * EDGE_TOLERANCE_PX + 1,) * 2)
    da = cv2.dilate(ea.astype(np.uint8), kernel) > 0
    db = cv2.dilate(eb.astype(np.uint8), kernel) > 0
    recall = float((ea & db).sum()) / float(ea.sum())
    precision = float((eb & da).sum()) / float(max(1, eb.sum()))
    return 0.0 if recall + precision == 0 else 2 * recall * precision / (recall + precision)


def structure_report(original: Path, render: Path) -> dict:
    """How well the render kept the room's architecture, measured on the protected upper 40% of the frame.

    Calibrated (docs/decisions.md) on real venue photos and engine renders, including 4:3 photos rendered
    at 3:2 and heavy relighting:
    1. Align the render to the original (SIFT + RANSAC similarity). Engines reframe and change aspect, so
       naive resizing compares misaligned pixels and made intact rooms look "altered".
    2. If aligned (enough inliers, scale ~1, no rotation): score = tolerant edge F1 over the overlap
       (method "aligned"). Good renders scored 0.79-0.96.
    3. If both images have features but alignment fails, the camera, room or layout changed: the score is
       capped at MISALIGNED_CAP (method "misaligned").
    4. Too few features to align (plain synthetic images): the legacy resize+SSIM comparison ("edges"/"gray"/"flat").
    Returns {score, method, edge_density, flat, aligned, inliers, scale, rotation, coverage}.
    """
    a_full = _load_gray(Path(original))
    b_full = _load_gray(Path(render))
    a = _resize_width(a_full, _ALIGN_WIDTH)
    b = _resize_width(b_full, _ALIGN_WIDTH)
    top = max(7, int(a.shape[0] * TOP_FRACTION))
    density = float(np.count_nonzero(_raw_edges(a)[:top])) / float(max(1, a[:top].size))
    base = {"edge_density": density, "flat": False, "aligned": False, "inliers": 0,
            "scale": None, "rotation": None, "coverage": None}
    alignment = _align(a, b) if density >= MIN_EDGE_DENSITY else None
    if alignment is not None and alignment["valid"]:
        h, w = a.shape[:2]
        warped = cv2.warpAffine(b, alignment["matrix"], (w, h))
        valid = cv2.warpAffine(np.full(b.shape, 255, np.uint8), alignment["matrix"], (w, h)) > 0
        valid = cv2.erode(valid.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        region = np.zeros_like(valid)
        region[:top] = True
        mask = valid & region
        coverage = float(mask.sum()) / float(region.sum())
        info = {**base, "aligned": True, "inliers": alignment["inliers"], "scale": alignment["scale"],
                "rotation": alignment["rotation"], "coverage": coverage}
        if coverage >= MIN_COVERAGE:
            return {**info, "score": _edge_f1(a, warped, mask), "method": "aligned"}
        return {**info, "score": min(MISALIGNED_CAP, _edge_f1(a, warped, mask)), "method": "misaligned"}
    legacy = _legacy_report(a_full, b_full)
    if alignment is not None:  # features exist but the render does not line up with the photo
        return {**base, **legacy, "inliers": alignment.get("inliers", 0),
                "score": min(MISALIGNED_CAP, legacy["score"]), "method": "misaligned"}
    return {**base, **legacy}


def _legacy_report(a: np.ndarray, b: np.ndarray) -> dict:
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
        return {"score": _ssim(_edges(a)[:top], _edges(b)[:top]), "method": "edges", "flat": False}
    ga = cv2.GaussianBlur(a, (0, 0), sigmaX=3)[:top]
    gb = cv2.GaussianBlur(b, (0, 0), sigmaX=3)[:top]
    if float(ga.std()) < FLAT_STD and float(gb.std()) < FLAT_STD:
        return {"score": NEUTRAL_SCORE, "method": "flat", "flat": True}
    return {"score": _ssim(ga, gb), "method": "gray", "flat": False}


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
