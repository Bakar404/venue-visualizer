"""Backend registry: which brains/engines exist, which are available, and which one "auto" picks.

auto order - brains: claude, codex, copilot, kimi, mock; engines: copilot, codex, mflux, scene3d, mock.
scene3d is only registered if `pipeline.engines.scene3d` imports (it is owned by another module).
A preference of None falls back to VV_DEFAULT_BRAIN / VV_DEFAULT_ENGINE, then "auto".
"""
from __future__ import annotations

import importlib
import inspect
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from typing import Any

from ..brains.base import Brain, BrainStatus
from ..brains.claude import ClaudeBrain
from ..brains.codex import CodexBrain
from ..brains.copilot import CopilotBrain
from ..brains.kimi import KimiBrain
from ..brains.mock import MockBrain
from .base import EngineStatus, ImageEngine
from .codex import CodexEngine
from .copilot import CopilotEngine
from .mflux import MfluxEngine
from .mock import MockEngine

log = logging.getLogger(__name__)

BRAIN_ORDER = ("claude", "codex", "copilot", "kimi", "mock")
ENGINE_ORDER = ("copilot", "codex", "mflux", "scene3d", "mock")


class BackendUnavailable(RuntimeError):
    """An explicitly requested backend exists but is not available on this machine."""


_brains: dict[str, Brain] | None = None
_engines: dict[str, ImageEngine] | None = None
_status: dict[tuple[str, str], BrainStatus | EngineStatus] = {}


def _load_scene3d() -> ImageEngine | None:
    try:
        mod = importlib.import_module("pipeline.engines.scene3d")
    except ImportError:
        return None
    except Exception:  # noqa: BLE001 - a broken optional module must not break the registry
        return None
    for _, obj in inspect.getmembers(mod, inspect.isclass):
        if obj.__module__ == mod.__name__ and getattr(obj, "id", None) == "scene3d":
            try:
                return obj()
            except Exception:  # noqa: BLE001
                return None
    factory = getattr(mod, "engine", None) or getattr(mod, "ENGINE", None)
    if callable(factory):
        try:
            return factory()
        except Exception:  # noqa: BLE001
            return None
    return factory if isinstance(factory, ImageEngine) else None


def brains() -> dict[str, Brain]:
    global _brains
    if _brains is None:
        _brains = {b.id: b for b in (ClaudeBrain(), CodexBrain(), CopilotBrain(), KimiBrain(), MockBrain())}
    return _brains


def engines() -> dict[str, ImageEngine]:
    global _engines
    if _engines is None:
        items: list[ImageEngine] = [CopilotEngine(), CodexEngine(), MfluxEngine()]
        scene3d = _load_scene3d()
        if scene3d is not None:
            items.append(scene3d)
        items.append(MockEngine())
        _engines = {e.id: e for e in items}
    return _engines


def refresh() -> None:
    """Forget cached instances and detection results (e.g. after installing a CLI)."""
    global _brains, _engines
    from .._proc import clear_version_cache

    _brains = _engines = None
    _status.clear()
    clear_version_cache()


def _detect(kind: str, backend: Any) -> BrainStatus | EngineStatus:
    key = (kind, backend.id)
    if key not in _status:
        try:
            _status[key] = backend.detect()
        except Exception as e:  # noqa: BLE001 - defensive: detect() must never raise
            cls = BrainStatus if kind == "brain" else EngineStatus
            _status[key] = cls(available=False, detail=f"detect failed: {e}")
    return _status[key]


def _pick(kind: str, pref: str | None, registry: dict[str, Any], order: tuple[str, ...], env: str) -> Any:
    choice = (pref or os.environ.get(env) or "auto").strip().lower()
    if choice != "auto":
        if choice not in registry:
            raise ValueError(f"unknown {kind} {choice!r}; choose one of: auto, {', '.join(registry)}")
        status = _detect(kind, registry[choice])
        if not status.available:
            raise BackendUnavailable(f"{kind} {choice!r} is not available: {status.detail or 'not installed'}")
        return registry[choice]
    for bid in order:
        if bid in registry and _detect(kind, registry[bid]).available:
            return registry[bid]
    return registry["mock"]


def pick_brain(pref: str | None = None) -> Brain:
    return _pick("brain", pref, brains(), BRAIN_ORDER, "VV_DEFAULT_BRAIN")


def pick_engine(pref: str | None = None) -> ImageEngine:
    return _pick("engine", pref, engines(), ENGINE_ORDER, "VV_DEFAULT_ENGINE")


def _status_dict(kind: str, backend: Any, status: BrainStatus | EngineStatus) -> dict:
    out = {"id": backend.id, "label": backend.label, "kind": kind, "available": bool(status.available),
           "logged_in": status.logged_in, "version": status.version, "detail": status.detail}
    if kind == "engine":
        try:
            caps = asdict(backend.capabilities())
            out["caps"] = {k: caps[k] for k in ("can_generate", "can_edit", "typical_seconds", "cost_note",
                                                "photoreal")}
        except Exception as e:  # noqa: BLE001 - caps are optional in the API payload
            log.warning("capabilities() failed for %s: %s", backend.id, e)
    return out


def backend_report() -> dict:
    """Payload for GET /api/system/backends."""
    b, e = brains(), engines()
    jobs = [("brain", x) for x in b.values()] + [("engine", x) for x in e.values()]
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        statuses = list(pool.map(lambda j: _detect(*j), jobs))
    entries = [_status_dict(kind, x, s) for (kind, x), s in zip(jobs, statuses, strict=True)]

    def default(kind: str, fn) -> str:
        try:
            return fn(None).id
        except (ValueError, BackendUnavailable):
            return fn("auto").id

    return {
        "brains": [x for x in entries if x["kind"] == "brain"],
        "engines": [x for x in entries if x["kind"] == "engine"],
        "defaults": {"brain": default("brain", pick_brain), "engine": default("engine", pick_engine)},
    }
