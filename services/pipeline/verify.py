"""Offline structure check: did the engine keep the room's architecture?

The render is aligned to the original photo (feature matching), then architectural edges are compared over the top
40% of the frame (ceiling, windows, upper walls), where decor rarely belongs. The comparison is global and per tile,
so a missing chandelier can't hide behind an intact ceiling. See `structure_report` for the calibrated method
(docs/decisions.md).
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from ._images import register_heif

STRUCTURE_OK = 0.70  # calibrated 2026-11-21; see docs/decisions.md
MISALIGNED_CAP = 0.35  # render does not line up with the photo (other room/angle, blank, heavy crop): never passes
UNVERIFIABLE_SCORE = 0.50  # photo has too little structure to check: below STRUCTURE_OK so a person looks
TOP_FRACTION = 0.40
WORK_MAX_SIDE = 1024  # images are fitted (never upscaled) into this box before analysis
MAX_ASPECT = 4.0  # panoramas/strips beyond 4:1 are not checked
DECODE_MAX_SIDE = 4096  # cap decode resolution (memory)

MIN_KEYPOINTS = 40  # SIFT keypoints needed in BOTH images to attempt alignment
MIN_INLIERS = 25
MIN_INLIER_RATIO = 0.30
MIN_INLIER_SPREAD = 0.25  # fraction of 4x4 grid cells (over the photo) that must contain inliers
SCALE_RANGE = (0.75, 1.33)
MAX_ROTATION_DEG = 5.0
MAX_CENTER_SHIFT_X = 0.08  # render centre mapped into the photo, as a fraction of the photo's width
MAX_CENTER_SHIFT_Y = 0.12  # ... and height (engines crop 4:3 -> 3:2 vertically)
MIN_COVERAGE = 0.60  # fraction of the protected region the render must cover
EDGE_TOLERANCE_PX = 3
TILE_GRID = (3, 6)  # rows x cols over the protected region
TILE_MIN_EDGES = 0.02  # a tile counts if >= 2% of its pixels are original edges
TILE_FLOOR = 0.20  # any covered architecture tile with edge recall below this marks the render as altered
TILE_MIN_COVER = 0.80  # tiles the render only partly shows (aspect crop) are judged by MIN_COVERAGE instead
TILE_PERCENTILE = 10
TILE_MARGIN = 0.25

register_heif()


def _load_gray(path: Path) -> np.ndarray:
    """Decode to 8-bit grayscale safely: bounded size, alpha flattened onto mid-grey, 16-bit scaled down."""
    with Image.open(path) as im:
        im.draft("L", (DECODE_MAX_SIDE, DECODE_MAX_SIDE))
        im = ImageOps.exif_transpose(im)
        if max(im.size) > DECODE_MAX_SIDE:
            im.thumbnail((DECODE_MAX_SIDE, DECODE_MAX_SIDE))
        if im.mode in ("I;16", "I;16B", "I;16L", "I"):
            arr = np.asarray(im, dtype=np.float64)
            hi = float(arr.max()) or 1.0
            return np.clip(arr * (255.0 / max(255.0, hi)), 0, 255).astype(np.uint8)
        if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
            rgba = im.convert("RGBA")
            backdrop = Image.new("RGBA", rgba.size, (128, 128, 128, 255))
            im = Image.alpha_composite(backdrop, rgba)
        return np.asarray(im.convert("L"))


def _fit(gray: np.ndarray, max_side: int = WORK_MAX_SIDE) -> np.ndarray:
    h, w = gray.shape[:2]
    scale = min(1.0, max_side / float(max(h, w)))
    if scale >= 1.0:
        return gray
    return cv2.resize(gray, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)


def _clahe(gray: np.ndarray) -> np.ndarray:
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)


def _edges(gray: np.ndarray) -> np.ndarray:
    """Canny on contrast-normalised grayscale so relighting/uplighting does not erase edges."""
    norm = _clahe(cv2.GaussianBlur(gray, (3, 3), 0))
    median = float(np.median(norm))
    lo, hi = int(max(0, 0.66 * median)), int(min(255, 1.33 * median))
    if hi - lo < 30:
        lo, hi = 50, 150
    return cv2.Canny(norm, lo, hi) > 0


def _features(gray: np.ndarray):
    return cv2.SIFT_create(4000).detectAndCompute(_clahe(gray), None)


def _align(a: np.ndarray, b: np.ndarray, fa, fb) -> dict:
    """Similarity transform mapping render `b` into photo `a`'s frame, with validity checks."""
    (ka, da), (kb, db) = fa, fb
    fail = {"valid": False, "inliers": 0, "ratio": 0.0, "reason": "no consistent match with the photo"}
    pairs = cv2.BFMatcher().knnMatch(db, da, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < MIN_INLIERS:
        return fail
    src = np.float32([kb[m.queryIdx].pt for m in good])
    dst = np.float32([ka[m.trainIdx].pt for m in good])
    matrix, mask = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    if matrix is None or not np.all(np.isfinite(matrix)):
        return fail
    keep = mask.ravel().astype(bool)
    inliers = int(keep.sum())
    ratio = inliers / len(good)
    scale = float(np.hypot(matrix[0, 0], matrix[1, 0]))
    rotation = float(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0])))
    ha, wa = a.shape[:2]
    hb, wb = b.shape[:2]
    cx, cy = matrix @ np.array([wb / 2.0, hb / 2.0, 1.0])
    shift_x, shift_y = abs(cx - wa / 2.0) / wa, abs(cy - ha / 2.0) / ha
    cells = {(min(3, int(4 * y / ha)), min(3, int(4 * x / wa))) for x, y in dst[keep]}
    spread = len(cells) / 16.0
    checks = {
        "inliers": inliers >= MIN_INLIERS and ratio >= MIN_INLIER_RATIO,
        "spread": spread >= MIN_INLIER_SPREAD,
        "scale": SCALE_RANGE[0] <= scale <= SCALE_RANGE[1],
        "rotation": abs(rotation) <= MAX_ROTATION_DEG,
        "shift": shift_x <= MAX_CENTER_SHIFT_X and shift_y <= MAX_CENTER_SHIFT_Y,
    }
    failed = [k for k, ok in checks.items() if not ok]
    return {"valid": not failed, "matrix": matrix, "inliers": inliers, "ratio": ratio, "scale": scale,
            "rotation": rotation, "shift": (shift_x, shift_y), "spread": spread,
            "reason": None if not failed else "alignment failed: " + ", ".join(failed)}


