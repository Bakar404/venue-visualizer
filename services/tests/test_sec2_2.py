"""SEC2-2 (R2-2): LAN mode serves a production build, never the Next dev server.

`next dev` exposes `/_next/mcp`, HMR and dev overlays; on the Wi-Fi that is a remote control for anyone nearby.
`make dev-lan` (alias `make lan`) builds once and runs `next start` with the attestation shim, the API stays on
loopback, and next.config turns the MCP endpoint off whenever VV_LAN=1 as defence in depth.
"""

import json
import os
import re
import shutil
import subprocess

import pytest

from .test_sec2_1 import NODE, REPO, fake_next, needs_node, run_wrapper  # noqa: F401 - pytest fixture
from .test_sec_1 import make_recipes

WEB = REPO / "apps" / "web"
LAN_BUILD = "pnpm --filter web build"
LAN_START = 'node ../../scripts/next-with-shim.mjs start --hostname "$$bind" --port 3000'
needs_make = pytest.mark.skipif(shutil.which("make") is None, reason="make is not installed")


def dry_run(target: str) -> str:
    return subprocess.run(["make", "-n", target], cwd=REPO, capture_output=True, text=True, check=True).stdout


def next_dev_mentions(text: str) -> list[str]:
    """Any way of starting the Next dev server: `next dev`, the wrapper's `dev`, or a package `dev` script."""
    return re.findall(r"next dev\b|next-with-shim\.mjs dev\b|--filter web dev\b|pnpm (?:run )?dev\b", text)


# --- the Makefile ------------------------------------------------------------------------------------------

def test_dev_lan_builds_then_runs_next_start_on_the_lan_address():
    recipe = make_recipes()["dev-lan"]
    assert LAN_BUILD in recipe and LAN_START in recipe
    assert recipe.index(LAN_BUILD) < recipe.index(LAN_START)
    assert recipe.count("--hostname") == 1


def test_dev_lan_never_runs_the_next_dev_server():
    assert next_dev_mentions(make_recipes()["dev-lan"]) == []


def test_dev_lan_keeps_the_api_on_loopback_and_runs_the_worker():
    recipe = make_recipes()["dev-lan"]
    assert "uvicorn api.main:app" in recipe and "--host 127.0.0.1" in recipe
    assert '--host "$$bind"' not in recipe and "0.0.0.0" not in recipe
    assert "python -m api.worker" in recipe


def test_make_lan_is_an_alias_for_dev_lan():
    makefile = (REPO / "Makefile").read_text(encoding="utf-8")
    assert re.search(r"^lan:\s*dev-lan\s*$", makefile, re.MULTILINE)
    phony = re.search(r"^\.PHONY:(.*)$", makefile, re.MULTILINE)
    assert phony and {"dev-lan", "lan"} <= set(phony.group(1).split())


@needs_make
@pytest.mark.parametrize("target", ["dev-lan", "lan"])
def test_make_dry_run_of_lan_mode_builds_and_starts(target):
    output = dry_run(target)
    assert LAN_BUILD in output and LAN_START.replace("$$", "$") in output
    assert output.index(LAN_BUILD) < output.index(LAN_START.replace("$$", "$"))
    assert next_dev_mentions(output) == []


@needs_make
def test_make_lan_runs_exactly_what_make_dev_lan_runs():
    assert dry_run("lan") == dry_run("dev-lan")


# --- the package scripts and the wrapper -------------------------------------------------------------------

def test_web_start_script_runs_next_start_with_the_shim():
    scripts = json.loads((WEB / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert scripts["start"] == "node ../../scripts/next-with-shim.mjs start --hostname 127.0.0.1"
    assert scripts["build"] == "next build"


def test_no_package_script_serves_the_dev_server_beyond_loopback():
    for package in (REPO / "package.json", WEB / "package.json"):
        for name, script in json.loads(package.read_text(encoding="utf-8"))["scripts"].items():
            if next_dev_mentions(script):
                assert "--hostname 127.0.0.1" in script, f"{package}: {name}"


@needs_node
@pytest.mark.parametrize("hostname", ["0.0.0.0", "192.168.10.2", "::"])
def test_the_wrapper_refuses_the_dev_server_on_the_network_even_in_lan_mode(fake_next, hostname):  # noqa: F811
    result = run_wrapper(fake_next, "dev", "--hostname", hostname, "--port", "3999", VV_LAN="1",
                         VV_LAN_PROXY_KEY="k" * 64)
    assert result.returncode == 2
    assert result.stdout == ""
    assert "next start" in result.stderr or "production" in result.stderr


@needs_node
def test_the_wrapper_runs_next_start_on_the_network_in_lan_mode(fake_next):  # noqa: F811
    result = run_wrapper(fake_next, "start", "--hostname", "0.0.0.0", "--port", "3999", VV_LAN="1",
                         VV_LAN_PROXY_KEY="k" * 64)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["argv"] == ["start", "--hostname", "0.0.0.0", "--port", "3999"]
    assert report["shim"] is True


# --- next.config: no MCP endpoint in LAN mode ----------------------------------------------------------------

# Next's own loader: evaluates next.config.ts, validates it and merges the defaults (mcpServer defaults to true).
LOAD_CONFIG_JS = """
const { default: loadConfig } = require("next/dist/server/config");
loadConfig(process.argv[1], process.cwd(), { silent: true }).then((config) => {
  process.stdout.write(JSON.stringify({ mcpServer: config.experimental.mcpServer ?? null,
    proxyClientMaxBodySize: config.experimental.proxyClientMaxBodySize }));
  process.exit(0);
});
"""


def loaded_config(phase: str, **env: str) -> dict:
    environ = {k: v for k, v in os.environ.items() if k not in ("VV_LAN", "VV_LAN_PROXY_KEY")}
    environ.update(NEXT_TELEMETRY_DISABLED="1", **env)
    result = subprocess.run([NODE, "-e", LOAD_CONFIG_JS, phase], cwd=WEB, env=environ, capture_output=True,
                            text=True, check=False, timeout=60)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


needs_next = pytest.mark.skipif(not (WEB / "node_modules" / "next").exists(), reason="run `pnpm install` first")


@needs_node
@needs_next
@pytest.mark.parametrize("phase", ["phase-production-build", "phase-production-server", "phase-development-server"])
def test_next_config_disables_the_mcp_server_in_lan_mode(phase):
    config = loaded_config(phase, VV_LAN="1")
    assert config["mcpServer"] is False
    assert config["proxyClientMaxBodySize"] == round(1.1 * 1024**3)


@needs_node
@needs_next
def test_next_config_keeps_the_default_outside_lan_mode():
    assert loaded_config("phase-development-server")["mcpServer"] is True
    assert loaded_config("phase-development-server", VV_LAN="0")["mcpServer"] is True
