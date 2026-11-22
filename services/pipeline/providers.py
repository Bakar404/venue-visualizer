"""Installation guidance and offline login probes shared by setup and doctor."""

import json
import os
import subprocess
import time
from dataclasses import dataclass
from threading import Lock
from typing import Literal

from . import _proc

Use = Literal["chat", "web_research", "vision", "images"]
CACHE_SECONDS = 60


@dataclass(frozen=True)
class Install:
    macos: str
    linux: str
    docs_url: str


@dataclass(frozen=True)
class Login:
    """`command` is what to type (copyable); `note` is plain-text guidance for after it starts."""
    command: str
    note: str | None = None


@dataclass(frozen=True)
class Provider:
    label: str
    install: Install
    login: Login | None
    used_for: tuple[Use, ...]
    cost_note: str
    image_setup: str = ""


def npm(package: str, docs: str) -> Install:
    command = f"npm install -g {package}"
    return Install(command, command, docs)


PROVIDERS = {
    "claude": Provider("Claude Code", npm("@anthropic-ai/claude-code", "https://code.claude.com/docs/en/setup"),
                       Login("claude", "then follow the sign-in prompt"), ("chat", "web_research", "vision"),
                       "Uses your Claude plan quota"),
    "codex": Provider("Codex", npm("@openai/codex", "https://developers.openai.com/codex/cli/"),
                      Login("codex login"), ("chat", "web_research", "vision", "images"), "Uses ChatGPT plan quota",
                      "codex features enable image_generation"),
    "copilot": Provider("GitHub Copilot",
                        npm("@github/copilot", "https://docs.github.com/en/copilot/how-tos/copilot-cli"),
                        Login("copilot", "then type /login"), ("chat", "web_research", "vision", "images"),
                        "Uses GitHub Copilot AI credits"),
    "kimi": Provider("Kimi Code", Install("", "", "https://www.kimi.com/code/docs/en/"),
                     Login("kimi", "then type /login"), ("chat", "web_research", "vision"), "Uses your Kimi Code plan quota"),
    "mflux": Provider("Local FLUX (mflux)",
                      Install("uv tool install mflux", "Not supported (Apple Silicon only)",
                              "https://github.com/filipstrand/mflux"),
                      None, ("images",), "Free, runs on this Mac (Apple Silicon only)"),
    "mock": Provider("Offline mock", Install("", "", ""), None, ("chat", "images"), "Free, offline test backend"),
    "scene3d": Provider("Layout guide", Install("uv run --extra scene3d playwright install chromium",
                                               "uv run --extra scene3d playwright install chromium",
                                               "https://playwright.dev/python/docs/browsers"),
                        None, ("images",), "Free, local layout guide"),
}

_lock = Lock()
_logins: dict[tuple[str, str, str | None], tuple[float, bool | None]] = {}


def clear_login_cache() -> None:
    with _lock:
        _logins.clear()


def login_status(provider: str, path: str, env: dict[str, str] | None = None) -> bool | None:
    args = ("auth", "status") if provider == "claude" else ("login", "status")
    home = (env or {}).get("CLAUDE_CONFIG_DIR") if provider == "claude" else os.environ.get("CODEX_HOME")
    key = provider, path, home
    with _lock:
        cached = _logins.get(key)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            return cached[1]
        try:
            result = _proc.probe_cli(path, args, env=env, clean_env=provider == "codex")
        except (OSError, subprocess.TimeoutExpired):
            status = None
        else:
            if provider == "claude":
                try:
                    value = json.loads(result.stdout)
                except json.JSONDecodeError:
                    value = None
                logged_in = value.get("loggedIn") if isinstance(value, dict) else None
                status = logged_in if isinstance(logged_in, bool) else None
            else:
                text = f"{result.stdout}\n{result.stderr}".lower()
                if "not logged in" in text or "not signed in" in text or "using an api key" in text:
                    status = False
                elif result.returncode in (0, 1):
                    status = result.returncode == 0
                else:
                    status = None
        _logins[key] = time.monotonic(), status
        return status
