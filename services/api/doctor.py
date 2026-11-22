"""Print an offline checklist for this machine: uv run python -m api.doctor [--strict] [--json].

Exits 0 with a verdict; --strict (make doctor-ci) exits 1 unless a brain and an image engine are ready."""

import argparse
import json
import platform
from dataclasses import asdict

from pipeline import registry
from pipeline._proc import which
from pipeline.engines.scene3d import _chromium_installed
from pipeline.providers import PROVIDERS, Provider

from . import readiness
from .config import Settings
from .settings import SettingsOut, existing_settings, preferences

_PREREQUISITES = (
    ("Node", ("node",), "Runs the web app and npm-based AI CLIs", "brew install node", "https://nodejs.org/en/download"),
    ("pnpm", ("pnpm",), "Installs and runs the web app", "npm install -g pnpm", "npm install -g pnpm"),
    ("Python", ("python3",), "Runs the API and worker", "uv python install 3.11", "uv python install 3.11"),
    ("uv", ("uv",), "Installs and runs the Python services", "brew install uv",
     "curl -LsSf https://astral.sh/uv/install.sh | sh"),
    ("ffmpeg", ("ffmpeg", "ffprobe"), "Turns video tours into venue photos", "brew install ffmpeg",
     "sudo apt-get install ffmpeg"),
)
_CHROMIUM = "uv run --extra scene3d playwright install chromium"


def _symbol(value: bool | None) -> str:
    return "✓" if value is True else "✗" if value is False else "?"


def _install(provider: Provider, os_name: str) -> str:
    return getattr(provider.install, os_name) or provider.install.docs_url


_ROLE_WORDS = {"brain": "chat", "engine": "images"}
SETUP_URL = "http://localhost:3000/setup"


def _status(provider: Provider, variants: list[dict]) -> tuple[str, str]:
    """(symbol, plain status) for one tool, from the same per-role states Setup uses."""
    states = {item["kind"]: readiness.state(item["available"], item["logged_in"], item["last_test"])
              for item in variants}
    values = set(states.values())
    if values <= {"missing"}:
        return "✗", "not installed"
    if "signed_out" in values:
        return "✗", "installed, not signed in"
    ready = [kind for kind, value in states.items() if value == "ready"]
    signed_in = any(item["logged_in"] is True for item in variants)
    if ready and len(ready) == len(states):
        return "✓", f"ready ({'signed in' if signed_in else 'test passed'})"
    if ready:
        rest = [kind for kind in states if kind not in ready]
        words = " and ".join(_ROLE_WORDS[kind] for kind in rest)
        failed = any(states[kind] == "failed" for kind in rest)
        return "✓", (f"ready for {' and '.join(_ROLE_WORDS[kind] for kind in ready)} (test passed); "
                     f"{words} {'test failed' if failed else 'not tested yet'}, run Test in Setup")
    if "failed" in values:
        return "✗", "installed, last test failed, run Test in Setup"
    if provider.login is None:
        return "?", "installed, not tested yet, run Test in Setup"
    return "?", "installed, sign-in unknown, run Test in Setup"


def _commands(provider: Provider, entry: dict, os_name: str) -> list[str]:
    lines = []
    if not entry["installed"]:
        lines.append(f"Install: {_install(provider, os_name)}")
    if provider.login and entry["symbol"] != "✓":
        note = f"  ({provider.login.note})" if provider.login.note else ""
        lines.append(f"Sign in: {provider.login.command}{note}")
    if provider.image_setup and not entry["engine_ready"]:
        lines.append(f"Enable images: {provider.image_setup}")
    return lines


def _next_step(roles: dict, entries: list[dict], os_name: str) -> str | None:
    missing = [kind for kind in readiness.ROLES if roles[kind]["missing"]]
    if not missing:
        return None
    tests: dict[str, list[str]] = {}
    for kind in missing:
        candidate = next((backend for backend in roles[kind]["likely"] if backend != "mock"), None)
        if candidate:
            tests.setdefault(candidate, []).append(f"Test {_ROLE_WORDS[kind]}")
    if tests:
        clicks = "; ".join(f"click {' and '.join(buttons)} on {PROVIDERS[backend].label}"
                           for backend, buttons in tests.items())
        warning = " (may use credits)" if "engine" in missing and any(
            "Test images" in buttons for buttons in tests.values()) else ""
        return f"Start the app with `make dev`, open {SETUP_URL} and {clicks}{warning}"
    codex = next(entry for entry in entries if entry["id"] == "codex")
    step = f"{_install(PROVIDERS['codex'], os_name)}, then codex login" if not codex["installed"] else "codex login"
    if "engine" in missing:
        step += f"; for images: {PROVIDERS['codex'].image_setup}"
    return step


