"""Backend registry: which brains/engines exist, which are available, and which one "auto" picks.

auto order - brains: claude, codex, copilot, kimi, mock; engines: copilot, codex, mflux (+ mock in dev mode).
User-facing lists hide internal backends: `scene3d` (the hidden layout-guide renderer) always, and the `mock`
engine/brain unless dev mode (VV_DEV=1 or VV_MOCK=1). Internal backends can still be picked by explicit id
(e.g. `pick_engine("scene3d")` for the layout guide, `pick_brain("mock")` as the offline fallback).
scene3d is only registered if `pipeline.engines.scene3d` imports (it is owned by another module).
A preference of None falls back to VV_DEFAULT_BRAIN / VV_DEFAULT_ENGINE, then "auto". VV_DEFAULT_ENGINE may only
name a user-facing engine: scene3d always, and mock outside dev mode, are ignored with a warning (auto ordering).
`backend_report()` defaults only ever name listed (user-facing) backends, or null when none is available.
"""
from __future__ import annotations

import importlib
import inspect
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from typing import Any

from ..brains.base import Brain, BrainStatus
from ..brains.claude import ClaudeBrain
from ..brains.codex import CodexBrain
from ..brains.copilot import CopilotBrain
from ..brains.kimi import KimiBrain
from ..brains.mock import MockBrain
from ..providers import CACHE_SECONDS, PROVIDERS, clear_login_cache
from .base import EngineStatus, ImageEngine
from .codex import CodexEngine
from .copilot import CopilotEngine
from .mflux import MfluxEngine
from .mock import MockEngine

log = logging.getLogger(__name__)

BRAIN_ORDER = ("claude", "codex", "copilot", "kimi", "mock")
ENGINE_ORDER = ("copilot", "codex", "mflux", "mock")
ALWAYS_INTERNAL_ENGINES = frozenset({"scene3d"})


class BackendUnavailable(RuntimeError):
    """An explicitly requested backend exists but is not available on this machine."""


_brains: dict[str, Brain] | None = None
_engines: dict[str, ImageEngine] | None = None
_status: dict[tuple[str, str, str | None], tuple[float, BrainStatus | EngineStatus]] = {}


@dataclass(frozen=True)
class ProviderOptions:
    claude_config_dir: str | None = None
    copilot_model: str | None = None
    kimi_bin: str | None = None


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


def dev_mode() -> bool:
    """VV_DEV=1 or VV_MOCK=1: show the mock brain/engine in user-facing lists and let "auto" use them."""
    return any(os.environ.get(k, "").strip().lower() in ("1", "true", "yes", "on") for k in ("VV_DEV", "VV_MOCK"))


def internal_engine_ids() -> frozenset[str]:
    return ALWAYS_INTERNAL_ENGINES if dev_mode() else ALWAYS_INTERNAL_ENGINES | {"mock"}


def internal_brain_ids() -> frozenset[str]:
    return frozenset() if dev_mode() else frozenset({"mock"})


def _all_brains(options: ProviderOptions) -> dict[str, Brain]:
    global _brains
    if _brains is None:
        _brains = {b.id: b for b in (ClaudeBrain(), CodexBrain(), CopilotBrain(), KimiBrain(), MockBrain())}
    backends = dict(_brains)
    if options.claude_config_dir:
        backends["claude"] = ClaudeBrain(options.claude_config_dir)
    if options.copilot_model:
        backends["copilot"] = CopilotBrain(options.copilot_model)
    if options.kimi_bin:
        backends["kimi"] = KimiBrain(options.kimi_bin)
    return backends


def brains(include_internal: bool = False, *, options: ProviderOptions = ProviderOptions()) -> dict[str, Brain]:
    """Brains by id; the mock brain is listed only in dev mode unless include_internal."""
    hidden = frozenset() if include_internal else internal_brain_ids()
    return {k: v for k, v in _all_brains(options).items() if k not in hidden}


def engines(include_internal: bool = False, *,
            options: ProviderOptions = ProviderOptions()) -> dict[str, ImageEngine]:
    """User-facing (photoreal) engines by id; scene3d (and mock outside dev mode) only with include_internal."""
    hidden = frozenset() if include_internal else internal_engine_ids()
    return {k: v for k, v in _all_engines(options).items() if k not in hidden}


def _all_engines(options: ProviderOptions) -> dict[str, ImageEngine]:
    global _engines
    if _engines is None:
        items: list[ImageEngine] = [CopilotEngine(), CodexEngine(), MfluxEngine()]
        scene3d = _load_scene3d()
        if scene3d is not None:
            items.append(scene3d)
        items.append(MockEngine())
        _engines = {e.id: e for e in items}
    return {**_engines, "copilot": CopilotEngine(options.copilot_model)} if options.copilot_model else _engines


def refresh() -> None:
    """Forget cached instances and detection results (e.g. after installing a CLI)."""
    global _brains, _engines
    from .._proc import clear_version_cache

    _brains = _engines = None
    _status.clear()
    clear_version_cache()
    clear_login_cache()