def _dilate(mask: np.ndarray) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * EDGE_TOLERANCE_PX + 1,) * 2)
    return cv2.dilate(mask.astype(np.uint8), kernel) > 0


def _compare(ea: np.ndarray, eb: np.ndarray, covered: np.ndarray) -> tuple[float, float, list[float]]:
    """(global edge F1, low-percentile tile recall, tile recalls) over the part of the protected region the render shows.

    Engines legitimately crop (4:3 photo -> 3:2 render), so architecture outside the footprint is judged by the
    separate coverage requirement and the centre-shift limit, not counted here. Inside the footprint every photo
    edge must reappear (recall), per tile, so local removals (a chandelier, a window bay) are caught.
    """
    ea = ea & covered
    db, da = _dilate(eb), _dilate(ea)
    recall = float((ea & db).sum()) / float(max(1, ea.sum()))
    precision = float((eb & da).sum()) / float(max(1, eb.sum()))
    f1 = 0.0 if recall + precision == 0 else 2 * recall * precision / (recall + precision)
    h, w = ea.shape
    rows, cols = TILE_GRID
    tiles = []
    for r in range(rows):
        for c in range(cols):
            ys, ye = r * h // rows, (r + 1) * h // rows
            xs, xe = c * w // cols, (c + 1) * w // cols
            cov = covered[ys:ye, xs:xe]
            ta = ea[ys:ye, xs:xe]
            if ta.size == 0 or cov.mean() < TILE_MIN_COVER or ta.mean() < TILE_MIN_EDGES:
                continue
            tiles.append(float((ta & db[ys:ye, xs:xe]).sum()) / float(ta.sum()))
    low = float(np.percentile(tiles, TILE_PERCENTILE)) if tiles else recall
    return f1, low, tiles


