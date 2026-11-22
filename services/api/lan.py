"""Private-network discovery, device pairing and local proxy identity."""

import hmac
import io
import logging
import secrets
import time
from collections import deque
from hashlib import sha256
from ipaddress import IPv4Address, IPv6Address, ip_address, ip_network
from math import ceil
from threading import Lock

import segno
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlmodel import Session

from .config import Settings as Config
from .contracts import Input
from .db import write_session
from .deps import RuntimeDep
from .models import LanDevice, Settings
from .settings import existing_settings, load, preferences

router = APIRouter(prefix="/api/system/lan", tags=["system"])
log = logging.getLogger("uvicorn.error")
COOKIE = "vv_lan_device"
DEVICE_SECONDS = 30 * 24 * 60 * 60
ATTEMPT_SECONDS = 10 * 60
MAX_FAILURES = 5
_PRIVATE = tuple(map(ip_network, ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")))


class LanOut(BaseModel):
    enabled: bool
    url: str | None
    qr_svg: str | None
    pairing_code: str | None
    pairing_required: bool = True


class PairIn(Input):
    code: str = Field(max_length=64)


def enabled(config: Config, saved: Settings | None) -> bool:
    return config.lan or (saved is not None and preferences(saved).lan.enabled)


def addresses() -> tuple[str, ...]:
    import ifaddr

    return tuple(dict.fromkeys(
        str(ip.ip) for adapter in ifaddr.get_adapters() for ip in adapter.ips
        if ip.is_IPv4 and any(IPv4Address(ip.ip) in net for net in _PRIVATE)
    ))


def normalize_ip(value: str) -> IPv4Address | IPv6Address | None:
    try:
        ip = ip_address(value)
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


def valid_device(session: Session, settings: Settings, cookie: str) -> bool:
    token, _, signature = cookie.partition(".")
    if len(token) != 43 or not token.isascii() or not _valid_signature(settings.lan_signing_key, token, signature):
        return False
    device = session.get(LanDevice, sha256(token.encode()).hexdigest())
    return device is not None and device.expires_at > time.time()


class Pairing:
    def __init__(self) -> None:
        self.code = f"{secrets.randbelow(1_000_000):06d}"
        self._failures: dict[str, deque[float]] = {}
        self._lock = Lock()
        self._announced = False

    def announce(self) -> None:
        with self._lock:
            if not self._announced:
                log.info("Venue Visualizer LAN pairing code: %s", self.code)
                self._announced = True

    def check(self, ip: str, code: str) -> None:
        with self._lock:
            now = time.monotonic()
            for key, failures in list(self._failures.items()):
                while failures and now - failures[0] >= ATTEMPT_SECONDS:
                    failures.popleft()
                if not failures:
                    del self._failures[key]
            failures = self._failures.get(ip)
            if failures and len(failures) >= MAX_FAILURES:
                retry = ceil(ATTEMPT_SECONDS - (now - failures[0]))
                raise HTTPException(429, "Too many attempts. Try again later.", headers={"Retry-After": str(retry)})
            if not code.isascii() or not hmac.compare_digest(self.code, code):
                self._failures.setdefault(ip, deque()).append(now)
                raise HTTPException(403, "Incorrect pairing code.")


@router.get("")
def lan_info(runtime: RuntimeDep, request: Request, response: Response) -> LanOut:
    if request.state.lan_remote:
        raise HTTPException(403, "LAN pairing information is only available from localhost.")
    response.headers["Cache-Control"] = "no-store"
    active = enabled(runtime.settings, load(runtime.engine))
    if not active:
        return LanOut(enabled=False, url=None, qr_svg=None, pairing_code=None)
    pairing: Pairing = request.app.state.pairing
    pairing.announce()
    hosts = addresses()
    url = f"http://{hosts[0]}:3000" if hosts else None
    svg = None
    if url:
        output = io.BytesIO()
        segno.make_qr(url).save(output, kind="svg", scale=4, xmldecl=False, dark="#000", light="#fff")
        svg = output.getvalue().decode("utf-8")
    return LanOut(enabled=True, url=url, qr_svg=svg, pairing_code=pairing.code)


@router.post("/pair")
def pair(body: PairIn, runtime: RuntimeDep, request: Request, response: Response) -> dict[str, bool]:
    settings = load(runtime.engine)
    if not enabled(runtime.settings, settings):
        raise HTTPException(403, "LAN mode is disabled.")
    if not request.state.lan_remote or request.state.client_ip is None:
        raise HTTPException(403, "Pair from the phone using the LAN URL.")
    pairing: Pairing = request.app.state.pairing
    pairing.check(str(request.state.client_ip), body.code)
    token = secrets.token_urlsafe(32)
    with write_session(runtime.engine) as session:
        now = int(time.time())
        session.exec(delete(LanDevice).where(LanDevice.expires_at <= now))
        session.add(LanDevice(token_hash=sha256(token.encode()).hexdigest(), expires_at=now + DEVICE_SECONDS))
    response.set_cookie(COOKIE, f"{token}.{_signature(settings.lan_signing_key, token)}", max_age=DEVICE_SECONDS,
                        httponly=True, samesite="strict", secure=request.url.scheme == "https")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


if __name__ == "__main__":
    config = Config.from_env()
    print("0.0.0.0" if enabled(config, existing_settings(config)) else "127.0.0.1")
