"""FI5: one readiness rule for Setup and the doctor; "likely" is never reported as ready."""

import json
from importlib import import_module

from .conftest_setup import desktop, record_test, setup_machine  # noqa: F401 - pytest fixture

DONE = {"setup_completed_at": "2026-11-22T10:00:00Z"}


def test_setup_reports_ready_and_likely_per_role(setup_machine):  # noqa: F811
    setup_machine.installed.update({"claude", "copilot"})
    setup_machine.logged_in["claude"] = True
    with desktop() as api:
        assert api.patch("/api/settings", json=DONE).status_code == 200
        setup = api.get("/api/system/setup").json()
    assert setup["brain"] == {"ready": ["claude"], "likely": ["copilot"], "missing": False}
    assert setup["engine"] == {"ready": [], "likely": ["copilot"], "missing": True}
    assert setup["complete"] is False
    assert setup["missing"] == ["engine"]
    assert setup["steps"] == {"tools": False, "defaults": True, "try_it": False}


def test_passed_test_makes_a_backend_ready_and_failed_test_is_neither(setup_machine):  # noqa: F811
    setup_machine.installed.update({"claude", "copilot", "codex"})
    setup_machine.logged_in["claude"] = True
    record_test("engine", "copilot", ok=True)
    record_test("brain", "copilot", ok=False)
    with desktop() as api:
        assert api.patch("/api/settings", json=DONE).status_code == 200
        setup = api.get("/api/system/setup").json()
    assert setup["engine"] == {"ready": ["copilot"], "likely": [], "missing": False}
    assert setup["brain"] == {"ready": ["claude"], "likely": [], "missing": False}
    assert setup["complete"] is True


def test_doctor_uses_the_same_rule(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    setup_machine.installed.update({"claude", "copilot"})
    setup_machine.logged_in["claude"] = True
    doctor.main(["--json"])
    report = json.loads(capsys.readouterr().out)
    assert report["ready"] is False
    assert report["roles"]["brain"] == {"ready": ["claude"], "likely": ["copilot"], "missing": False}
    assert report["roles"]["engine"] == {"ready": [], "likely": ["copilot"], "missing": True}
    record_test("engine", "copilot", ok=True)
    doctor.main(["--json"])
    report = json.loads(capsys.readouterr().out)
    assert report["ready"] is True
    assert report["roles"]["engine"]["ready"] == ["copilot"]
