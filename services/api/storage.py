import json
import logging
import math
import os
import re
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from typing import BinaryIO

from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

from .integrations import IntegrationError, invoke, pipeline_module, pipeline_output

log = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 20_000_000
MAX_VIDEO_BYTES = 1_000_000_000
MAX_VIDEO_SECONDS = 300
MAX_PHOTOS = 30
MAX_WEB_PHOTOS = 12
VIDEO_SUFFIXES = {".mp4", ".mov", ".webm", ".m4v"}  # HEVC is accepted inside .mov/.mp4 (iPhone); raw .hevc streams have no duration
IMAGE_SUFFIX = {"JPEG": ".jpg", "MPO": ".jpg", "PNG": ".png", "WEBP": ".webp", "HEIF": ".jpg"}
MEDIA_TYPES = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
_ID = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
_MEDIA = re.compile(rf"venues/{_ID}/(?:photos|renders)/{_ID}\.(?:jpg|png|webp)")
register_heif_opener()


class InvalidMedia(ValueError):
    pass


class MediaTooLarge(InvalidMedia):
    pass


@dataclass(frozen=True)
class CleanImage:
    path: Path
    width: int
    height: int


def media_path(root: Path, relative: str) -> Path:
    if not _MEDIA.fullmatch(relative):
        raise FileNotFoundError("Image not found")
    path = root / relative
    # Do not serve aliases, even ones pointing to another location within the data directory.
    if path.resolve() != path:
        raise FileNotFoundError("Image not found")
    return path


def photo_path(venue_id: str, photo_id: str, image: CleanImage) -> str:
    return f"venues/{venue_id}/photos/{photo_id}{image.path.suffix}"


def read_bounded(source: BinaryIO, dest: BinaryIO, limit: int) -> None:
    size = 0
    while chunk := source.read(1024 * 1024):
        size += len(chunk)
        if size > limit:
            raise MediaTooLarge(f"File exceeds the {limit:,}-byte limit")
        dest.write(chunk)
    if size == 0:
        raise InvalidMedia("File is empty")


@contextmanager
def atomic_file(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        try:
            yield tmp
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp.close()
            os.replace(tmp.name, path)
        finally:
            Path(tmp.name).unlink(missing_ok=True)


def save_video(source: BinaryIO, path: Path) -> None:
    with atomic_file(path) as output:
        read_bounded(source, output, MAX_VIDEO_BYTES)


def validate_video_duration(path: Path) -> None:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-protocol_whitelist", "file",
                "-format_whitelist", "mov,matroska,webm,m4v,hevc", "-select_streams", "V:0",
                "-show_entries", "format=duration:stream=duration", "-of", "json", "-i", str(path),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=30,
        )
    except FileNotFoundError as exc:
        raise IntegrationError(503, "ffprobe is required to validate venue tours; install ffmpeg") from exc
    except subprocess.TimeoutExpired as exc:
        raise InvalidMedia("Timed out checking the video duration") from exc
    except subprocess.CalledProcessError as exc:
        raise InvalidMedia("File could not be decoded as a video") from exc
    try:
        info = json.loads(result.stdout)
        streams = info.get("streams", [])
        durations = [
            float(value)
            for entry in [*streams, info.get("format", {})]
            if (value := entry.get("duration")) not in (None, "N/A")
        ]
    except (ValueError, TypeError) as exc:
        raise InvalidMedia("Could not determine the video duration") from exc
    if not streams or not durations or not all(math.isfinite(value) and value > 0 for value in durations):
        raise InvalidMedia("Could not determine the video duration; use a video container such as MP4")
    if max(durations) > MAX_VIDEO_SECONDS:
        raise InvalidMedia("Venue tours must be at most five minutes long")


def clean_image(source: BinaryIO | Path, stem: Path, max_bytes: int | None = MAX_IMAGE_BYTES) -> CleanImage:
    size = source.stat().st_size if isinstance(source, Path) else source.seek(0, os.SEEK_END)
    if not isinstance(source, Path):
        source.seek(0)
    if max_bytes is not None and size > max_bytes:
        raise MediaTooLarge(f"Image exceeds the {max_bytes:,}-byte limit")
    try:
        with Image.open(source) as image:
            suffix = IMAGE_SUFFIX.get(image.format or "")
            if suffix is None:
                raise InvalidMedia("Only JPEG, PNG, WebP and HEIC images are accepted")
            if image.width * image.height > 50_000_000:
                raise MediaTooLarge("Image exceeds the 50-megapixel limit")
            image.load()
            oriented = ImageOps.exif_transpose(image)
            mode = (
                "RGBA"
                if suffix != ".jpg" and ("A" in oriented.getbands() or "transparency" in oriented.info)
                else "RGB"
            )
            normalized = oriented.convert(mode)
            normalized.info.clear()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as exc:
        raise InvalidMedia("File could not be decoded as an image") from exc
    dest = stem.with_suffix(suffix)
    with atomic_file(dest) as output:
        normalized.save(output, format={".jpg": "JPEG", ".png": "PNG", ".webp": "WEBP"}[suffix])
    return CleanImage(dest, normalized.width, normalized.height)


async def download_reference(url: str, folder: Path) -> CleanImage:
    fetch = pipeline_module("fetch", "download_image", "FetchError")
    try:
        path = await invoke(fetch.download_image, url, folder)
        return await invoke(clean_image, pipeline_output(path, folder), folder / "reference")
    except (fetch.FetchError, InvalidMedia) as exc:
        raise IntegrationError(502, f"Could not load a venue reference: {exc}") from exc


@contextmanager
def staging(root: Path) -> Iterator[Path]:
    parent = root / "tmp"
    parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="stage-", dir=parent) as work:
        yield Path(work)


def remove_files(paths: list[Path]) -> None:
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            log.exception("Could not remove %s", path)


@contextmanager
def publish() -> Iterator[list[Path]]:
    published: list[Path] = []
    try:
        yield published
    except BaseException:
        remove_files(published)
        raise


def publish_image(root: Path, source: Path, relative: str, published: list[Path]) -> None:
    dest = media_path(root, relative)
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.replace(source, dest)
    published.append(dest)
