from __future__ import annotations

import shutil

import pytest

from pipeline.engines import registry


def _nothing_installed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(shutil, "which", lambda *a, **k: None)
    monkeypatch.delenv("VV_DEFAULT_BRAIN", raising=False)
    monkeypatch.delenv("VV_DEFAULT_ENGINE", raising=False)
    monkeypatch.delenv("VV_DEV", raising=False)
    monkeypatch.delenv("VV_MOCK", raising=False)
    registry.refresh()


def test_auto_falls_back_to_mock(monkeypatch: pytest.MonkeyPatch):
    _nothing_installed(monkeypatch)
    assert registry.pick_brain(None).id == "mock"
    assert registry.pick_brain("auto").id == "mock"
    with pytest.raises(registry.BackendUnavailable):
        registry.pick_engine(None)
    monkeypatch.setenv("VV_DEV", "1")
    assert registry.pick_engine(None).id == "mock"


def test_auto_prefers_first_available(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(shutil, "which", lambda name, *a, **k: "/bin/true" if name == "copilot" else None)
    monkeypatch.delenv("VV_DEFAULT_BRAIN", raising=False)
    monkeypatch.delenv("VV_DEFAULT_ENGINE", raising=False)
    monkeypatch.delenv("VV_DEV", raising=False)
    monkeypatch.delenv("VV_MOCK", raising=False)
    registry.refresh()
    assert registry.pick_brain().id == "copilot"
    assert registry.pick_engine().id == "copilot"


def test_explicit_choices(monkeypatch: pytest.MonkeyPatch):
    _nothing_installed(monkeypatch)
    assert registry.pick_engine("mock").id == "mock"
    with pytest.raises(registry.BackendUnavailable):
        registry.pick_brain("claude")
    with pytest.raises(ValueError):
        registry.pick_engine("dalle")
    monkeypatch.setenv("VV_DEFAULT_BRAIN", "mock")
    assert registry.pick_brain(None).id == "mock"


def test_backend_report_shape(monkeypatch: pytest.MonkeyPatch):
    _nothing_installed(monkeypatch)
    report = registry.backend_report()
    assert [b["id"] for b in report["brains"]] == ["claude", "codex", "copilot", "kimi"]
    assert [e["id"] for e in report["engines"]] == ["copilot", "codex", "mflux"]
    assert report["defaults"] == {"brain": None, "engine": None}  # hidden mock is never a reported default
    for entry in report["brains"] + report["engines"]:
        assert set(entry) >= {"id", "label", "kind", "available", "logged_in", "version", "detail"}
        assert entry["available"] is False
    for entry in report["engines"]:
        assert set(entry["caps"]) == {"can_generate", "can_edit", "typical_seconds", "cost_note", "photoreal"}
    assert set(report["internal"]) == {"layout_guide"}
    assert "available" in report["internal"]["layout_guide"]


def test_internal_backends_hidden_unless_dev(monkeypatch: pytest.MonkeyPatch):
    _nothing_installed(monkeypatch)
    assert "scene3d" not in registry.engines() and "mock" not in registry.engines()
    assert "mock" not in registry.brains()
    assert "mock" in registry.engines(include_internal=True)
    assert registry.pick_brain("mock").id == "mock"  # still usable as the offline fallback
    for var in ("VV_DEV", "VV_MOCK"):
        monkeypatch.setenv(var, "1")
        registry.refresh()
        assert "mock" in registry.engines() and "mock" in registry.brains()
        assert "scene3d" not in registry.engines()
        assert "scene3d" not in [e["id"] for e in registry.backend_report()["engines"]]
        monkeypatch.delenv(var)
    registry.refresh()
    assert "mock" not in registry.engines()


def test_auto_engine_order_skips_internal(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(shutil, "which", lambda name, *a, **k: "/bin/true" if name == "codex" else None)
    monkeypatch.delenv("VV_DEFAULT_ENGINE", raising=False)
    monkeypatch.setenv("VV_DEV", "1")
    registry.refresh()
    assert registry.pick_engine("auto").id == "codex"


def test_scene3d_only_registered_when_importable(monkeypatch: pytest.MonkeyPatch):
    import importlib

    real = importlib.import_module

    def fake_import(name, *a, **k):
        if name == "pipeline.engines.scene3d":
            raise ImportError("not here")
        return real(name, *a, **k)

    monkeypatch.setattr(registry.importlib, "import_module", fake_import)
    registry.refresh()
    assert "scene3d" not in registry.engines(include_internal=True)


def test_default_engine_env_ignores_hidden_engines(monkeypatch: pytest.MonkeyPatch, caplog):
    monkeypatch.setattr(shutil, "which", lambda name, *a, **k: "/bin/true" if name == "codex" else None)
    for var in ("VV_DEV", "VV_MOCK", "VV_DEFAULT_BRAIN"):
        monkeypatch.delenv(var, raising=False)
    registry.refresh()
    for hidden in ("scene3d", "mock"):
        monkeypatch.setenv("VV_DEFAULT_ENGINE", hidden)
        assert registry.pick_engine(None).id == "codex"
        assert registry.backend_report()["defaults"]["engine"] == "codex"
    assert "internal engine" in caplog.text
    monkeypatch.setenv("VV_DEV", "1")
    registry.refresh()
    monkeypatch.setenv("VV_DEFAULT_ENGINE", "mock")
    assert registry.pick_engine(None).id == "mock"  # allowed in dev mode
    monkeypatch.setenv("VV_DEFAULT_ENGINE", "scene3d")
    assert registry.pick_engine(None).id == "codex"  # never, even in dev mode


def test_report_defaults_only_name_listed_backends(monkeypatch: pytest.MonkeyPatch):
    _nothing_installed(monkeypatch)
    monkeypatch.setenv("VV_DEFAULT_BRAIN", "mock")
    assert registry.backend_report()["defaults"]["brain"] is None
    monkeypatch.setenv("VV_DEV", "1")
    registry.refresh()
    report = registry.backend_report()
    assert report["defaults"] == {"brain": "mock", "engine": "mock"}
    assert report["defaults"]["brain"] in [b["id"] for b in report["brains"]]
