import asyncio
import inspect
from importlib import import_module
from pathlib import Path

from . import readiness
from .config import Settings
from .deps import Runtime
from .settings import load, preferences


class IntegrationError(RuntimeError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def pipeline_module(name: str, *symbols: str):
    # TODO: Drop the feature gates once the parallel pipeline changes ship together with the API.
    module_name = f"pipeline.{name}"
    try:
        module = import_module(module_name)
    except ModuleNotFoundError as exc:
        if exc.name != module_name:
            raise
        raise IntegrationError(501, f"{module_name} is not implemented in the installed pipeline") from exc
    for symbol in symbols:
        if not hasattr(module, symbol):
            raise IntegrationError(
                501, f"{module_name}.{symbol} is not implemented in the installed pipeline"
            )
    return module


async def invoke(fn, *args, **kwargs):
    if inspect.iscoroutinefunction(fn):
        return await fn(*args, **kwargs)
    value = await asyncio.to_thread(fn, *args, **kwargs)
    return await value if inspect.isawaitable(value) else value


def _visible(engine_id: str, settings: Settings) -> bool:
    return readiness.visible_backend(engine_id, include_mock=settings.dev)


def backend_report(runtime: Runtime) -> dict:
    from pipeline.registry import ENGINE_ORDER, status_fields
    from pipeline.registry import backend_report as report

    saved = load(runtime.engine)
    prefs = preferences(saved)
    results = report(options=prefs.providers.options(), default_brain=prefs.default_brain,
                     default_engine=prefs.default_engine)
    last_tests = saved.values_json.get("last_tests", {})

    def enrich(item: dict) -> dict:
        key = f"{item['kind']}:{item['id']}"
        return {**item, **status_fields(item["id"], item["kind"]), "last_test": last_tests.get(key)}

    brains = [enrich(item) for item in results["brains"]]
    engines = [
        enrich(_with_max_refs(item)) for item in results["engines"] if _visible(item["id"], runtime.settings)
    ]
    available = {item["id"] for item in engines if item["available"] and item["logged_in"] is not False}
    preferred = results["defaults"]["engine"]
    default = (
        preferred if preferred in available else next((key for key in ENGINE_ORDER if key in available), None)
    )
    return {
        "brains": brains, "engines": engines,
        "defaults": {**results["defaults"], "engine": default},
        "internal": {key: enrich(item) for key, item in results["internal"].items()},
    }


def _with_max_refs(item: dict) -> dict:
    """Adds `caps.max_refs` (how many reference photos the engine accepts) to a registry status entry."""
    from pipeline.engines.registry import engines

    if item.get("caps") is None or (engine := engines(include_internal=True).get(item["id"])) is None:
        return item
    try:
        max_refs = int(engine.capabilities().max_refs)
    except Exception:  # noqa: BLE001 - caps are optional in the API payload
        return item
    return {**item, "caps": {**item["caps"], "max_refs": max_refs}}


def pick_engine(runtime: Runtime, preference: str | None, capability: str):
    from pipeline.registry import BackendUnavailable
    from pipeline.registry import pick_engine as pick

    prefs = preferences(load(runtime.engine))
    choice = preference.strip().lower() if preference else prefs.default_engine
    if choice not in (None, "auto") and not _visible(choice, runtime.settings):
        raise IntegrationError(422, f"{choice!r} is not a user-facing engine in this mode")
    try:
        engine = pick(choice, options=prefs.providers.options())
        if not _visible(engine.id, runtime.settings):
            default = backend_report(runtime)["defaults"]["engine"]
            if default is None:
                raise IntegrationError(503, "No user-facing image engine is available")
            engine = pick(default, options=prefs.providers.options())
    except BackendUnavailable as exc:
        raise IntegrationError(503, str(exc)) from exc
    except ValueError as exc:
        raise IntegrationError(422, str(exc)) from exc
    if not getattr(engine.capabilities(), capability):
        raise IntegrationError(
            422, f"Engine {engine.id!r} does not support {capability.removeprefix('can_')}"
        )
    return engine


def pick_brain(runtime: Runtime, preference: str | None):
    from pipeline.registry import BackendUnavailable
    from pipeline.registry import pick_brain as pick

    try:
        prefs = preferences(load(runtime.engine))
        return pick(preference or prefs.default_brain, options=prefs.providers.options())
    except BackendUnavailable as exc:
        raise IntegrationError(503, str(exc)) from exc
    except ValueError as exc:
        raise IntegrationError(422, str(exc)) from exc


def require_web_research(runtime: Runtime) -> None:
    if not preferences(load(runtime.engine)).allow_web_research:
        raise IntegrationError(403, "Web research is disabled in Settings.")


def require_web_brain(brain) -> None:
    if brain.id != "mock":
        parameters = inspect.signature(brain.complete_json).parameters
        if "web" not in parameters and not any(
            param.kind == inspect.Parameter.VAR_KEYWORD for param in parameters.values()
        ):
            raise IntegrationError(501, f"The {brain.id} brain does not yet support web-enabled research")


def layout_engine():
    from pipeline import registry

    engines = registry.engines
    # TODO: Use only the keyword form after the registry's internal-engine filter lands.
    entries = (
        engines(include_internal=True)
        if "include_internal" in inspect.signature(engines).parameters
        else (engines())
    )
    guide = entries.get("scene3d")
    return guide if guide and guide.detect().available else None


def layout_clause(spec: dict) -> str:
    from pipeline import prompts

    tables = spec.get("tables") or {}
    return prompts.build_layout_guide_clause(int(tables.get("count") or 0), str(tables.get("shape") or "round"))


def pipeline_output(path: Path | str, work: Path) -> Path:
    path = Path(path)
    if not path.is_absolute() and not path.resolve().is_relative_to(work):
        path = work / path
    path = path.resolve()
    if not path.is_relative_to(work) or not path.is_file():
        raise RuntimeError("Pipeline output is missing or outside its working directory")
    return path
