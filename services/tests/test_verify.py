from __future__ import annotations

from pathlib import Path

from PIL import Image

from pipeline.verify import STRUCTURE_OK, aspect_ok, structure_score

from .conftest import make_room


def test_identical_image_scores_one(room: Path):
    assert structure_score(room, room) > 0.99


def test_resized_render_still_scores_high(room: Path, tmp_path: Path):
    render = tmp_path / "render.png"
    with Image.open(room) as im:
        im.resize((1536, 1024)).save(render)
    assert structure_score(room, render) > 0.8
    assert aspect_ok(room, render)


def test_decor_in_lower_frame_keeps_structure(room: Path, tmp_path: Path):
    render = tmp_path / "decor.png"
    with Image.open(room) as im:
        from PIL import ImageDraw

        d = ImageDraw.Draw(im)
        for x in range(40, 768, 120):
            d.ellipse([x, 380, x + 70, 450], fill=(250, 250, 240), outline=(200, 170, 60), width=3)
        im.save(render)
    assert structure_score(room, render) >= STRUCTURE_OK


def test_unrelated_noise_scores_low(room: Path, noise: Path):
    assert structure_score(room, noise) < 0.3


def test_shifted_architecture_scores_lower(room: Path, tmp_path: Path):
    moved = make_room(tmp_path / "moved.png", offset=90)
    assert structure_score(room, moved) < structure_score(room, room)


def test_aspect_mismatch(room: Path, tmp_path: Path):
    square = tmp_path / "square.png"
    Image.new("RGB", (512, 512)).save(square)
    assert not aspect_ok(room, square)
