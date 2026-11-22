"""SSRF-safe image download for venue photos found on the web (only after the user confirms an import).

Guards: http/https only; no credentials in URLs; every hostname is resolved and *every* address must be public
(private, loopback, link-local, multicast, reserved, unspecified, shared/CGNAT, IPv4-mapped/6to4/NAT64 forms
of those are rejected, for IPv4 and IPv6); the connection is pinned to the validated IP (Host header and TLS SNI
keep the real hostname), so a second DNS answer cannot redirect it (DNS rebinding); redirects are followed by
hand (max 5) and each hop is re-validated; 15 s network timeout; only image/* content types we can decode;
streamed with a byte cap; decoded with Pillow (decompression-bomb guarded) and re-saved without any metadata
(EXIF/GPS/XMP dropped, orientation applied first). Any violation raises `FetchError`.
"""
from __future__ import annotations

import asyncio
import io
import ipaddress
import socket
import uuid
import warnings
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from PIL import Image, ImageOps

from ._images import register_heif

register_heif()

TIMEOUT_S = 15.0
MAX_REDIRECTS = 5
MAX_PIXELS = 80_000_000
ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "JPEG", "image/jpg": "JPEG", "image/pjpeg": "JPEG",
    "image/png": "PNG", "image/webp": "WEBP",
    "image/heic": "HEIF", "image/heif": "HEIF", "image/heic-sequence": "HEIF", "image/heif-sequence": "HEIF",
    "image/avif": "AVIF",
}
_DECODED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP", "HEIF", "AVIF"}
_REDIRECTS = {301, 302, 303, 307, 308}
_USER_AGENT = "VenueVisualizer/0.1 (local personal planning tool; image import)"

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


class FetchError(RuntimeError):
    pass


def _embedded_v4(ip: ipaddress.IPv6Address) -> ipaddress.IPv4Address | None:
    if ip.ipv4_mapped:
        return ip.ipv4_mapped
    if ip.sixtofour:
        return ip.sixtofour
    if ip.teredo:
        return ip.teredo[1]
    if ip in ipaddress.ip_network("64:ff9b::/96"):  # NAT64
        return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return None


def is_public_ip(ip: IPAddress | str) -> bool:
    """True only for globally routable unicast addresses (IPv4 and IPv6, incl. embedded IPv4 forms)."""
    ip = ipaddress.ip_address(ip)
    if isinstance(ip, ipaddress.IPv6Address):
        inner = _embedded_v4(ip)
        if inner is not None and not is_public_ip(inner):
            return False
    return not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
        or ip.is_unspecified or not ip.is_global
    )


async def resolve_host(host: str, port: int) -> list[str]:
    """All addresses `host` resolves to (module-level so tests can monkeypatch it)."""
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise FetchError(f"could not resolve {host!r}: {e}") from e
    return list(dict.fromkeys(info[4][0] for info in infos))


async def validate_url(url: str) -> tuple[httpx.URL, str]:
    """Check scheme/host and resolve; return (parsed URL, the public IP to connect to)."""
    try:
        parts = urlsplit(url)
        parsed = httpx.URL(url)
    except (ValueError, httpx.InvalidURL) as e:
        raise FetchError(f"invalid URL {url!r}: {e}") from e
    if parts.scheme.lower() not in ("http", "https"):
        raise FetchError(f"only http(s) URLs can be downloaded, not {parts.scheme or 'no scheme'!r}")
    if parts.username or parts.password:
        raise FetchError("URLs with embedded credentials are not allowed")
    host = (parsed.host or "").strip().rstrip(".")
    if not host:
        raise FetchError(f"URL has no host: {url!r}")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        literal: IPAddress | None = ipaddress.ip_address(host.strip("[]").split("%")[0])
    except ValueError:
        literal = None
    if literal is not None:
        addresses = [str(literal)]
    else:
        if host.lower() == "localhost" or host.lower().endswith(".localhost"):
            raise FetchError(f"refusing to fetch from {host!r}: not a public host")
        addresses = await resolve_host(host, port)
    if not addresses:
        raise FetchError(f"{host!r} did not resolve to any address")
    for addr in addresses:
        try:
            ok = is_public_ip(addr.split("%")[0])
        except ValueError:
            ok = False
        if not ok:
            raise FetchError(f"refusing to fetch {host!r}: it resolves to non-public address {addr}")
    return parsed, addresses[0].split("%")[0]


