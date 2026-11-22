from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture


def test_settings_persist_and_drive_provider_and_default_selection(setup_machine, monkeypatch):  # noqa: F811
    setup_machine.installed.update({"claude", "codex", "copilot", "kimi-custom"})
    setup_machine.logged_in.update(claude=True, codex=True)
    monkeypatch.setenv("VV_DEFAULT_BRAIN", "codex")
    monkeypatch.setenv("VV_DEFAULT_ENGINE", "codex")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    cfg = setup_machine.home / "work-claude"
    cfg.mkdir()
    providers = {"claude": {"config_dir": str(cfg)}, "copilot": {"model": "chosen"}, "kimi": {"bin": "kimi-custom"}}
    with desktop() as api:
        assert api.get("/api/system/backends").json()["defaults"] == {"brain": "codex", "engine": "codex"}
        saved = api.patch("/api/settings", json={
            "default_brain": "claude", "default_engine": "copilot", "providers": providers,
            "allow_web_research": False, "setup_completed_at": "2026-11-21T22:00:00Z",
        })
        assert saved.status_code == 200, saved.text

    with desktop() as api:
        assert api.get("/api/settings").json() == saved.json()
        assert api.get("/api/system/backends").json()["defaults"] == {"brain": "claude", "engine": "copilot"}
        assert api.get("/api/system/setup").json()["complete"] is True
        assert api.post("/api/venues/research", json={"query": "A venue"}).status_code == 403
        for backend in ("claude", "copilot", "kimi"):
            assert api.post(f"/api/system/backends/brain/{backend}/test", json={}).json()["ok"] is True
        claude, copilot, kimi = setup_machine.calls
        assert claude[1]["CLAUDE_CONFIG_DIR"] == str(cfg)
        assert "ANTHROPIC_API_KEY" not in claude[1]
        assert "--model=chosen" in copilot[0]
        assert kimi[0][0] == "/fake/bin/kimi-custom"
        assert any(args == ["auth", "status"] and env.get("CLAUDE_CONFIG_DIR") == str(cfg)
                   for _, args, env in setup_machine.probes)


def test_claude_config_directory_must_exist_under_home(setup_machine, tmp_path):  # noqa: F811
    link = setup_machine.home / "outside"
    link.symlink_to(tmp_path)
    file = setup_machine.home / "file"
    file.touch()
    with desktop() as api:
        for invalid in (link, file, setup_machine.home / "missing"):
            response = api.patch("/api/settings", json={"providers": {"claude": {"config_dir": str(invalid)}}})
            assert response.status_code == 422, response.text