def _report(os_name: str) -> dict:
    prerequisites = [
        {"label": label, "installed": all(which(program) for program in programs), "unlocks": unlocks,
         "install": macos if os_name == "macos" else linux}
        for label, programs, unlocks, macos, linux in _PREREQUISITES
    ]
    try:
        chromium = _chromium_installed()
    except ImportError:
        chromium = False
    except (OSError, RuntimeError):
        chromium = None
    prerequisites.append({"label": "Playwright Chromium", "installed": chromium,
                          "unlocks": "Renders guides for exact table layouts", "install": _CHROMIUM})

    saved = existing_settings(Settings.from_env())
    prefs = preferences(saved) if saved else SettingsOut()
    statuses = registry.backend_report(options=prefs.providers.options(), include_layout=False)
    tests = saved.values_json.get("last_tests", {}) if saved else {}
    items = [{**item, "last_test": tests.get(f"{item['kind']}:{item['id']}")}
             for item in statuses["brains"] + statuses["engines"]]
    roles = {kind: readiness.role(item for item in items if item["kind"] == kind) for kind in readiness.ROLES}
    entries = []
    for provider_id, provider in PROVIDERS.items():
        if provider_id in {"mock", "scene3d"}:
            continue
        variants = [item for item in items if item["id"] == provider_id]
        symbol, status = _status(provider, variants)
        entry = {
            "id": provider_id, **asdict(provider),
            "installed": any(item["available"] for item in variants),
            "logged_in": next((item["logged_in"] for item in variants if item["logged_in"] is not None), None),
            "symbol": symbol, "status": status, "engine_ready": provider_id in roles["engine"]["ready"],
        }
        entry["commands"] = _commands(provider, entry, os_name)
        entries.append(entry)

    ready = not any(roles[kind]["missing"] for kind in readiness.ROLES)
    return {"ready": ready, "roles": roles, "prerequisites": prerequisites, "providers": entries,
            "next": _next_step(roles, entries, os_name)}


def _verdict(report: dict) -> list[str]:
    roles = report["roles"]
    if report["ready"]:
        brain, engine = (PROVIDERS[roles[kind]["ready"][0]].label for kind in readiness.ROLES)
        return [f"Ready: {brain} for chat, {engine} for images. Start the app with `make dev`."]
    missing = " and no ready ".join(
        "brain (chat)" if kind == "brain" else "image engine" for kind in readiness.ROLES if roles[kind]["missing"]
    )
    lines = [f"Not ready yet: no ready {missing}."]
    likely = dict.fromkeys(backend for kind in readiness.ROLES if roles[kind]["missing"]
                           for backend in roles[kind]["likely"] if backend != "mock")
    for backend in likely:
        lines.append(f"{PROVIDERS[backend].label} will probably work. Run Test to be sure.")
    lines.append(f"Do this next: {report['next']}")
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Print the checklist as JSON")
    parser.add_argument("--strict", action="store_true", help="Exit 1 unless a brain and an engine are ready (CI)")
    args = parser.parse_args(argv)
    os_name = "macos" if platform.system() == "Darwin" else "linux"
    report = _report(os_name)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("Venue Visualizer doctor")
        print("\nPrerequisites")
        for entry in report["prerequisites"]:
            print(f"  {_symbol(entry['installed'])} {entry['label']}: {entry['unlocks']}")
            print(f"    Install: {entry['install']}")
        print("\nAI tools")
        for entry in report["providers"]:
            print(f"  {entry['symbol']} {PROVIDERS[entry['id']].label}: {entry['status']}")
            for command in entry["commands"]:
                print(f"      {command}")
        print()
        for line in _verdict(report):
            print(line)
    return 1 if args.strict and not report["ready"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
