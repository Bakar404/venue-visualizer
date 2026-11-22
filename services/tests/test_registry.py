from __future__ import annotations

import shutil

import pytest

from pipeline.engines import registry


def _nothing_installed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(shutil, "which", lambda *a, **k: None)
    monkeypatch.delenv("VV_DEFAULT_BRAIN", raising=False)
    monkeypatch.delenv("VV_DEFAULT_ENGINE", raising=False)
    registry.refresh()


def test_auto_falls_back_to_mock(monkeypatch: pytest.MonkeyPatch):
    _nothing_installed(monkeypatch)
    assert registry.pick_brain(None).id == "mock"
    assert registry.pick_brain("auto").id == "mock"
    assert registry.pick_engine(None).id == "mock"


def test_auto_prefers_first_available(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(shutil, "which", lambda name, *a, **k: "/bin/true" if name == "copilot" else None)
    monkeypatch.delenv("VV_DEFAULT_BRAIN", raising=False)
    monkeypatch.delenv("VV_DEFAULT_ENGINE", raising=False)
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
    assert [b["id"] for b in report["brains"]] == ["claude", "codex", "copilot", "kimi", "mock"]
    engine_ids = [e["id"] for e in report["engines"]]
    assert engine_ids[:3] == ["copilot", "codex", "mflux"] and engine_ids[-1] == "mock"
    assert report["defaults"] == {"brain": "mock", "engine": "mock"}
    for entry in report["brains"] + report["engines"]:
        assert set(entry) >= {"id", "label", "kind", "available", "logged_in", "version", "detail"}
    for entry in report["engines"]:
        assert set(entry["caps"]) == {"can_generate", "can_edit", "typical_seconds", "cost_note", "photoreal"}
    assert [e["available"] for e in report["engines"] if e["id"] != "mock"] == [False] * (len(engine_ids) - 1) \
        or "scene3d" in engine_ids


def test_scene3d_only_registered_when_importable(monkeypatch: pytest.MonkeyPatch):
    import importlib

    real = importlib.import_module

    def fake_import(name, *a, **k):
        if name == "pipeline.engines.scene3d":
            raise ImportError("not here")
        return real(name, *a, **k)

    monkeypatch.setattr(registry.importlib, "import_module", fake_import)
    registry.refresh()
    assert "scene3d" not in registry.engines()
