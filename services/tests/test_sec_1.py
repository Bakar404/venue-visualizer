"""SEC1: with LAN mode off, nothing on the Wi-Fi may reach the API with localhost privileges."""

import json
import logging
import re
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import lan

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import HOST, lan_env, pair_phone, phone, proxied

REPO = Path(__file__).resolve().parents[2]
LOCAL_WEB = "pnpm --filter web dev --hostname 127.0.0.1"
LAN_WEB = 'pnpm --filter web dev --hostname "$$bind"'


def make_recipes() -> dict[str, str]:
    """Target -> its recipe with line continuations joined."""
    recipes: dict[str, list[str]] = {}
    current = None
    for line in (REPO / "Makefile").read_text(encoding="utf-8").splitlines():
        if line.startswith("\t") and current:
            recipes[current].append(line[1:])
            continue
        match = re.match(r"^([A-Za-z0-9_-]+):(.*)$", line)
        if match and not re.match(r"\s*(export\s|\w+\s*[:?+]?=)", match.group(2)):
            current = match.group(1)
            recipes.setdefault(current, [])
        elif not line.startswith("\t"):
            current = None
    return {target: re.sub(r"\\\n\s*", " ", "\n".join(lines)) for target, lines in recipes.items()}


# --- (a) every non-LAN way of starting the web binds to 127.0.0.1 ---------------------------------

def test_root_dev_web_script_binds_loopback():
    scripts = json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert scripts["dev:web"] == LOCAL_WEB


@pytest.mark.parametrize("target", ["dev", "web"])
def test_local_make_targets_bind_web_to_loopback(target):
    recipe = make_recipes()[target]
    assert LOCAL_WEB in recipe
    assert recipe.count("--hostname") == 1
    assert "0.0.0.0" not in recipe


def test_dev_lan_calls_next_directly_with_a_single_hostname():
    recipe = make_recipes()["dev-lan"]
    assert LAN_WEB in recipe
    assert "dev:web" not in recipe
    assert recipe.count("--hostname") == 1


@pytest.mark.skipif(shutil.which("make") is None, reason="make is not installed")
@pytest.mark.parametrize(("target", "expected"), [
    ("dev", LOCAL_WEB), ("web", LOCAL_WEB), ("dev-lan", LAN_WEB.replace("$$", "$")),
])
def test_make_dry_run_shows_the_web_hostname(target, expected):
    output = subprocess.run(["make", "-n", target], cwd=REPO, capture_output=True, text=True, check=True).stdout
    assert expected in output
    assert output.count("--hostname") == 1
    assert "pnpm dev:web" not in output


# --- (b) proxied requests only count as local in the two safe cases --------------------------------

def test_proxied_request_from_wifi_device_is_not_local_when_lan_is_off(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch, lan=False, key=False)
    with desktop() as api:
        assert api.get("/api/venues").status_code == 200
        # Next's own rewrite of a desktop browser request: loopback forwarded host, no client claim.
        assert proxied(api.app, "localhost:3000").get("/api/venues").status_code == 200
        # The exploit: a Wi-Fi device sends `Host: localhost:3000` to a Next server bound to 0.0.0.0.
        spoof = proxied(api.app, "localhost:3000", **{"X-Forwarded-For": "192.168.10.4"})
        assert spoof.get("/api/venues").status_code == 403
        only_xff = TestClient(api.app, base_url="http://localhost:8000", client=("127.0.0.1", 50000),
                              headers={"X-Forwarded-For": "192.168.10.4"})
        assert only_xff.get("/api/venues").status_code == 403
        direct = phone(api.app, "192.168.10.4", Host="localhost:8000")
        assert direct.get("/api/venues").status_code == 403


