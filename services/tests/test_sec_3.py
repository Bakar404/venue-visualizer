"""SEC3: the pairing code is one-time, short-lived, globally rate-limited and never logged."""

import logging
import re
import time
from types import SimpleNamespace

from api import lan

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import lan_env, phone


class Clock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def install(self, monkeypatch) -> "Clock":
        monkeypatch.setattr(lan, "time", SimpleNamespace(monotonic=lambda: self.now, time=time.time))
        return self


def _code(api) -> str:
    state = api.get("/api/system/lan")
    assert state.status_code == 200, state.text
    return state.json()["pairing_code"]


def _pair(api, ip: str, code: str):
    return phone(api.app, ip).post("/api/system/lan/pair", json={"code": code})


def test_code_is_one_time_and_rotates_after_pairing(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        code = _code(api)
        assert _pair(api, "192.168.10.3", code).status_code == 200
        assert _pair(api, "192.168.10.4", code).status_code == 403
        fresh = _code(api)
        assert fresh and fresh != code
        assert _pair(api, "192.168.10.4", fresh).status_code == 200


def test_code_expires_ten_minutes_after_issue_even_when_polled(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    clock = Clock().install(monkeypatch)
    with desktop() as api:
        code = _code(api)
        clock.now += 601
        assert _pair(api, "192.168.10.3", code).status_code == 403
        assert api.get("/api/system/lan").json()["pairing_expires_in"] == 600

        code = _code(api)
        clock.now += 500
        polled = api.get("/api/system/lan").json()
        assert polled["pairing_code"] == code
        assert polled["pairing_expires_in"] == 100
        clock.now += 101
        assert _pair(api, "192.168.10.3", code).status_code == 403


def test_global_failure_limit_invalidates_code_and_locks_pairing(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    clock = Clock().install(monkeypatch)
    with desktop() as api:
        code = _code(api)
        wrong = "000000" if code != "000000" else "111111"
        for n in range(10):
            assert _pair(api, f"192.168.10.{20 + n // 2}", wrong).status_code == 403
        blocked = _pair(api, "192.168.10.99", code)
        assert blocked.status_code == 429, blocked.text
        assert 0 < int(blocked.headers["Retry-After"]) <= 300
        state = api.get("/api/system/lan").json()
        assert state["pairing_code"] is None and 0 < state["pairing_locked_for"] <= 300

        clock.now += 301
        assert _pair(api, "192.168.10.99", code).status_code == 403  # The old code was invalidated.
        fresh = _code(api)
        assert fresh and fresh != code
        assert _pair(api, "192.168.10.98", fresh).status_code == 200


def test_per_ip_limit_still_applies(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        code = _code(api)
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            assert _pair(api, "192.168.10.4", wrong).status_code == 403
        assert _pair(api, "192.168.10.4", code).status_code == 429
        assert _pair(api, "192.168.10.5", code).status_code == 200


def test_pairing_code_is_never_logged(setup_machine, monkeypatch, caplog):  # noqa: F811
    lan_env(monkeypatch)
    caplog.set_level(logging.INFO)
    with desktop() as api:
        code = _code(api)
    assert "Open Setup → Open on your phone on this computer to see the pairing code" in caplog.text
    assert code not in caplog.text
    assert not re.search(r"pairing code: \d{6}", caplog.text)
