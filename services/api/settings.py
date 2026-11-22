"""User preferences shared between API requests, workers and CLI diagnostics."""

import os
from datetime import UTC
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import AfterValidator, AwareDatetime, Field, StrictBool, StringConstraints
from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlmodel import Session

from pipeline.registry import ProviderOptions

from .config import Settings as Config
from .contracts import Input, LastTest
from .db import database, write_session
from .deps import RuntimeDep
from .models import Settings

router = APIRouter(prefix="/api/settings", tags=["settings"])

Option = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4096, pattern=r"^[^\x00]+$")]


_CLAUDE_MARKERS = (".claude.json", "settings.json")
_SHARED_TEMP = ("/tmp", "/var/tmp", "/dev/shm")
LAN_READ_ONLY = (
    "LAN mode can't be changed in settings. Restart with `make dev-lan` to open the app on your phone, "
    "or with `make dev` to keep it on this computer."
)


def _shared_temp(path: Path) -> bool:
    return any(path.is_relative_to(Path(root).resolve()) for root in _SHARED_TEMP)


def _config_dir(value: str) -> str:
    error = (
        "Claude config_dir must be an existing Claude configuration directory under your home folder "
        f"(containing {' or '.join(_CLAUDE_MARKERS)})"
    )
    try:
        path = Path(value).expanduser().resolve(strict=True)
        if (path.is_relative_to(Path.home().resolve()) and path.is_dir() and not _shared_temp(path)
                and any((path / marker).is_file() for marker in _CLAUDE_MARKERS)):
            return str(path)
    except (OSError, RuntimeError, ValueError):
        pass
    raise ValueError(error)


def _kimi_bin(value: str) -> str:
    error = "Kimi bin must be the absolute path of an existing kimi executable (named kimi or kimi-*)"
    path = Path(value)
    if not path.is_absolute():
        raise ValueError(error)
    try:
        # Validate (and later run) the real file, so a symlink named kimi can't point at a shell.
        resolved = path.resolve(strict=True)
        if (resolved.is_file() and os.access(resolved, os.X_OK) and not _shared_temp(resolved)
                and (resolved.name == "kimi" or resolved.name.startswith("kimi-"))):
            return str(resolved)
    except (OSError, RuntimeError, ValueError):
        pass
    raise ValueError(error)


def _safe(check, value: str | None) -> str | None:
    """Drop a saved path that no longer passes validation (e.g. saved by an older version)."""
    try:
        return check(value) if value is not None else None
    except ValueError:
        return None


class ClaudeOptions(Input):
    config_dir: Option | None = None


class ClaudePatch(ClaudeOptions):
    config_dir: Annotated[Option, AfterValidator(_config_dir)] | None = None


class CopilotOptions(Input):
    model: Option | None = None


class KimiOptions(Input):
    bin: Option | None = None


class KimiPatch(KimiOptions):
    bin: Annotated[Option, AfterValidator(_kimi_bin)] | None = None


class Providers(Input):
    claude: ClaudeOptions = Field(default_factory=ClaudeOptions)
    copilot: CopilotOptions = Field(default_factory=CopilotOptions)
    kimi: KimiOptions = Field(default_factory=KimiOptions)

    def options(self) -> ProviderOptions:
        return ProviderOptions(self.claude.config_dir, self.copilot.model, self.kimi.bin)


class ProvidersPatch(Providers):
    claude: ClaudePatch = Field(default_factory=ClaudePatch)
    kimi: KimiPatch = Field(default_factory=KimiPatch)


class LanOptions(Input):
    """Read-only: reflects whether this run was started with `make dev-lan`."""

    enabled: StrictBool = False


class SettingsOut(Input):
    default_brain: Literal["claude", "codex", "copilot", "kimi", "mock"] | None = None
    default_engine: Literal["copilot", "codex", "mflux", "mock"] | None = None
    allow_web_research: StrictBool = True
    setup_completed_at: Annotated[AwareDatetime, AfterValidator(lambda dt: dt.astimezone(UTC))] | None = None
    providers: Providers = Field(default_factory=Providers)
    lan: LanOptions = Field(default_factory=LanOptions)


class SettingsPatch(SettingsOut):
    providers: ProvidersPatch = Field(default_factory=ProvidersPatch)


def row(session: Session) -> Settings:
    settings = session.get(Settings, 1)
    if settings is None:
        raise RuntimeError("Database migration did not initialize settings")
    return settings


def load(engine: Engine) -> Settings:
    with Session(engine) as session:
        return row(session)


def preferences(settings: Settings) -> SettingsOut:
    saved = SettingsOut.model_validate(settings.values_json.get("preferences", {}))
    providers = saved.providers
    return saved.model_copy(update={"lan": LanOptions(), "providers": providers.model_copy(update={
        "claude": providers.claude.model_copy(update={"config_dir": _safe(_config_dir, providers.claude.config_dir)}),
        "kimi": providers.kimi.model_copy(update={"bin": _safe(_kimi_bin, providers.kimi.bin)}),
    })})


def _out(config: Config, prefs: SettingsOut) -> SettingsOut:
    return prefs.model_copy(update={"lan": LanOptions(enabled=config.lan_mode)})


def existing_settings(config: Config) -> Settings | None:
    """Read persisted preferences for standalone commands, without creating or upgrading a database."""
    if not (config.data_dir / "venue-visualizer.sqlite").is_file():
        return None
    engine = database(config.data_dir)
    try:
        return load(engine) if inspect(engine).has_table("settings") else None
    finally:
        engine.dispose()


def _merge(before: dict, patch: dict) -> dict:
    return {
        **before,
        **{key: _merge(before.get(key, {}), value) if isinstance(value, dict) else value
           for key, value in patch.items()},
    }


@router.get("")
def get_settings(runtime: RuntimeDep) -> SettingsOut:
    return _out(runtime.settings, preferences(load(runtime.engine)))


@router.patch("")
def patch_settings(body: SettingsPatch, runtime: RuntimeDep, request: Request) -> SettingsOut:
    if not request.state.owner:
        raise HTTPException(403, "Change settings on this computer, not from a paired device.")
    patch = body.model_dump(exclude_unset=True, mode="json")
    lan = patch.pop("lan", {})
    if lan.get("enabled", runtime.settings.lan_mode) != runtime.settings.lan_mode:
        raise HTTPException(422, LAN_READ_ONLY)
    providers = patch.get("providers", {})
    paths = (providers.get("claude", {}).get("config_dir"), providers.get("kimi", {}).get("bin"))
    if any(path and Path(path).is_relative_to(runtime.settings.data_dir) for path in paths):
        raise HTTPException(422, "Provider paths can't point inside the Venue Visualizer data folder.")
    with write_session(runtime.engine) as session:
        saved = row(session)
        previous = preferences(saved)
        current = SettingsOut.model_validate(_merge(previous.model_dump(mode="json"), patch))
        saved.values_json = {**saved.values_json, "preferences": current.model_dump(mode="json", exclude={"lan"})}
        session.add(saved)
    return _out(runtime.settings, current)


def save_test(engine: Engine, kind: str, backend_id: str, result: LastTest) -> None:
    with write_session(engine) as session:
        saved = row(session)
        tests = saved.values_json.get("last_tests", {})
        saved.values_json = {**saved.values_json, "last_tests": {
            **tests, f"{kind}:{backend_id}": result.model_dump(mode="json"),
        }}
        session.add(saved)
