"""FI1: a fresh `make setup` prints no "Ignored build scripts" warning box."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_esbuild_build_script_is_explicitly_ignored():
    pnpm = json.loads((ROOT / "package.json").read_text())["pnpm"]
    assert "esbuild" in pnpm["ignoredBuiltDependencies"]
