"""User preferences shared between API requests, workers and CLI diagnostics."""

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


def _config_dir(value: str) -> str:
    error = "Claude config_dir must be an existing directory under your home folder"
    try:
        path = Path(value).expanduser().resolve(strict=True)
        if path.is_relative_to(Path.home().resolve()) and path.is_dir():
            return str(path)
    except (OSError, RuntimeError, ValueError):
        pass
    raise ValueError(error)


def _kimi_bin(value: str) -> str:
    if "/" in value and not Path(value).is_absolute():
        raise ValueError("Kimi bin must be a command on PATH or an absolute path")
    return value


class ClaudeOptions(Input):
    config_dir: Option | None = None


class ClaudePatch(ClaudeOptions):
    config_dir: Annotated[Option, AfterValidator(_config_dir)] | None = None


class CopilotOptions(Input):
    model: Option | None = None


class KimiOptions(Input):
    bin: Annotated[Option, AfterValidator(_kimi_bin)] | None = None


class Providers(Input):
    claude: ClaudeOptions = Field(default_factory=ClaudeOptions)
    copilot: CopilotOptions = Field(default_factory=CopilotOptions)
    kimi: KimiOptions = Field(default_factory=KimiOptions)

    def options(self) -> ProviderOptions:
        return ProviderOptions(self.claude.config_dir, self.copilot.model, self.kimi.bin)


class ProvidersPatch(Providers):
    claude: ClaudePatch = Field(default_factory=ClaudePatch)


class LanOptions(Input):
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
    return SettingsOut.model_validate(settings.values_json.get("preferences", {}))


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
    return preferences(load(runtime.engine))


@router.patch("")
def patch_settings(body: SettingsPatch, runtime: RuntimeDep, request: Request) -> SettingsOut:
    patch = body.model_dump(exclude_unset=True, mode="json")
    if request.state.lan_remote and patch.keys() & {"lan", "providers"}:
        raise HTTPException(403, "Change LAN and provider settings from localhost.")
    with write_session(runtime.engine) as session:
        saved = row(session)
        previous = preferences(saved)
        current = SettingsOut.model_validate(_merge(previous.model_dump(mode="json"), patch))
        saved.values_json = {**saved.values_json, "preferences": current.model_dump(mode="json")}
        session.add(saved)
    if current.lan.enabled:
        request.app.state.pairing.announce()
    return current


def save_test(engine: Engine, kind: str, backend_id: str, result: LastTest) -> None:
    with write_session(engine) as session:
        saved = row(session)
        tests = saved.values_json.get("last_tests", {})
        saved.values_json = {**saved.values_json, "last_tests": {
            **tests, f"{kind}:{backend_id}": result.model_dump(mode="json"),
        }}
        session.add(saved)
