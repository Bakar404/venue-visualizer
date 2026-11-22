"""FI3: one plain status line per tool, then indented commands."""

import json
from importlib import import_module

from .conftest_setup import record_test, setup_machine  # noqa: F401 - pytest fixture


def _lines(capsys) -> list[str]:
    return capsys.readouterr().out.splitlines()


def test_one_plain_line_per_tool_with_indented_commands(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    setup_machine.installed.update({"claude", "copilot"})
    setup_machine.logged_in["claude"] = True
    doctor.main([])
    lines = _lines(capsys)
    assert "  ✓ Claude Code: ready (signed in)" in lines
    assert "  ✗ Codex: not installed" in lines
    assert "  ? GitHub Copilot: installed, sign-in unknown, run Test in Setup" in lines
    assert not any(" | " in line for line in lines), "no pipe-separated status columns"
    codex = lines.index("  ✗ Codex: not installed")
    assert lines[codex + 1].startswith("      ") and "npm install -g @openai/codex" in lines[codex + 1]


def test_signed_out_and_tested_states(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    setup_machine.installed.update({"codex", "copilot"})
    setup_machine.logged_in["codex"] = False
    record_test("engine", "copilot", ok=True)
    doctor.main([])
    lines = _lines(capsys)
    assert "  ✗ Codex: installed, not signed in" in lines
    assert any(line.startswith("  ✓ GitHub Copilot: ready") and "test passed" in line for line in lines), lines
    doctor.main(["--json"])
    assert json.loads(capsys.readouterr().out)["ready"] is False
