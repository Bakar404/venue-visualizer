from types import SimpleNamespace

from pipeline import providers
from pipeline.engines import registry

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture


def test_login_status_stays_cached_until_refresh_and_unknown_is_null(setup_machine, monkeypatch):  # noqa: F811
    setup_machine.installed.update({"claude", "codex", "copilot", "kimi"})
    setup_machine.logged_in.update(claude=True, codex=False)
    now = 100.0
    clock = SimpleNamespace(monotonic=lambda: now)
    monkeypatch.setattr(registry, "time", clock)
    monkeypatch.setattr(providers, "time", clock)

    def logins(response):
        assert response.status_code == 200, response.text
        return {item["id"]: item["logged_in"] for item in response.json()["brains"]}

    with desktop() as api:
        path = "/api/system/backends"
        initial = {"claude": True, "codex": False, "copilot": None, "kimi": None}
        assert logins(api.get(path)) == initial
        setup_machine.logged_in.update(claude=False, codex=True)
        assert logins(api.get(path)) == initial
        assert logins(api.post(f"{path}/refresh", headers={"Content-Type": "application/json"})) == (
            {"claude": False, "codex": True, "copilot": None, "kimi": None}
        )
        setup_machine.logged_in.update(claude=True, codex=False)
        now += 60
        assert logins(api.get(path)) == initial
