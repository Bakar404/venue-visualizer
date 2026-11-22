from importlib import import_module

import pytest

from .conftest_setup import (
    desktop,
    record_test,
    setup_machine,  # noqa: F401 - pytest fixture
)


def test_doctor_lists_prerequisites_and_provider_instructions(setup_machine, monkeypatch, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    monkeypatch.setattr(doctor.platform, "system", lambda: "Darwin")
    assert doctor.main([]) == 0
    output = capsys.readouterr().out
    for label in ("Node", "pnpm", "Python", "uv", "ffmpeg", "Playwright Chromium"):
        assert label in output
    for command in (
        "npm install -g @anthropic-ai/claude-code", "claude", "sign-in prompt",
        "npm install -g @openai/codex", "codex login", "codex features enable image_generation",
        "npm install -g @github/copilot", "/login",
        "https://www.kimi.com/code/docs/en/", "uv tool install mflux",
    ):
        assert command in output
    assert "Do this next:" in output
    assert "✗" in output


def test_doctor_is_ready_with_a_signed_in_brain_and_engine(setup_machine, capsys):  # noqa: F811
    import json

    doctor = import_module("api.doctor")
    setup_machine.installed.update({"codex", "copilot"})
    setup_machine.logged_in["codex"] = True
    assert doctor.main(["--json"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["ready"] is True
    assert next(p for p in report["providers"] if p["id"] == "codex")["logged_in"] is True
    assert next(p for p in report["providers"] if p["id"] == "copilot")["logged_in"] is None


def test_doctor_strict_does_not_count_mock_backends(setup_machine, monkeypatch, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    monkeypatch.setenv("VV_MOCK", "1")
    status = doctor.main(["--strict"])
    verdict = capsys.readouterr().out.split("\n\n")[-1]
    assert verdict.splitlines()[0] == "Not ready yet: no ready brain (chat) and no ready image engine."
    assert "mock" not in verdict.lower()
    assert status == 1
    with desktop() as api:
        setup = api.get("/api/system/setup").json()
    assert setup["brain"]["ready"] == ["mock"]
    assert setup["engine"]["ready"] == ["mock"]


@pytest.mark.parametrize(("flag", "value", "enabled"), [
    ("VV_DEV", " YES ", True),
    ("VV_MOCK", " TrUe ", True),
    ("VV_MOCK", "off", False),
])
def test_setup_and_backend_lists_agree_on_mock_flags(setup_machine, monkeypatch, flag, value, enabled):  # noqa: F811
    monkeypatch.setenv(flag, value)
    with desktop() as api:
        backends = api.get("/api/system/backends").json()
        setup = api.get("/api/system/setup").json()
    for role in ("brain", "engine"):
        assert any(backend["id"] == "mock" for backend in backends[f"{role}s"]) is enabled
        assert setup[role]["ready"] == (["mock"] if enabled else [])
        assert setup[role]["missing"] is not enabled


@pytest.mark.parametrize(("image_test", "expected"), [
    (None, ["  ✓ Codex: ready (signed in)", "      Enable images: codex features enable image_generation"]),
    (False, ["  ✓ Codex: ready (signed in)", "      Enable images: codex features enable image_generation"]),
    (True, ["  ✓ Codex: ready (signed in)"]),
])
def test_doctor_codex_image_setup_snapshot(setup_machine, capsys, image_test, expected):  # noqa: F811
    doctor = import_module("api.doctor")
    setup_machine.installed.add("codex")
    setup_machine.logged_in["codex"] = True
    record_test("brain", "codex", ok=True)
    if image_test is not None:
        record_test("engine", "codex", ok=image_test)
    assert doctor.main([]) == 0
    lines = capsys.readouterr().out.splitlines()
    start = next(i for i, line in enumerate(lines) if "Codex:" in line)
    end = next(i for i, line in enumerate(lines) if "GitHub Copilot:" in line)
    assert lines[start:end] == expected


def test_doctor_names_the_apple_silicon_requirement_on_linux(setup_machine, monkeypatch, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    monkeypatch.setattr(doctor.platform, "system", lambda: "Linux")
    assert doctor.main([]) == 0
    assert "Install: Not supported (Apple Silicon only)" in capsys.readouterr().out
