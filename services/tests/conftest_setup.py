"""Offline process doubles for the setup acceptance tests."""

import json
import os
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.settings import _shared_temp
from pipeline import _proc
from pipeline.engines import scene3d


@pytest.fixture
def setup_machine(tmp_path, monkeypatch, request):
    home = tmp_path / "home"
    if _shared_temp(home.resolve()):
        # Provider settings reject shared temp paths even when HOME points there.
        private_home = TemporaryDirectory(prefix=".pytest-home-", dir=Path(__file__).resolve().parents[1])
        request.addfinalizer(private_home.cleanup)
        home = Path(private_home.name)
    else:
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
    def which(name):
        if Path(name).is_absolute():
            return name if Path(name).name in machine.installed and os.access(name, os.X_OK) else None
        return f"/fake/bin/{name}" if name in machine.installed else None

    monkeypatch.setattr(_proc.shutil, "which", which)
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


def record_test(kind: str, backend_id: str, *, ok: bool) -> None:
    """Persist a backend test result the way Setup's Test button does."""
    from api.contracts import LastTest
    from api.settings import save_test

    with desktop() as api:
        save_test(api.app.state.runtime.engine, kind, backend_id,
                  LastTest(ok=ok, at="2026-11-22T10:00:00Z", seconds=3, detail="ok" if ok else "failed"))
