from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

from pipeline.engines import registry


@pytest.fixture(autouse=True)
def _fresh_registry():
    registry.refresh()
    yield
    registry.refresh()


def make_room(path: Path, size: tuple[int, int] = (768, 512), offset: int = 0) -> Path:
    """A synthetic 'room': wall/floor split, windows, a chandelier line. Deterministic."""
    w, h = size
    img = Image.new("RGB", size, (225, 218, 205))
    d = ImageDraw.Draw(img)
    d.rectangle([0, int(h * 0.6), w, h], fill=(120, 95, 70))
    for x in (w // 6, w // 2, 5 * w // 6):
        x += offset
        d.rectangle([x - 40, 40, x + 40, int(h * 0.45)], outline=(60, 60, 70), width=5)
        d.line([x, 40, x, int(h * 0.45)], fill=(60, 60, 70), width=3)
    d.line([0, 20, w, 20], fill=(90, 80, 70), width=4)
    img.save(path)
    return path


@pytest.fixture
def room(tmp_path: Path) -> Path:
    return make_room(tmp_path / "room.png")


@pytest.fixture
def noise(tmp_path: Path) -> Path:
    rng = np.random.default_rng(0)
    arr = rng.integers(0, 256, size=(512, 768, 3), dtype=np.uint8)
    path = tmp_path / "noise.png"
    Image.fromarray(arr).save(path)
    return path
