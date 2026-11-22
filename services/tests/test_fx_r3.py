"""R3: the owner rotates the pairing code with POST /api/system/lan/code; GET never rotates."""

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import lan_env, pair_phone, phone
from .test_sec_3 import Clock, _pair

JSON = {"Content-Type": "application/json"}


def test_post_code_rotates_and_get_keeps_the_code(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    Clock().install(monkeypatch)
    with desktop() as api:
        first = api.get("/api/system/lan").json()
        assert api.get("/api/system/lan").json()["pairing_code"] == first["pairing_code"]
        rotated = api.post("/api/system/lan/code", headers=JSON)
        assert rotated.status_code == 200, rotated.text
        body = rotated.json()
        assert body["pairing_code"] and body["pairing_code"] != first["pairing_code"]
        assert body["pairing_expires_in"] == 600 and body["pairing_locked_for"] is None
        assert rotated.headers["Cache-Control"] == "no-store"
        assert _pair(api, "192.168.10.3", first["pairing_code"]).status_code == 403
        assert _pair(api, "192.168.10.4", body["pairing_code"]).status_code == 200


def test_post_code_is_owner_only(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        device = pair_phone(api)
        assert device.post("/api/system/lan/code", headers=JSON).status_code == 403
        assert phone(api.app, "192.168.10.9").post("/api/system/lan/code", headers=JSON).status_code == 403


def test_post_code_reports_the_lockout(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    clock = Clock().install(monkeypatch)
    with desktop() as api:
        code = api.get("/api/system/lan").json()["pairing_code"]
        wrong = "000000" if code != "000000" else "111111"
        for n in range(10):
            _pair(api, f"192.168.10.{20 + n // 2}", wrong)
        locked = api.post("/api/system/lan/code", headers=JSON).json()
        assert locked["pairing_code"] is None and 0 < locked["pairing_locked_for"] <= 300
        clock.now += 301
        assert api.post("/api/system/lan/code", headers=JSON).json()["pairing_code"]


def test_post_code_when_lan_is_off(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch, lan=False)
    with desktop() as api:
        response = api.post("/api/system/lan/code", headers=JSON)
        assert response.status_code == 200, response.text
        assert response.json()["enabled"] is False and response.json()["pairing_code"] is None
