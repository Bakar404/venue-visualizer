from __future__ import annotations

import io
from pathlib import Path

import httpx
import pytest
from PIL import Image

from pipeline import fetch
from pipeline.fetch import FetchError, download_image


def _png_bytes(size=(64, 48), exif: bool = False) -> bytes:
    img = Image.new("RGB", size, (200, 30, 30))
    buf = io.BytesIO()
    if exif:
        ex = Image.Exif()
        ex[0x010F] = "SecretCam"  # Make
        ex[0x0112] = 6            # Orientation: rotate 90° CW
        img.save(buf, "JPEG", exif=ex.tobytes())
    else:
        img.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def public_dns(monkeypatch: pytest.MonkeyPatch):
    """Offline DNS: a public host, a host resolving to a private IP and one with mixed answers."""
    table = {"photos.example.com": ["93.184.215.14"], "evil.example.com": ["10.0.0.5"],
             "mixed.example.com": ["93.184.215.14", "192.168.1.10"]}

    async def fake_resolve(host: str, port: int) -> list[str]:
        if host not in table:
            raise FetchError(f"could not resolve {host!r}")
        return table[host]

    monkeypatch.setattr(fetch, "resolve_host", fake_resolve)
    return table


def _transport(routes: dict[str, httpx.Response], seen: list[httpx.Request] | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return routes.get(request.url.path, httpx.Response(404))
    return httpx.MockTransport(handler)


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "ftp://photos.example.com/a.png",
    "http://127.0.0.1/a.png",
    "http://10.1.2.3/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/a.png",
    "http://[::ffff:127.0.0.1]/a.png",
    "http://0.0.0.0/a.png",
    "http://localhost/a.png",
    "http://evil.example.com/a.png",
    "http://mixed.example.com/a.png",
    "http://user:pw@photos.example.com/a.png",
])
async def test_rejects_unsafe_urls(tmp_path: Path, url: str):
    seen: list[httpx.Request] = []
    with pytest.raises(FetchError):
        await download_image(url, tmp_path, transport=_transport({}, seen))
    assert seen == [] and not any(tmp_path.iterdir())


async def test_accepts_served_png_and_pins_ip(tmp_path: Path):
    seen: list[httpx.Request] = []
    routes = {"/room.png": httpx.Response(200, headers={"content-type": "image/png"}, content=_png_bytes())}
    out = await download_image("https://photos.example.com/room.png", tmp_path / "dl", transport=_transport(routes, seen))
    assert out.parent == tmp_path / "dl" and out.suffix == ".png" and len(out.stem) == 32
    with Image.open(out) as im:
        assert im.size == (64, 48)
    assert seen[0].url.host == "93.184.215.14" and seen[0].headers["host"] == "photos.example.com"


async def test_strips_exif_and_applies_orientation(tmp_path: Path):
    routes = {"/p.jpg": httpx.Response(200, headers={"content-type": "image/jpeg"},
                                       content=_png_bytes((80, 40), exif=True))}
    out = await download_image("https://photos.example.com/p.jpg", tmp_path, transport=_transport(routes))
    with Image.open(out) as im:
        assert im.size == (40, 80)  # rotated upright
        assert not im.getexif() and "exif" not in im.info


async def test_redirect_to_private_ip_is_rejected(tmp_path: Path):
    seen: list[httpx.Request] = []
    routes = {"/a.png": httpx.Response(302, headers={"location": "http://192.168.0.1/admin.png"})}
    with pytest.raises(FetchError, match="non-public"):
        await download_image("https://photos.example.com/a.png", tmp_path, transport=_transport(routes, seen))
    assert len(seen) == 1


async def test_redirect_to_private_hostname_and_too_many_redirects(tmp_path: Path):
    routes = {"/a.png": httpx.Response(301, headers={"location": "http://evil.example.com/b.png"})}
    with pytest.raises(FetchError, match="non-public"):
        await download_image("https://photos.example.com/a.png", tmp_path, transport=_transport(routes))
    loop = {"/loop": httpx.Response(302, headers={"location": "/loop"})}
    with pytest.raises(FetchError, match="too many redirects"):
        await download_image("https://photos.example.com/loop", tmp_path, transport=_transport(loop))


async def test_follows_safe_relative_redirect(tmp_path: Path):
    routes = {"/old.png": httpx.Response(302, headers={"location": "/new.png"}),
              "/new.png": httpx.Response(200, headers={"content-type": "image/png"}, content=_png_bytes())}
    out = await download_image("https://photos.example.com/old.png", tmp_path, transport=_transport(routes))
    assert out.exists()


@pytest.mark.parametrize("ctype", ["text/html", "image/svg+xml", "application/octet-stream", ""])
async def test_rejects_non_image_content_type(tmp_path: Path, ctype: str):
    routes = {"/a": httpx.Response(200, headers={"content-type": ctype}, content=_png_bytes())}
    with pytest.raises(FetchError, match="not a supported image"):
        await download_image("https://photos.example.com/a", tmp_path, transport=_transport(routes))


async def test_rejects_oversize_body(tmp_path: Path):
    big = _png_bytes()
    routes = {"/a.png": httpx.Response(200, headers={"content-type": "image/png"}, content=big)}
    with pytest.raises(FetchError, match="too large"):
        await download_image("https://photos.example.com/a.png", tmp_path, max_bytes=len(big) - 1,
                             transport=_transport(routes))

    def streamed(request: httpx.Request) -> httpx.Response:  # no Content-Length: the stream cap must trip
        return httpx.Response(200, headers={"content-type": "image/png"},
                              stream=httpx.ByteStream(b"\0" * 5000))
    with pytest.raises(FetchError, match="too large"):
        await download_image("https://photos.example.com/a.png", tmp_path, max_bytes=1000,
                             transport=httpx.MockTransport(streamed))
    assert not any(tmp_path.iterdir())


async def test_rejects_bytes_that_are_not_an_image(tmp_path: Path):
    routes = {"/a.png": httpx.Response(200, headers={"content-type": "image/png"}, content=b"<html>hi</html>")}
    with pytest.raises(FetchError, match="not a valid image"):
        await download_image("https://photos.example.com/a.png", tmp_path, transport=_transport(routes))


def test_is_public_ip():
    for ip in ("127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "224.0.0.1",
               "0.0.0.0", "240.0.0.1", "::1", "fe80::1", "fc00::1", "ff02::1", "::ffff:10.0.0.1",
               "2002:a00:1::", "64:ff9b::7f00:1"):
        assert not fetch.is_public_ip(ip), ip
    for ip in ("93.184.215.14", "8.8.8.8", "2606:4700:4700::1111"):
        assert fetch.is_public_ip(ip), ip
