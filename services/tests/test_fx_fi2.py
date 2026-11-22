"""FI2: `make doctor` always exits 0 and prints a verdict; `make doctor-ci` (`--strict`) keeps the failing exit."""

import re
from importlib import import_module
from pathlib import Path

from .conftest_setup import setup_machine  # noqa: F401 - pytest fixture

ROOT = Path(__file__).resolve().parents[2]


def _target(name: str) -> str:
    match = re.search(rf"^{re.escape(name)}:.*\n((?:\t.*\n?)+)", (ROOT / "Makefile").read_text(), re.MULTILINE)
    assert match, f"Makefile has no {name} target"
    return match.group(1)


def test_doctor_exits_zero_with_a_verdict_when_not_ready(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    assert doctor.main([]) == 0
    output = capsys.readouterr().out
    assert "Not ready yet" in output
    assert "Do this next:" in output


def test_strict_doctor_keeps_the_failing_exit(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    assert doctor.main(["--strict"]) == 1
    assert "Not ready yet" in capsys.readouterr().out


def test_strict_doctor_passes_when_ready(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    setup_machine.installed.add("codex")
    setup_machine.logged_in["codex"] = True
    assert doctor.main(["--strict"]) == 0
    assert "Ready" in capsys.readouterr().out


def test_make_targets():
    assert "--strict" not in _target("doctor")
    assert "api.doctor --strict" in _target("doctor-ci")
    assert re.search(r"^\.PHONY:.*\bdoctor-ci\b", (ROOT / "Makefile").read_text(), re.MULTILINE)