def test_proxied_localhost_spoof_is_rejected_in_lan_mode(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        # Through the LAN shim: the attestation names the Wi-Fi device, whatever Host it sent.
        assert proxied(api.app, "localhost:3000", "192.168.10.4").get("/api/venues").status_code == 403
        # No attestation: a loopback forwarded host is not enough while LAN mode is on.
        assert proxied(api.app, "localhost:3000").get("/api/venues").status_code == 403
        assert phone(api.app, "192.168.10.4", Host="localhost:8000").get("/api/venues").status_code == 403
        assert proxied(api.app, "localhost:3000", "127.0.0.1").get("/api/venues").status_code == 200
        assert api.get("/api/venues").status_code == 200


def test_api_warns_when_the_web_listens_beyond_loopback(setup_machine, monkeypatch, caplog):  # noqa: F811
    lan_env(monkeypatch, lan=False, key=False)
    with socket.create_server(("127.0.0.1", 0)) as server:
        port = server.getsockname()[1]
        monkeypatch.setenv("VV_WEB_URL", f"http://localhost:{port}")
        # Stand in for the machine's Wi-Fi address with a socket we control.
        monkeypatch.setattr(lan, "_interface_addresses", lambda: ("127.0.0.1",), raising=False)
        caplog.set_level(logging.WARNING)
        with desktop():
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline and "listening on" not in caplog.text:
                time.sleep(0.05)
    assert f"web server is listening on 127.0.0.1:{port}" in caplog.text
    assert "make dev" in caplog.text


# --- (c) dangerous settings ---------------------------------------------------------------------------

def _executable(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\necho kimi 1.0\n")
    path.chmod(0o755)
    return path


def test_kimi_bin_must_be_an_absolute_kimi_executable(setup_machine, monkeypatch):  # noqa: F811
    home = setup_machine.home
    monkeypatch.setenv("VV_DATA_DIR", str(home / "vv-data"))
    good = _executable(home / "tools" / "kimi-cli")
    plain = home / "tools" / "kimi"
    plain.write_text("not executable")
    evil = _executable(home / "tools" / "evil")
    alias = home / "tools" / "kimi-shell"
    alias.symlink_to("/bin/sh")
    tmp = Path(tempfile.mkdtemp(dir="/tmp"))
    try:
        in_tmp = _executable(tmp / "kimi")
        in_data = _executable(home / "vv-data" / "kimi")
        with desktop() as api:
            for invalid in ("kimi", "./kimi", str(home / "tools" / "missing-kimi"), str(plain), str(evil),
                            str(alias), str(in_tmp), str(in_data)):
                response = api.patch("/api/settings", json={"providers": {"kimi": {"bin": invalid}}})
                assert response.status_code == 422, (invalid, response.text)
            response = api.patch("/api/settings", json={"providers": {"kimi": {"bin": str(good)}}})
            assert response.status_code == 200, response.text
            assert response.json()["providers"]["kimi"]["bin"] == str(good.resolve())
    finally:
        shutil.rmtree(tmp)


def test_claude_config_dir_needs_a_claude_marker(setup_machine, monkeypatch):  # noqa: F811
    home = setup_machine.home
    monkeypatch.setenv("VV_DATA_DIR", str(home / "vv-data"))
    empty = home / "empty"
    empty.mkdir()
    planted = home / "vv-data" / "claude"
    planted.mkdir(parents=True)
    (planted / "settings.json").write_text("{}")
    settings_dir = home / "work-claude"
    settings_dir.mkdir()
    (settings_dir / "settings.json").write_text("{}")
    state_dir = home / ".claude-personal"
    state_dir.mkdir()
    (state_dir / ".claude.json").write_text("{}")
    with desktop() as api:
        for invalid in (empty, planted):
            response = api.patch("/api/settings", json={"providers": {"claude": {"config_dir": str(invalid)}}})
            assert response.status_code == 422, (invalid, response.text)
        for valid in (settings_dir, state_dir):
            response = api.patch("/api/settings", json={"providers": {"claude": {"config_dir": str(valid)}}})
            assert response.status_code == 200, response.text


def test_settings_writes_only_from_true_local_requests(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    monkeypatch.setenv("VV_ALLOWED_HOSTS", "studio.test")
    with desktop() as api:
        device = pair_phone(api)
        assert device.get("/api/settings").status_code == 200
        assert device.patch("/api/settings", json={"allow_web_research": False}).status_code == 403
        # The local browser reached Next through a non-loopback name: reads work, writes do not.
        named = proxied(api.app, "studio.test:3000", "127.0.0.1")
        assert named.get("/api/settings").status_code == 200
        assert named.patch("/api/settings", json={"allow_web_research": False}).status_code == 403
        assert api.patch("/api/settings", json={"allow_web_research": False}).status_code == 200


def test_settings_writes_refuse_non_loopback_forwarded_host_when_lan_is_off(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch, lan=False, key=False)
    monkeypatch.setenv("VV_ALLOWED_HOSTS", "studio.test")
    with desktop() as api:
        named = proxied(api.app, "studio.test:3000")
        assert named.patch("/api/settings", json={"allow_web_research": False}).status_code == 403
        assert api.get("/api/settings").json()["allow_web_research"] is True


def test_lan_host_is_not_local_even_on_loopback(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        loopback_lan_host = TestClient(api.app, base_url=f"http://{HOST}:8000", client=("127.0.0.1", 50001))
        assert loopback_lan_host.get("/api/venues").status_code == 403


def test_dev_lan_keeps_the_api_on_loopback():
    """Only the web goes on the LAN; the API stays on 127.0.0.1 behind the attesting proxy (and the proxy can reach it)."""
    from pathlib import Path

    makefile = (Path(__file__).resolve().parents[2] / "Makefile").read_text()
    recipe = makefile.split("dev-lan:\n", 1)[1].split("\n\n", 1)[0]
    assert "uvicorn api.main:app" in recipe and "--host 127.0.0.1" in recipe
    assert '--host "$$bind"' not in recipe
