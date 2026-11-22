"""R8: sign-in guidance separates the copyable command from the plain-text note."""

from importlib import import_module

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture


def test_backends_split_login_into_command_and_note(setup_machine):  # noqa: F811
    setup_machine.installed.update({"claude", "codex", "copilot"})
    with desktop() as api:
        report = api.get("/api/system/backends").json()
    logins = {(item["kind"], item["id"]): item["login"] for item in report["brains"] + report["engines"]}
    assert logins[("brain", "claude")] == {"command": "claude", "note": "then follow the sign-in prompt"}
    assert logins[("brain", "copilot")] == {"command": "copilot", "note": "then type /login"}
    assert logins[("engine", "copilot")] == {"command": "copilot", "note": "then type /login"}
    assert logins[("brain", "kimi")] == {"command": "kimi", "note": "then type /login"}
    assert logins[("brain", "codex")] == {"command": "codex login", "note": None}
    assert logins[("engine", "mflux")] is None
    engine_codex = next(item for item in report["engines"] if item["id"] == "codex")
    assert engine_codex["login"] == {"command": "codex login", "note": None}
    assert engine_codex["image_setup"] == "codex features enable image_generation"


def test_doctor_prints_command_then_note(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    doctor.main([])
    lines = capsys.readouterr().out.splitlines()
    assert "      Sign in: claude  (then follow the sign-in prompt)" in lines
    assert "      Sign in: copilot  (then type /login)" in lines
    assert "      Sign in: codex login" in lines
