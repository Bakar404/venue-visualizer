"""SEC4: the owner can see and revoke paired devices; device cookies expire and only work in LAN mode."""

import time
from types import SimpleNamespace

from sqlmodel import Session

from api import lan
from api.db import database
from api.models import Settings

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import IPHONE, lan_env, pair_phone, phone

JSON = {"Content-Type": "application/json"}
ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"


def _signing_key(data_dir) -> str:
    engine = database(data_dir)
    try:
        with Session(engine) as session:
            return session.get(Settings, 1).lan_signing_key
    finally:
        engine.dispose()


def _shift_wall_clock(monkeypatch, seconds: float) -> None:
    monkeypatch.setattr(lan, "time", SimpleNamespace(time=lambda: time.time() + seconds, monotonic=time.monotonic))


def test_owner_lists_devices_and_last_seen_updates(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        device = pair_phone(api, user_agent=IPHONE)
        listed = api.get("/api/system/lan/devices")
        assert listed.status_code == 200, listed.text
        [entry] = listed.json()
        assert entry["label"] == "iPhone · Safari"
        assert entry["id"] and entry["paired_at"] and entry["last_seen"] == entry["paired_at"]
        assert device.get("/api/system/lan/devices").status_code == 403

        _shift_wall_clock(monkeypatch, 120)
        assert device.get("/api/venues").status_code == 200
        [entry] = api.get("/api/system/lan/devices").json()
        assert entry["last_seen"] > entry["paired_at"]


def test_owner_revokes_one_device(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        iphone = pair_phone(api, "192.168.10.3", IPHONE)
        android = pair_phone(api, "192.168.10.4", ANDROID)
        devices = {d["label"]: d["id"] for d in api.get("/api/system/lan/devices").json()}
        assert set(devices) == {"iPhone · Safari", "Android · Chrome"}
        assert iphone.delete(f"/api/system/lan/devices/{devices['Android · Chrome']}", headers=JSON).status_code == 403
        assert api.delete(f"/api/system/lan/devices/{devices['iPhone · Safari']}", headers=JSON).status_code == 204
        assert api.delete(f"/api/system/lan/devices/{devices['iPhone · Safari']}", headers=JSON).status_code == 404
        assert iphone.get("/api/venues").status_code == 403
        assert android.get("/api/venues").status_code == 200


def test_forget_all_devices_rotates_the_signing_key(setup_machine, tmp_path, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        iphone = pair_phone(api, "192.168.10.3", IPHONE)
        android = pair_phone(api, "192.168.10.4", ANDROID)
        before = _signing_key(tmp_path / "data")
        assert iphone.delete("/api/system/lan/devices", headers=JSON).status_code == 403
        assert api.delete("/api/system/lan/devices", headers=JSON).status_code == 204
        assert api.get("/api/system/lan/devices").json() == []
        assert iphone.get("/api/venues").status_code == 403
        assert android.get("/api/venues").status_code == 403
        assert _signing_key(tmp_path / "data") != before


def test_devices_survive_a_plain_start_but_cookies_need_lan_mode(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        device = pair_phone(api)
        cookies = device.cookies
    lan_env(monkeypatch, lan=False, key=False)
    with desktop() as api:
        assert len(api.get("/api/system/lan/devices").json()) == 1
        offline = phone(api.app)
        offline.cookies.update(cookies)
        assert offline.get("/api/venues").status_code in (400, 403)
    lan_env(monkeypatch)
    with desktop() as api:
        online = phone(api.app)
        online.cookies.update(cookies)
        assert online.get("/api/venues").status_code == 200


def test_device_cookies_expire_after_thirty_days(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        device = pair_phone(api)
        _shift_wall_clock(monkeypatch, 30 * 24 * 60 * 60 - 60)
        assert device.get("/api/venues").status_code == 200
        _shift_wall_clock(monkeypatch, 30 * 24 * 60 * 60 + 1)
        assert device.get("/api/venues").status_code == 403
