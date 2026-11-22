"""Structure check: calibrated on real photos (docs/decisions.md). Uses the repo's sample room photo plus
derived edits that simulate good renders (relit, reframed) and failures (other room, blank, removed fixtures,
crops, flips)."""
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from pipeline.verify import (
    MISALIGNED_CAP,
    STRUCTURE_OK,
    UNVERIFIABLE_SCORE,
    aspect_ok,
    structure_report,
    structure_score,
)

SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "ballroom" / "01-empty.png"


@pytest.fixture(scope="module")
def photo_arr() -> np.ndarray:
    return np.asarray(Image.open(SAMPLE).convert("RGB"))


@pytest.fixture
def photo(tmp_path: Path, photo_arr: np.ndarray) -> Path:
    p = tmp_path / "photo.png"
    Image.fromarray(photo_arr).save(p)
    return p


def _save(tmp_path: Path, name: str, arr: np.ndarray) -> Path:
    p = tmp_path / name
    Image.fromarray(np.ascontiguousarray(arr)).save(p)
    return p


def test_identical_photo_scores_near_one(photo: Path):
    report = structure_report(photo, photo)
    assert report["method"] == "aligned" and report["score"] > 0.95


def test_relit_render_passes(photo: Path, photo_arr, tmp_path: Path):
    warm = np.clip(photo_arr.astype(np.float32) * np.array([1.15, 0.95, 0.7]) + 20, 0, 255).astype(np.uint8)
    assert structure_score(photo, _save(tmp_path, "warm.png", warm)) >= STRUCTURE_OK


def test_decor_in_lower_frame_keeps_structure(photo: Path, photo_arr, tmp_path: Path):
    dressed = photo_arr.copy()
    h, w, _ = dressed.shape
    for i in range(6):  # "tables" across the floor
        cx = int(w * (0.12 + 0.15 * i))
        cv2.circle(dressed, (cx, int(h * 0.8)), int(w * 0.05), (240, 235, 225), -1)
    assert structure_score(photo, _save(tmp_path, "dressed.png", dressed)) >= STRUCTURE_OK


def test_4x3_photo_rendered_at_3x2_passes(tmp_path: Path, photo_arr):
    """Engines return 3:2 for 4:3 photos; a centre crop + rescale of the same room must not look 'altered'."""
    four_three = np.asarray(Image.fromarray(photo_arr).resize((1200, 900)))
    src = _save(tmp_path, "photo43.png", four_three)
    out = _save(tmp_path, "render32.png", np.asarray(Image.fromarray(four_three[50:850]).resize((1536, 1024))))
    report = structure_report(src, out)
    assert report["method"] == "aligned" and report["score"] >= STRUCTURE_OK


def test_blank_render_is_capped(photo: Path, photo_arr, tmp_path: Path):
    report = structure_report(photo, _save(tmp_path, "grey.png", np.full_like(photo_arr, 128)))
    assert report["method"] == "misaligned" and report["score"] <= MISALIGNED_CAP


def test_flipped_render_is_capped(photo: Path, photo_arr, tmp_path: Path):
    assert structure_score(photo, _save(tmp_path, "flip.png", photo_arr[:, ::-1])) <= MISALIGNED_CAP


def test_other_room_is_capped(photo: Path, tmp_path: Path):
    rng = np.random.default_rng(3)
    other = cv2.GaussianBlur((rng.random((683, 1024, 3)) * 255).astype(np.uint8), (0, 0), 2)
    assert structure_score(photo, _save(tmp_path, "other.png", other)) <= MISALIGNED_CAP


def test_removed_chandeliers_fail(photo: Path, photo_arr, tmp_path: Path):
    h, w, _ = photo_arr.shape
    mask = np.zeros((h, w), np.uint8)
    mask[0:int(h * 0.42), int(w * 0.36):int(w * 0.70)] = 255
    edited = cv2.inpaint(photo_arr, mask, 9, cv2.INPAINT_TELEA)
    report = structure_report(photo, _save(tmp_path, "nochandelier.png", edited))
    assert report["method"] == "aligned" and report["score"] < STRUCTURE_OK


def test_removed_windows_fail(photo: Path, photo_arr, tmp_path: Path):
    h, w, _ = photo_arr.shape
    mask = np.zeros((h, w), np.uint8)
    mask[int(h * 0.12):int(h * 0.62), int(w * 0.04):int(w * 0.40)] = 255
    edited = cv2.inpaint(photo_arr, mask, 9, cv2.INPAINT_TELEA)
    assert structure_score(photo, _save(tmp_path, "nowindows.png", edited)) < STRUCTURE_OK


def test_one_sided_crop_fails(photo: Path, photo_arr, tmp_path: Path):
    h, w, _ = photo_arr.shape
    assert structure_score(photo, _save(tmp_path, "crop.png", photo_arr[int(h * 0.3):, int(w * 0.22):])) < STRUCTURE_OK


def test_heavy_zoom_fails(photo: Path, photo_arr, tmp_path: Path):
    h, w, _ = photo_arr.shape
    zoom = cv2.resize(photo_arr[int(h * 0.1):int(h * 0.9), int(w * 0.1):int(w * 0.9)], (w, h))
    assert structure_score(photo, _save(tmp_path, "zoom.png", zoom)) < STRUCTURE_OK


def test_transparent_top_is_not_treated_as_intact(photo: Path, photo_arr, tmp_path: Path):
    h, w, _ = photo_arr.shape
    rgba = np.dstack([photo_arr, np.full((h, w), 255, np.uint8)])
    rgba[: int(h * 0.4), :, 3] = 0
    assert structure_score(photo, _save(tmp_path, "alpha.png", rgba)) < STRUCTURE_OK


def test_featureless_photo_is_unverifiable(tmp_path: Path):
    flat = np.full((480, 640, 3), 200, np.uint8)
    flat[300:] = (120, 90, 60)
    a = _save(tmp_path, "flat.png", flat)
    report = structure_report(a, a)
    assert report["method"] == "unverifiable" and report["score"] == UNVERIFIABLE_SCORE < STRUCTURE_OK


def test_tiny_and_extreme_aspect_images_are_unverifiable(photo: Path, tmp_path: Path):
    assert structure_report(photo, _save(tmp_path, "tiny.png", np.zeros((4, 4, 3), np.uint8)))["method"] == "unverifiable"
    strip = np.zeros((4096, 8, 3), np.uint8)
    assert structure_report(photo, _save(tmp_path, "strip.png", strip))["method"] == "unverifiable"


def test_sixteen_bit_input_is_handled(photo: Path, photo_arr, tmp_path: Path):
    gray16 = (np.asarray(Image.fromarray(photo_arr).convert("L")).astype(np.uint16) * 257)
    p = tmp_path / "g16.png"
    Image.fromarray(gray16).save(p)  # uint16 -> 16-bit PNG
    assert structure_score(photo, p) >= STRUCTURE_OK


def test_aspect_mismatch(photo: Path, tmp_path: Path):
    assert not aspect_ok(photo, _save(tmp_path, "square.png", np.zeros((512, 512, 3), np.uint8)))
