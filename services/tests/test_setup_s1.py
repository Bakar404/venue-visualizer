from importlib import import_module

from .conftest_setup import setup_machine  # noqa: F401 - pytest fixture


def test_doctor_lists_prerequisites_and_provider_instructions(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    assert doctor.main([]) == 1
    output = capsys.readouterr().out
    for label in ("Node", "pnpm", "Python", "uv", "ffmpeg", "Playwright Chromium"):
        assert label in output
    for command in (
        "npm install -g @anthropic-ai/claude-code", "claude", "sign-in prompt",
        "npm install -g @openai/codex", "codex login", "codex features enable image_generation",
        "npm install -g @github/copilot", "/login",
        "https://www.kimi.com/code/docs/en/", "uv tool install mflux", "Apple Silicon",
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
