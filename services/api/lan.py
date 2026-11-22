"""Private-network discovery, device pairing and local proxy identity.

LAN mode is only on under `make dev-lan` (VV_LAN=1 plus a per-run VV_LAN_PROXY_KEY). See docs/decisions.md,
"LAN mode security model".
"""

import asyncio
import hmac
import io
import logging
import re
import secrets
import socket
import time
from collections import deque
from collections.abc import Iterator
from datetime import UTC, datetime
from hashlib import sha256
from ipaddress import IPv4Address, IPv6Address, ip_address, ip_network
from math import ceil
from threading import Lock

import segno
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from .config import Settings as Config
from .contracts import Input
from .db import write_session
from .deps import RuntimeDep
from .models import LanDevice, Settings
from .settings import row

router = APIRouter(prefix="/api/system/lan", tags=["system"])
log = logging.getLogger("uvicorn.error")
COOKIE = "vv_lan_device"
DEVICE_SECONDS = 30 * 24 * 60 * 60
SEEN_SECONDS = 60
ATTEMPT_SECONDS = 10 * 60
MAX_FAILURES = 5
CODE_SECONDS = 10 * 60
MAX_CODE_FAILURES = 10
LOCK_SECONDS = 5 * 60
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]"})
OPEN_SETUP = "Open Setup → Open on your phone on this computer to see the pairing code"
_PRIVATE = tuple(map(ip_network, ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")))
# Container bridges, hypervisor host-only networks, VPN tunnels and Apple peer-to-peer links: a phone on the
# Wi-Fi can't reach these addresses, and listing them would widen the allowed hosts for nothing.
_VIRTUAL = re.compile(
    r"^(docker|br-|bridge|veth|virbr|vboxnet|vmnet|vnic|utun|tun|tap|wg|ppp|ipsec|gif|stf|awdl|llw|anpi|zt|"
    r"tailscale|lxc|lxd|cni|flannel|cali|kube|podman)|vpn|virtual|hyper-v|vethernet|wireguard|zerotier",
    re.IGNORECASE,
)
# Any public address works: connecting a UDP socket only selects a route, it sends nothing.
_ROUTE_PROBE = ("1.1.1.1", 53)
_WEB_CHECKS = (0, 5, 15, 45)


class LanOut(BaseModel):
    enabled: bool
    url: str | None
    qr_svg: str | None
    pairing_code: str | None
    pairing_required: bool = True
    pairing_expires_in: int | None = None
    pairing_locked_for: int | None = None


class LanDeviceOut(BaseModel):
    id: str
    label: str
    paired_at: datetime
    last_seen: datetime
    expires_at: datetime


class PairIn(Input):
    code: str = Field(max_length=64)


def enabled(config: Config) -> bool:
    return config.lan_mode


def _adapters() -> Iterator[tuple[str, str]]:
    import ifaddr

    for adapter in ifaddr.get_adapters():
        name = f"{getattr(adapter, 'name', '') or ''} {getattr(adapter, 'nice_name', '') or ''}".strip()
        for ip in adapter.ips:
            if ip.is_IPv4 and normalize_ip(str(ip.ip)) is not None:
                yield name, str(ip.ip)


def _virtual(name: str) -> bool:
    return any(_VIRTUAL.search(part) for part in name.split())


def _default_route_address() -> str | None:
    """The source address the OS picks for the default route (UDP connect sends no packets)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(_ROUTE_PROBE)
            return probe.getsockname()[0]
    except OSError:
        return None


def addresses() -> tuple[str, ...]:
    """Private IPv4 addresses of physical interfaces, the default route's address first."""
    found = tuple(dict.fromkeys(
        addr for name, addr in _adapters()
        if not _virtual(name) and any(IPv4Address(addr) in net for net in _PRIVATE)
    ))
    route = _default_route_address()
    return (route, *(addr for addr in found if addr != route)) if route in found else found


def _interface_addresses() -> tuple[str, ...]:
    """Every non-loopback IPv4 address of this machine, virtual interfaces included."""
    return tuple(dict.fromkeys(addr for _, addr in _adapters() if not IPv4Address(addr).is_loopback))


def exposed_web(port: int) -> list[str]:
    """`addr:port` for each non-loopback interface address where something accepts connections on `port`."""
    found = []
    for addr in _interface_addresses():
        try:
            with socket.create_connection((addr, port), timeout=0.25):
                found.append(f"{addr}:{port}")
        except OSError:
            pass
    return found


async def watch_web_exposure(port: int) -> None:
    """Outside LAN mode the web must listen on 127.0.0.1 only; warn if it can be reached from the network."""
    for delay in _WEB_CHECKS:
        await asyncio.sleep(delay)
        exposed = await asyncio.to_thread(exposed_web, port)
        if exposed:
            log.warning(
                "The web server is listening on %s while LAN mode is off, so devices on this network may reach "
                "it. Restart with `make dev` (binds 127.0.0.1), or use `make dev-lan` to pair a phone.",
                ", ".join(exposed),
            )
            return


def normalize_ip(value: str) -> IPv4Address | IPv6Address | None:
    try:
        ip = ip_address(value.strip())
    except ValueError:
        return None
    return (ip.ipv4_mapped or ip) if isinstance(ip, IPv6Address) else ip


def _signature(key: str, value: str) -> str:
    return hmac.digest(key.encode(), value.encode(), "sha256").hex()


def _valid_signature(key: str, value: str, signature: str) -> bool:
    return signature.isascii() and hmac.compare_digest(_signature(key, value), signature)


def proxy_client(key: str | None, header: str) -> IPv4Address | IPv6Address | None:
    ip, _, signature = header.rpartition(".")
    parsed = normalize_ip(ip)
    return parsed if parsed is not None and key and _valid_signature(key, ip, signature) else None


def valid_device(session: Session, settings: Settings, cookie: str) -> LanDevice | None:
    token, _, signature = cookie.partition(".")
    if len(token) != 43 or not token.isascii() or not _valid_signature(settings.lan_signing_key, token, signature):
        return None
    device = session.get(LanDevice, sha256(token.encode()).hexdigest())
    return device if device is not None and device.expires_at > time.time() else None


def touch(engine: Engine, device: LanDevice) -> None:
    now = int(time.time())
    if now - device.last_seen < SEEN_SECONDS:
        return
    with write_session(engine) as session:
        saved = session.get(LanDevice, device.token_hash)
        if saved is not None:
            saved.last_seen = now
            session.add(saved)


_PLATFORMS = (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"), ("CrOS", "ChromeOS"),
              ("Macintosh", "Mac"), ("Windows", "Windows"), ("Linux", "Linux"))
_BROWSERS = (("EdgA/", "Edge"), ("EdgiOS/", "Edge"), ("Edg/", "Edge"), ("OPR/", "Opera"),
             ("SamsungBrowser/", "Samsung Internet"), ("CriOS/", "Chrome"), ("FxiOS/", "Firefox"),
             ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari"))


def device_label(user_agent: str) -> str:
    """A short label from known User-Agent tokens; the raw header is never stored."""
    platform = next((label for token, label in _PLATFORMS if token in user_agent), None)
    browser = next((label for token, label in _BROWSERS if token in user_agent), None)
    return " · ".join(part for part in (platform, browser) if part) or "Unknown device"


class Pairing:
    """The one-time pairing code. It exists only after the owner opens the panel and is never logged."""

    def __init__(self) -> None:
        self.code: str | None = None
        self._previous: str | None = None
        self._expires = 0.0
        self._code_failures = 0
        self._locked_until = 0.0
        self._failures: dict[str, deque[float]] = {}
        self._lock = Lock()

    @staticmethod
    def announce() -> None:
        log.info("Venue Visualizer LAN mode is on. %s.", OPEN_SETUP)

    def _retire(self) -> None:
        self._previous, self.code, self._code_failures = self.code or self._previous, None, 0

    def show(self) -> tuple[str | None, int | None, int | None]:
        """Issue or refresh the code for the owner's panel: (code, expires_in, locked_for)."""
        with self._lock:
            now = time.monotonic()
            if now < self._locked_until:
                return None, None, ceil(self._locked_until - now)
            if self.code is None or now >= self._expires:
                self._retire()
                while (code := f"{secrets.randbelow(1_000_000):06d}") == self._previous:
                    pass
                self.code = code
            self._expires = now + CODE_SECONDS
            return self.code, CODE_SECONDS, None

    def check(self, ip: str, code: str) -> None:
        with self._lock:
            now = time.monotonic()
            for key, failures in list(self._failures.items()):
                while failures and now - failures[0] >= ATTEMPT_SECONDS:
                    failures.popleft()
                if not failures:
                    del self._failures[key]
            if now < self._locked_until:
                retry = ceil(self._locked_until - now)
                raise HTTPException(429, "Too many attempts. Try again later.", headers={"Retry-After": str(retry)})
            failures = self._failures.get(ip)
            if failures and len(failures) >= MAX_FAILURES:
                retry = ceil(ATTEMPT_SECONDS - (now - failures[0]))
                raise HTTPException(429, "Too many attempts. Try again later.", headers={"Retry-After": str(retry)})
            if self.code is None or now >= self._expires:
                self._retire()
                raise HTTPException(403, f"No pairing code is active. {OPEN_SETUP}.")
            if not code.isascii() or not hmac.compare_digest(self.code, code):
                self._failures.setdefault(ip, deque()).append(now)
                self._code_failures += 1
                if self._code_failures >= MAX_CODE_FAILURES:
                    self._retire()
                    self._locked_until = now + LOCK_SECONDS
                    log.warning("Pairing is locked for %d minutes after %d incorrect codes.",
                                LOCK_SECONDS // 60, MAX_CODE_FAILURES)
                raise HTTPException(403, "Incorrect pairing code.")
            self._retire()


def _require_owner(request: Request, detail: str) -> None:
    if not request.state.owner:
        raise HTTPException(403, detail)


@router.get("")
def lan_info(runtime: RuntimeDep, request: Request, response: Response) -> LanOut:
    _require_owner(request, "LAN pairing information is only available from localhost.")
    response.headers["Cache-Control"] = "no-store"
    if not enabled(runtime.settings):
        return LanOut(enabled=False, url=None, qr_svg=None, pairing_code=None)
    pairing: Pairing = request.app.state.pairing
    code, expires_in, locked_for = pairing.show()
    hosts = addresses()
    url = f"http://{hosts[0]}:{runtime.settings.web_port}" if hosts else None
    svg = None
    if url:
        output = io.BytesIO()
        segno.make_qr(url).save(output, kind="svg", scale=4, xmldecl=False, dark="#000", light="#fff")
        svg = output.getvalue().decode("utf-8")
    return LanOut(enabled=True, url=url, qr_svg=svg, pairing_code=code, pairing_expires_in=expires_in,
                  pairing_locked_for=locked_for)


@router.post("/pair")
def pair(body: PairIn, runtime: RuntimeDep, request: Request, response: Response) -> dict[str, bool]:
    if not enabled(runtime.settings):
        raise HTTPException(403, "LAN mode is disabled.")
    if not request.state.lan_remote or request.state.client_ip is None:
        raise HTTPException(403, "Pair from the phone using the LAN URL.")
    pairing: Pairing = request.app.state.pairing
    pairing.check(str(request.state.client_ip), body.code)
    token = secrets.token_urlsafe(32)
    with write_session(runtime.engine) as session:
        now = int(time.time())
        key = row(session).lan_signing_key
        session.exec(delete(LanDevice).where(LanDevice.expires_at <= now))
        session.add(LanDevice(
            token_hash=sha256(token.encode()).hexdigest(), label=device_label(request.headers.get("user-agent", "")),
            paired_at=now, last_seen=now, expires_at=now + DEVICE_SECONDS,
        ))
    response.set_cookie(COOKIE, f"{token}.{_signature(key, token)}", max_age=DEVICE_SECONDS,
                        httponly=True, samesite="strict", secure=request.url.scheme == "https")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


def _timestamp(value: int) -> datetime:
    return datetime.fromtimestamp(value, UTC)


@router.get("/devices")
def list_devices(runtime: RuntimeDep, request: Request, response: Response) -> list[LanDeviceOut]:
    _require_owner(request, "Paired devices are only listed on this computer.")
    response.headers["Cache-Control"] = "no-store"
    with Session(runtime.engine) as session:
        devices = session.exec(
            select(LanDevice).where(LanDevice.expires_at > time.time()).order_by(LanDevice.paired_at)
        ).all()
        return [
            LanDeviceOut(id=d.id, label=d.label, paired_at=_timestamp(d.paired_at), last_seen=_timestamp(d.last_seen),
                         expires_at=_timestamp(d.expires_at))
            for d in devices
        ]


@router.delete("/devices/{device_id}", status_code=204)
def forget_device(device_id: str, runtime: RuntimeDep, request: Request) -> Response:
    _require_owner(request, "Forget devices on this computer.")
    with write_session(runtime.engine) as session:
        device = session.exec(select(LanDevice).where(LanDevice.id == device_id)).first()
        if device is None:
            raise HTTPException(404, "Device not found")
        session.delete(device)
    return Response(status_code=204)


@router.delete("/devices", status_code=204)
def forget_all_devices(runtime: RuntimeDep, request: Request) -> Response:
    _require_owner(request, "Forget devices on this computer.")
    with write_session(runtime.engine) as session:
        session.exec(delete(LanDevice))
        settings = row(session)
        # A new signing key also invalidates any cookie whose row might come back from a backup.
        settings.lan_signing_key = secrets.token_hex(32)
        session.add(settings)
    return Response(status_code=204)


if __name__ == "__main__":
    print("0.0.0.0" if enabled(Config.from_env()) else "127.0.0.1")