def _detect(kind: str, backend: Any) -> BrainStatus | EngineStatus:
    config = None
    if isinstance(backend, ClaudeBrain):
        config = (backend.env or {}).get("CLAUDE_CONFIG_DIR")
    elif isinstance(backend, KimiBrain):
        config = backend.binary
    elif backend.id == "codex":
        config = os.environ.get("CODEX_HOME")
    key = (kind, backend.id, config)
    cached = _status.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]
    try:
        status = backend.detect()
    except Exception as e:  # noqa: BLE001 - defensive: detect() must never raise
        cls = BrainStatus if kind == "brain" else EngineStatus
        status = cls(available=False, detail=f"detect failed: {e}")
    _status[key] = time.monotonic(), status
    return status


def _pick(kind: str, pref: str | None, registry: dict[str, Any], order: tuple[str, ...], env: str,
          fallback: str | None) -> Any:
    """Explicit ids may name internal backends; "auto" walks `order` (already filtered to allowed ids)."""
    choice = (pref or _env_choice(kind, env) or "auto").strip().lower()
    if choice != "auto":
        if choice not in registry:
            raise ValueError(f"unknown {kind} {choice!r}; choose one of: auto, {', '.join(registry)}")
        status = _detect(kind, registry[choice])
        if not status.available:
            raise BackendUnavailable(f"{kind} {choice!r} is not available: {status.detail or 'not installed'}")
        if status.logged_in is False:
            raise BackendUnavailable(f"{registry[choice].label} is not signed in. Open Setup to sign in.")
        return registry[choice]
    for bid in order:
        if bid in registry:
            status = _detect(kind, registry[bid])
            if status.available and status.logged_in is not False:
                return registry[bid]
    if fallback is not None:
        return registry[fallback]
    raise BackendUnavailable(f"no {kind} is available; install and log in to one of: "
                             f"{', '.join(b for b in order if b != 'mock')}")


def _env_choice(kind: str, env: str) -> str | None:
    """The env default, ignoring (with a warning) engines that are hidden from users."""
    value = (os.environ.get(env) or "").strip().lower()
    if kind == "engine" and value in internal_engine_ids():
        log.warning("%s=%r names an internal engine; ignoring it and using auto ordering", env, value)
        return None
    return value or None


def pick_brain(pref: str | None = None, *, options: ProviderOptions = ProviderOptions()) -> Brain:
    """auto: claude, codex, copilot, kimi, then the offline mock brain (always usable as a fallback)."""
    return _pick("brain", pref, _all_brains(options), BRAIN_ORDER, "VV_DEFAULT_BRAIN", fallback="mock")


def pick_engine(pref: str | None = None, *, options: ProviderOptions = ProviderOptions()) -> ImageEngine:
    """auto: copilot, codex, mflux, then mock only in dev mode; otherwise BackendUnavailable."""
    order = tuple(e for e in ENGINE_ORDER if e not in internal_engine_ids())
    return _pick("engine", pref, _all_engines(options), order, "VV_DEFAULT_ENGINE", fallback=None)


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


def backend_report(*, options: ProviderOptions = ProviderOptions(), default_brain: str | None = None,
                   default_engine: str | None = None, include_layout: bool = True) -> dict:
    """Payload for GET /api/system/backends: user-facing brains/engines plus internal helper status."""
    b, e = brains(options=options), engines(options=options)
    scene3d = _all_engines(options).get("scene3d") if include_layout else None
    jobs = [("brain", x) for x in b.values()] + [("engine", x) for x in e.values()]
    if scene3d is not None:
        jobs.append(("engine", scene3d))
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        statuses = list(pool.map(lambda j: _detect(*j), jobs))
    entries = [_status_dict(kind, x, s) for (kind, x), s in zip(jobs, statuses, strict=True)]
    layout_guide = entries.pop() if scene3d is not None else {
        "id": "scene3d", "label": "Layout guide (3D scene)", "kind": "engine", "available": False,
        "logged_in": None, "version": None, "detail": "pipeline.engines.scene3d is not importable"}

    def default(fn, listed: dict[str, Any], kind: str, saved: str | None) -> str | None:
        """First pick (env default, then auto) that is a listed, available backend; never a hidden one."""
        for pref in (saved, "auto"):
            try:
                picked = fn(pref, options=options)
            except (ValueError, BackendUnavailable):
                continue
            if picked.id in listed and _detect(kind, picked).available:
                return picked.id
        return None

    return {
        "brains": [x for x in entries if x["kind"] == "brain"],
        "engines": [x for x in entries if x["kind"] == "engine"],
        "defaults": {
            "brain": default(pick_brain, b, "brain", default_brain),
            "engine": default(pick_engine, e, "engine", default_engine),
        },
        "internal": {"layout_guide": layout_guide},
    }


def status_fields(backend_id: str, kind: str) -> dict:
    provider = PROVIDERS[backend_id]
    return {
        "install": asdict(provider.install),
        "login": asdict(provider.login) if provider.login else None,
        "image_setup": (provider.image_setup or None) if kind == "engine" else None,
        "used_for": provider.used_for,
        "cost_note": provider.cost_note,
    }
