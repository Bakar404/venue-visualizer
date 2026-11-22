import hmac
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient

from api.main import create_app

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture

HOST = "192.168.10.2"
ORIGIN = f"http://{HOST}:3000"
PROXY_KEY = "test-only-proxy-key"


def phone(app, ip="192.168.10.3", *, proxy=False):
    signature = hmac.digest(PROXY_KEY.encode(), ip.encode(), "sha256").hex()
    return TestClient(
        app, base_url=ORIGIN, client=("127.0.0.1" if proxy else ip, 54123),
        headers=(
            {"Host": "localhost:8000", "X-Forwarded-Host": f"{HOST}:3000", "X-VV-Client": f"{ip}.{signature}"}
            if proxy else {}
        ),
    )


def test_lan_off_then_pair_with_cookie_and_preserve_localhost(setup_machine, monkeypatch):  # noqa: F811
    monkeypatch.setenv("VV_LAN_PROXY_KEY", PROXY_KEY)
    monkeypatch.setitem(sys.modules, "ifaddr", SimpleNamespace(get_adapters=lambda: [
        SimpleNamespace(ips=[SimpleNamespace(ip=HOST, is_IPv4=True)]),
    ]))
    monkeypatch.delenv("VV_LAN", raising=False)
    with desktop() as api:
        state = api.get("/api/system/lan")
        assert state.status_code == 200, state.text
        assert state.json()["enabled"] is False
        assert phone(api.app).get("/api/health").status_code == 400
        assert api.patch("/api/settings", json={"lan": {"enabled": True}}).status_code == 422
    monkeypatch.setenv("VV_LAN", "1")
    with desktop() as api:
        lan = phone(api.app)
        state = api.get("/api/system/lan").json()
        assert state["url"] == f"{ORIGIN}/pair" and "<svg" in state["qr_svg"]
        code = state["pairing_code"]
        assert len(code) == 6 and code.isdecimal()
        assert lan.get("/api/health").status_code == 200
        assert lan.get("/api/venues").status_code == 403
        assert lan.get("/api/system/lan").status_code == 403
        assert api.get("/api/venues").status_code == 200

        proxy = phone(api.app, proxy=True)
        assert proxy.get("/api/venues").status_code == 403
        assert proxy.get("/api/system/lan", headers={
            "X-Forwarded-Host": "localhost:3000", "X-VV-Client": "127.0.0.1.invalid",
        }).status_code == 403
        assert proxy.post(
            "/api/system/lan/pair", json={"code": code}, headers={"Origin": "https://untrusted.example"}
        ).status_code == 403
        paired = proxy.post("/api/system/lan/pair", json={"code": code}, headers={"Origin": ORIGIN})
        assert paired.status_code == 200, paired.text
        cookie = paired.headers["set-cookie"].lower()
        assert all(flag in cookie for flag in ("httponly", "samesite=strict", "max-age=2592000"))
        assert proxy.get("/api/venues").status_code == 200
        assert proxy.get("/api/system/lan").status_code == 403
        assert phone(api.app, proxy=True).get("/api/venues", headers={
            "Cookie": paired.headers["set-cookie"].split(";")[0] + "x",
        }).status_code == 403

        code = api.get("/api/system/lan").json()["pairing_code"]
        wrong = "000000" if code != "000000" else "111111"
        attacker = phone(api.app, ip="192.168.10.4")
        for invalid in (wrong, wrong, "incorrect", wrong, wrong):
            assert attacker.post("/api/system/lan/pair", json={"code": invalid}).status_code == 403
        blocked = attacker.post("/api/system/lan/pair", json={"code": code})
        assert blocked.status_code == 429 and int(blocked.headers["Retry-After"]) <= 600
        cookie_header = proxy.cookies
    with desktop(create_app()) as restarted:
        new_state = restarted.get("/api/system/lan").json()
        assert new_state["enabled"]
        existing = phone(restarted.app)
        existing.cookies.update(cookie_header)
        assert existing.get("/api/venues").status_code == 200
