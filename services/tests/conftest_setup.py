"""Offline process doubles for the setup acceptance tests."""

import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from pipeline import _proc
from pipeline.engines import scene3d


@pytest.fixture
def setup_machine(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("VV_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("PATH", "/fake/bin")
    for key in ("VV_LAN", "VV_DEFAULT_BRAIN", "VV_DEFAULT_ENGINE", "VV_DEV", "VV_MOCK", "VV_KIMI_BIN"):
        monkeypatch.delenv(key, raising=False)
    machine = SimpleNamespace(
        home=home, installed=set(), logged_in={}, probes=[], calls=[],
        reply=lambda _argv, _cwd: (0, '{"ok": true}', ""),
    )
    monkeypatch.setattr(_proc.shutil, "which", lambda name: f"/fake/bin/{name}" if name in machine.installed else None)
    monkeypatch.setattr(scene3d, "_chromium_installed", lambda: False)

    def popen(argv, **kwargs):
        name, *args = (Path(argv[0]).name, *argv[1:])
        assert name in machine.installed
        machine.probes.append((name, args, kwargs["env"]))
        code, output = 0, f"{name} 1.0"
        if args == ["auth", "status"]:
            logged_in = machine.logged_in.get(name, False)
            code, output = int(not logged_in), json.dumps({"loggedIn": logged_in})
        elif args == ["login", "status"]:
            code, output = (0, "Logged in using ChatGPT") if machine.logged_in.get(name) else (1, "Not logged in")
        else:
            assert args == ["--version"]
        return SimpleNamespace(communicate=lambda **_: (output, ""), returncode=code)

    async def spawn(*argv, **kwargs):
        assert Path(argv[0]).name in machine.installed

        async def communicate(stdin):
            machine.calls.append((argv, kwargs["env"], stdin))
            return stdout.encode(), stderr.encode()

        code, stdout, stderr = machine.reply(argv, Path(kwargs["cwd"]))
        return SimpleNamespace(communicate=communicate, stdin=None, returncode=code)

    monkeypatch.setattr(subprocess, "Popen", popen)
    monkeypatch.setattr(_proc.asyncio, "create_subprocess_exec", spawn)
    return machine


def desktop(app=None):
    return TestClient(app or create_app(), base_url="http://localhost:8000", client=("127.0.0.1", 54321))
