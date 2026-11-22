"""Shared LAN doubles for the security regression tests (SEC1-SEC7)."""

import hmac
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient

HOST = "192.168.10.2"
ORIGIN = f"http://{HOST}:3000"
PROXY_KEY = "test-only-proxy-key"
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1"


def adapters(monkeypatch, *ips: tuple[str, str]) -> None:
    monkeypatch.setitem(sys.modules, "ifaddr", SimpleNamespace(get_adapters=lambda: [
        SimpleNamespace(name=name, nice_name=name, ips=[SimpleNamespace(ip=ip, is_IPv4=True)]) for name, ip in ips
    ]))


def lan_env(monkeypatch, *, lan: bool = True, key: bool = True) -> None:
    adapters(monkeypatch, ("en0", HOST))
    if lan:
        monkeypatch.setenv("VV_LAN", "1")
    else:
        monkeypatch.delenv("VV_LAN", raising=False)
    if key:
        monkeypatch.setenv("VV_LAN_PROXY_KEY", PROXY_KEY)
    else:
        monkeypatch.delenv("VV_LAN_PROXY_KEY", raising=False)


def attest(ip: str, key: str = PROXY_KEY) -> str:
    return f"{ip}.{hmac.digest(key.encode(), ip.encode(), 'sha256').hex()}"


def phone(app, ip: str = "192.168.10.3", **headers: str) -> TestClient:
    """A device on the Wi-Fi talking straight to the API's LAN socket."""
    return TestClient(app, base_url=ORIGIN.replace("3000", "8000"), client=(ip, 54123), headers=headers)


def proxied(app, forwarded_host: str, client_ip: str | None = None, **headers: str) -> TestClient:
    """A request that Next.js rewrote to the API: it arrives on a loopback socket."""
    extra = {"Host": "localhost:8000", "X-Forwarded-Host": forwarded_host, **headers}
    if client_ip is not None:
        extra["X-VV-Client"] = attest(client_ip)
    return TestClient(app, base_url="http://localhost:8000", client=("127.0.0.1", 54124), headers=extra)


def pair_phone(desktop_client: TestClient, ip: str = "192.168.10.3", user_agent: str = IPHONE) -> TestClient:
    code = desktop_client.get("/api/system/lan").json()["pairing_code"]
    device = phone(desktop_client.app, ip, **{"User-Agent": user_agent})
    paired = device.post("/api/system/lan/pair", json={"code": code})
    assert paired.status_code == 200, paired.text
    return device
