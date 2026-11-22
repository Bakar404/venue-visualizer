"""FI4: the next step names the full path to the Test button."""

from importlib import import_module

from .conftest_setup import setup_machine  # noqa: F401 - pytest fixture


def test_next_step_names_make_dev_the_setup_url_and_the_button(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    setup_machine.installed.update({"claude", "copilot"})
    setup_machine.logged_in["claude"] = True
    doctor.main([])
    assert (
        "Do this next: Start the app with `make dev`, open http://localhost:3000/setup and click Test images on "
        "GitHub Copilot" in capsys.readouterr().out
    )


def test_brain_next_step_names_test_chat(setup_machine, capsys):  # noqa: F811
    doctor = import_module("api.doctor")
    setup_machine.installed.update({"copilot", "codex"})
    setup_machine.logged_in["codex"] = False
    doctor.main([])
    out = capsys.readouterr().out
    assert "open http://localhost:3000/setup and click Test" in out
    assert "on GitHub Copilot" in out
