from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from api.main import create_app
from pipeline.engines import registry


@pytest.fixture(autouse=True)
def _fresh_registry():
    registry.refresh()
    yield
    registry.refresh()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VV_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("VV_DEV", "1")
    monkeypatch.setenv("VV_INLINE_JOBS", "1")
    monkeypatch.setenv("VV_DEFAULT_ENGINE", "mock")
    monkeypatch.setenv("VV_DEFAULT_BRAIN", "mock")
    monkeypatch.setattr(shutil, "which", lambda *_args, **_kwargs: None)
    with TestClient(create_app(), base_url="http://localhost:8000") as api:
        yield api


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
