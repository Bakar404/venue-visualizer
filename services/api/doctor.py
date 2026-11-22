"""Print an offline checklist for this machine: uv run python -m api.doctor."""

import argparse
import json
import platform
from dataclasses import asdict

from pipeline import registry
from pipeline._proc import which
from pipeline.engines.scene3d import _chromium_installed
from pipeline.providers import PROVIDERS, Provider

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
    entries = []
    ready_kinds = set()
    for provider_id, provider in PROVIDERS.items():
        if provider_id in {"mock", "scene3d"}:
            continue
        variants = [item for item in statuses["brains"] + statuses["engines"] if item["id"] == provider_id]
        installed = any(item["available"] for item in variants)
        logged_in = next((item["logged_in"] for item in variants if item["logged_in"] is not None), None)
        for item in variants:
            last_test = tests.get(f"{item['kind']}:{provider_id}", {})
            if item["available"] and (
                item["logged_in"] is True or (item["logged_in"] is None and last_test.get("ok") is True)
            ):
                ready_kinds.add(item["kind"])
        entries.append({"id": provider_id, **asdict(provider), "installed": installed, "logged_in": logged_in})

    ready = ready_kinds == {"brain", "engine"}
    next_step = None
    if not ready:
        codex = next(entry for entry in entries if entry["id"] == "codex")
        unverified = next(
            (item for item in statuses["brains"] + statuses["engines"]
             if item["kind"] not in ready_kinds and item["available"] and item["logged_in"] is None
             and item["id"] != "mock"), None,
        )
        if unverified:
            label = PROVIDERS[unverified["id"]].label
            warning = " (may use credits)" if unverified["kind"] == "engine" else ""
            next_step = f"run the {label} {unverified['kind']} test in Setup{warning}"
        elif not codex["installed"]:
            next_step = f"{_install(PROVIDERS['codex'], os_name)}, then codex login"
        else:
            next_step = "codex login"
        if not unverified and "engine" not in ready_kinds:
            next_step += f"; for images: {PROVIDERS['codex'].image_setup}"
    return {"ready": ready, "prerequisites": prerequisites, "providers": entries, "next": next_step}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Print the checklist as JSON")
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
        print("\nAI providers")
        for entry in report["providers"]:
            provider = PROVIDERS[entry["id"]]
            uses = ", ".join(use.replace("_", " ") for use in provider.used_for)
            login = "no sign-in needed" if provider.login is None else f"{_symbol(entry['logged_in'])} signed in"
            print(f"  {_symbol(entry['installed'])} {provider.label} installed | {login} — {uses}")
            print(f"    Cost: {provider.cost_note}")
            print(f"    Install: {_install(provider, os_name)}")
            if provider.login:
                print(f"    Sign in: {provider.login}")
            if provider.image_setup:
                print(f"    Enable images: {provider.image_setup}")
        print("\nYou're ready. Run make dev." if report["ready"] else f"\nDo this next: {report['next']}")
    return 0 if report["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
