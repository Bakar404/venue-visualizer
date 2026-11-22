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


def _plain(path: Path, top=(235, 235, 235), bottom=(120, 90, 60), size=(320, 240)) -> Path:
    img = Image.new("RGB", size, top)
    img.paste(bottom, (0, int(size[1] * 0.6), size[0], size[1]))
    img.save(path)
    return path


def test_featureless_ceiling_falls_back_to_grayscale(tmp_path: Path):
    from PIL import ImageDraw

    from pipeline.verify import structure_report

    plain = _plain(tmp_path / "plain.png")
    same = structure_report(plain, plain)
    assert same["method"] == "flat" and same["flat"] and same["score"] == 0.75
    assert same["edge_density"] < 0.005
    gradient = Image.open(plain).copy()
    draw = ImageDraw.Draw(gradient)
    for y in range(96):
        draw.line([(0, y), (320, y)], fill=(255 - 2 * y, 255 - 2 * y, 255 - 2 * y))
    gradient.save(tmp_path / "grad.png")
    smooth = structure_report(tmp_path / "grad.png", tmp_path / "grad.png")
    assert smooth["method"] == "gray" and smooth["score"] > 0.99 and not smooth["flat"]
    # the render paints busy structure where the original's plain ceiling was: gray SSIM catches it
    broken = structure_report(tmp_path / "grad.png", make_room(tmp_path / "busy.png"))
    assert broken["method"] == "gray" and broken["score"] < smooth["score"]
    assert structure_score(tmp_path / "grad.png", tmp_path / "grad.png") == smooth["score"]


def test_edge_rich_rooms_still_use_edges(room: Path):
    from pipeline.verify import structure_report

    report = structure_report(room, room)
    assert report["method"] == "edges" and report["edge_density"] >= 0.005
