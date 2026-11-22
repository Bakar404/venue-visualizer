import asyncio
import inspect
from importlib import import_module
from pathlib import Path

from .config import Settings


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
    return engine_id != "scene3d" and (engine_id != "mock" or settings.dev)


def backend_report(settings: Settings) -> dict:
    from pipeline.registry import ENGINE_ORDER
    from pipeline.registry import backend_report as report

    results = report()
    engines = [item for item in results["engines"] if _visible(item["id"], settings)]
    available = {item["id"] for item in engines if item["available"]}
    preferred = results["defaults"]["engine"]
    default = (
        preferred if preferred in available else next((key for key in ENGINE_ORDER if key in available), None)
    )
    return {**results, "engines": engines, "defaults": {**results["defaults"], "engine": default}}


def pick_engine(settings: Settings, preference: str | None, capability: str):
    from pipeline.registry import BackendUnavailable
    from pipeline.registry import pick_engine as pick

    choice = preference.strip().lower() if preference else None
    if choice not in (None, "auto") and not _visible(choice, settings):
        raise IntegrationError(422, f"{choice!r} is not a user-facing engine in this mode")
    try:
        engine = pick(choice)
        if not _visible(engine.id, settings):
            default = backend_report(settings)["defaults"]["engine"]
            if default is None:
                raise IntegrationError(503, "No user-facing image engine is available")
            engine = pick(default)
    except BackendUnavailable as exc:
        raise IntegrationError(503, str(exc)) from exc
    except ValueError as exc:
        raise IntegrationError(422, str(exc)) from exc
    if not getattr(engine.capabilities(), capability):
        raise IntegrationError(
            422, f"Engine {engine.id!r} does not support {capability.removeprefix('can_')}"
        )
    return engine


def pick_brain(preference: str | None):
    from pipeline.registry import BackendUnavailable
    from pipeline.registry import pick_brain as pick

    try:
        return pick(preference)
    except BackendUnavailable as exc:
        raise IntegrationError(503, str(exc)) from exc
    except ValueError as exc:
        raise IntegrationError(422, str(exc)) from exc


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


def layout_clause() -> str:
    from pipeline import prompts

    clause = getattr(prompts, "build_layout_guide_clause", None)
    if clause is not None:
        return clause()
    # TODO: Remove the fallback when the shared prompt builder lands.
    return (
        "Use the extra reference image only as a layout guide for table positions and counts. "
        "Keep the original photo's architecture, camera angle, perspective, and photographic appearance."
    )


def pipeline_output(path: Path | str, work: Path) -> Path:
    path = Path(path)
    if not path.is_absolute() and not path.resolve().is_relative_to(work):
        path = work / path
    path = path.resolve()
    if not path.is_relative_to(work) or not path.is_file():
        raise RuntimeError("Pipeline output is missing or outside its working directory")
    return path
