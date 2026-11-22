"""Offline mock image engine (Pillow). Always available; used for tests and keyless demos.

generate: a 1536x1024-ish neutral "empty room" gradient (floor, back wall, horizon line).
edit: the input photo. Both get a warm tint and a caption bar showing the prompt.
"""
from __future__ import annotations

import time
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .._images import register_heif
from .base import EditRequest, EngineCaps, EngineStatus, GenerateRequest, ImageResult

register_heif()

_WARM = (255, 196, 130)


def _size(size: str) -> tuple[int, int]:
    if size in ("1024x1024", "1536x1024", "1024x1536"):
        w, h = size.split("x")
        return int(w), int(h)
    return 1536, 1024


def room_gradient(width: int, height: int) -> Image.Image:
    """A neutral room-ish backdrop: lighter back wall fading down to a darker floor."""
    horizon = int(height * 0.58)
    wall = Image.linear_gradient("L").resize((width, horizon)).point(lambda v: 205 + v * 30 // 255)
    floor = Image.linear_gradient("L").resize((width, height - horizon)).point(lambda v: 150 - v * 70 // 255)
    gray = Image.new("L", (width, height))
    gray.paste(wall, (0, 0))
    gray.paste(floor, (0, horizon))
    img = ImageOps.colorize(gray, black=(70, 62, 55), white=(238, 232, 222))
    draw = ImageDraw.Draw(img)
    draw.line([(0, horizon), (width, horizon)], fill=(120, 110, 100), width=3)
    for x in (width // 6, width // 2, 5 * width // 6):  # window-ish panels on the back wall
        draw.rectangle([x - width // 16, height // 10, x + width // 16, horizon - height // 8],
                       outline=(180, 172, 160), width=4)
    return img


def warm_tint(img: Image.Image, strength: float = 0.22) -> Image.Image:
    rgb = img.convert("RGB")
    return Image.blend(rgb, Image.new("RGB", rgb.size, _WARM), strength)


def _font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    lines: list[str] = []
    for para in text.splitlines() or [""]:
        line = ""
        for word in para.split():
            trial = f"{line} {word}".strip()
            if draw.textlength(trial, font=font) <= max_width or not line:
                line = trial
            else:
                lines.append(line)
                line = word
        if line:
            lines.append(line)
    return lines


def caption(img: Image.Image, text: str, label: str = "MOCK RENDER") -> Image.Image:
    img = img.convert("RGB")
    w, h = img.size
    size = max(12, w // 70)
    font = _font(size)
    draw = ImageDraw.Draw(img)
    lines = _wrap(draw, f"{label}: {' '.join(text.split())}", font, w - 2 * size)
    max_lines = max(1, int(h * 0.22) // (size + 4))
    if len(lines) > max_lines:
        lines = lines[: max_lines - 1] + [lines[max_lines - 1][: max(0, len(lines[max_lines - 1]) - 1)] + "…"]
    bar_h = len(lines) * (size + 4) + size
    overlay = Image.new("RGBA", (w, bar_h), (20, 16, 12, 190))
    img.paste(overlay, (0, h - bar_h), overlay)
    y = h - bar_h + size // 2
    for line in lines:
        draw.text((size, y), line, fill=(250, 244, 235), font=font)
        y += size + 4
    return img


class MockEngine:
    id = "mock"
    label = "Offline mock (Pillow)"

    def detect(self) -> EngineStatus:
        return EngineStatus(available=True, logged_in=True, version="1", detail="local placeholder renders")

    def capabilities(self) -> EngineCaps:
        return EngineCaps(can_generate=True, can_edit=True, photoreal=False, typical_seconds=1,
                          cost_note="Free (placeholder, not a real render)", max_refs=0,
                          sizes=("1024x1024", "1536x1024", "1024x1536"))

    def _save(self, img: Image.Image, out_path: Path, start: float, log: str) -> ImageResult:
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(out_path)
        return ImageResult(path=out_path, width=img.width, height=img.height, engine=self.id,
                           seconds=time.monotonic() - start, raw_log=log)

    async def generate(self, req: GenerateRequest) -> ImageResult:
        start = time.monotonic()
        img = caption(warm_tint(room_gradient(*_size(req.size)), 0.12), req.prompt)
        return self._save(img, req.out_path, start, f"mock generate crc={zlib.crc32(req.prompt.encode()):08x}")

    async def edit(self, req: EditRequest) -> ImageResult:
        start = time.monotonic()
        with Image.open(req.input_image) as im:
            src = ImageOps.exif_transpose(im).convert("RGB")
        img = caption(warm_tint(src), req.prompt)
        return self._save(img, req.out_path, start, f"mock edit of {Path(req.input_image).name}")