def structure_report(original: Path, render: Path) -> dict:
    """How well the render kept the room's architecture; calibrated on real venue photos and engine renders.

    1. Both images are fitted (never upscaled) into 1024 px. Extreme aspect ratios and tiny images are not checked.
    2. If the photo has structure (SIFT keypoints), the render must align to it: a similarity transform with enough
       well-spread inliers, scale 0.75-1.33, rotation <= 5 deg, render centre within 8%/12% of the photo centre,
       covering >= 60% of the protected region. Anything else (other room/angle, flipped, blank render, heavy crop)
       is "misaligned" and capped at MISALIGNED_CAP.
    3. Aligned: score = min(global edge F1, 10th-percentile tile recall + margin). If any architecture tile falls
       below TILE_FLOOR, the score is pushed under the threshold, so one missing chandelier or window bay is
       flagged even when the ceiling grid is intact.
    4. Photos with no usable structure can't be verified: UNVERIFIABLE_SCORE (< STRUCTURE_OK), so a person checks.
    Reports the absolute mean brightness change over the protected area, on a scale from 0 to 1.
    """
    report = {"aligned": False, "inliers": 0, "scale": None, "rotation": None, "coverage": None,
              "f1": None, "tile_low": None, "tiles": 0, "edge_density": None, "flat": False,
              "brightness_delta": None}
    a_full, b_full = _load_gray(Path(original)), _load_gray(Path(render))
    for img in (a_full, b_full):
        h, w = img.shape[:2]
        if min(h, w) < 16 or max(h, w) / max(1, min(h, w)) > MAX_ASPECT:
            return {**report, "score": UNVERIFIABLE_SCORE, "method": "unverifiable",
                    "reason": "image too small or too elongated to check"}
    a, b = _fit(a_full), _fit(b_full)
    top = max(8, int(a.shape[0] * TOP_FRACTION))
    b_top = max(8, int(b.shape[0] * TOP_FRACTION))
    report["brightness_delta"] = float(abs(a[:top].mean() - b[:b_top].mean()) / 255)
    ea_full = _edges(a)
    density = float(ea_full[:top].mean())
    report["edge_density"] = density
    fa, fb = _features(a), _features(b)
    if fa[1] is None or len(fa[0]) < MIN_KEYPOINTS:
        return {**report, "score": UNVERIFIABLE_SCORE, "method": "unverifiable", "flat": density < 0.005,
                "reason": "the photo has too little structure to verify"}
    if fb[1] is None or len(fb[0]) < MIN_KEYPOINTS:
        return {**report, "score": MISALIGNED_CAP, "method": "misaligned",
                "reason": "the render lost the room's structure"}
    alignment = _align(a, b, fa, fb)
    report.update(inliers=alignment["inliers"], scale=alignment.get("scale"), rotation=alignment.get("rotation"))
    if not alignment["valid"]:
        return {**report, "score": MISALIGNED_CAP, "method": "misaligned", "reason": alignment["reason"]}
    h, w = a.shape[:2]
    warped = cv2.warpAffine(b, alignment["matrix"], (w, h))
    footprint = cv2.warpAffine(np.full(b.shape, 255, np.uint8), alignment["matrix"], (w, h)) > 0
    footprint = cv2.erode(footprint.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    covered = footprint[:top]
    coverage = float(covered.mean())
    ea, eb = ea_full[:top], _edges(warped)[:top] & covered
    f1, tile_low, tiles = _compare(ea, eb, covered)
    report.update(aligned=True, coverage=coverage, f1=f1, tile_low=tile_low, tiles=len(tiles))
    if coverage < MIN_COVERAGE:
        return {**report, "score": min(MISALIGNED_CAP, f1), "method": "misaligned",
                "reason": f"the render only shows {coverage:.0%} of the protected area"}
    score = min(f1, tile_low + TILE_MARGIN)
    if tiles and min(tiles) < TILE_FLOOR:
        score = min(score, STRUCTURE_OK - 0.05)
    reason = "protected room features match" if score >= STRUCTURE_OK else "protected room features differ"
    return {**report, "score": float(max(0.0, min(1.0, score))), "method": "aligned", "reason": reason}


def structure_score(original: Path, render: Path) -> float:
    """Structure similarity in [0, 1] (1 = architecture unchanged); see structure_report."""
    return float(structure_report(original, render)["score"])


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        return im.size


def aspect_ok(original: Path, render: Path, tolerance: float = 0.02) -> bool:
    """True when the render has (almost) the same aspect ratio as the original."""
    ow, oh = image_size(Path(original))
    rw, rh = image_size(Path(render))
    if not (ow and oh and rw and rh):
        return False
    a, b = ow / oh, rw / rh
    return abs(a - b) / a <= tolerance