def _pinned_request(client: httpx.AsyncClient, url: httpx.URL, ip: str) -> httpx.Request:
    host_header = url.host if url.port is None else f"{url.host}:{url.port}"
    headers = {"Host": host_header, "User-Agent": _USER_AGENT,
               "Accept": "image/avif,image/webp,image/png,image/jpeg,image/heic;q=0.9"}
    extensions = {"sni_hostname": url.host} if url.scheme == "https" else {}
    return client.build_request("GET", url.copy_with(host=ip), headers=headers, extensions=extensions)


def _media_type(content_type: str | None) -> str:
    return (content_type or "").split(";")[0].strip().lower()


async def _read_capped(resp: httpx.Response, max_bytes: int) -> bytes:
    length = resp.headers.get("content-length")
    if length and length.isdigit() and int(length) > max_bytes:
        raise FetchError(f"image is too large ({int(length):,} bytes > {max_bytes:,})")
    buf = bytearray()
    async for chunk in resp.aiter_bytes():
        buf += chunk
        if len(buf) > max_bytes:
            raise FetchError(f"image is too large (> {max_bytes:,} bytes)")
    return bytes(buf)


def _clean_and_save(data: bytes, dest_dir: Path) -> Path:
    """Decode, apply EXIF orientation, drop all metadata and save under a random name."""
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(data)) as im:
                fmt = (im.format or "").upper()
                if fmt not in _DECODED_FORMATS:
                    raise FetchError(f"unsupported image format {fmt or 'unknown'}")
                if im.width * im.height > MAX_PIXELS:
                    raise FetchError(f"image is too large ({im.width}x{im.height} pixels)")
                im.load()
                icc = im.info.get("icc_profile")
                img = ImageOps.exif_transpose(im)
        except FetchError:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as e:
            raise FetchError(f"image is too large to decode safely: {e}") from e
        except Exception as e:  # any decoder failure means "not a usable image"
            raise FetchError(f"downloaded file is not a valid image: {e}") from e
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
    if fmt in ("PNG", "WEBP"):
        target, ext = fmt, (".png" if fmt == "PNG" else ".webp")
        mode = "RGBA" if has_alpha else ("L" if img.mode == "L" else "RGB")
    else:
        target, ext, mode = "JPEG", ".jpg", ("L" if img.mode == "L" else "RGB")
    img = img.convert(mode)
    clean = Image.frombytes(img.mode, img.size, img.tobytes())  # pixels only: no EXIF/GPS/XMP/text chunks
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"{uuid.uuid4().hex}{ext}"
    opts: dict = {"icc_profile": icc} if icc else {}
    if target == "JPEG":
        opts.update(quality=92, optimize=True)
    elif target == "WEBP":
        opts.update(quality=92)
    clean.save(out, target, **opts)
    return out


async def download_image(url: str, dest_dir: Path, max_bytes: int = 20_000_000, *,
                         transport: httpx.AsyncBaseTransport | None = None,
                         timeout_s: float = TIMEOUT_S) -> Path:
    """Download one image safely into `dest_dir` and return its path (random uuid file name)."""
    current = url
    async with httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(timeout_s),
                                 follow_redirects=False, trust_env=False) as client:
        for _hop in range(MAX_REDIRECTS + 1):
            parsed, ip = await validate_url(current)
            try:
                resp = await client.send(_pinned_request(client, parsed, ip), stream=True)
            except httpx.TimeoutException as e:
                raise FetchError(f"timed out fetching {current} (>{timeout_s:g}s)") from e
            except httpx.HTTPError as e:
                raise FetchError(f"could not fetch {current}: {e}") from e
            try:
                if resp.status_code in _REDIRECTS:
                    location = resp.headers.get("location")
                    if not location:
                        raise FetchError(f"redirect from {current} without a Location header")
                    current = urljoin(str(parsed), location)
                    continue
                if resp.status_code != 200:
                    raise FetchError(f"{current} returned HTTP {resp.status_code}")
                ctype = _media_type(resp.headers.get("content-type"))
                if ctype not in ALLOWED_CONTENT_TYPES:
                    raise FetchError(f"{current} is not a supported image (content-type {ctype or 'missing'!r})")
                try:
                    data = await _read_capped(resp, max_bytes)
                except httpx.TimeoutException as e:
                    raise FetchError(f"timed out downloading {current} (>{timeout_s:g}s)") from e
                except httpx.HTTPError as e:
                    raise FetchError(f"download of {current} failed: {e}") from e
            finally:
                await resp.aclose()
            return await asyncio.to_thread(_clean_and_save, data, Path(dest_dir))
    raise FetchError(f"too many redirects (> {MAX_REDIRECTS}) starting from {url}")
