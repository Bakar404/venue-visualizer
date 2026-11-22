from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import pytest

from pipeline import _proc
from pipeline._proc import ProcTimeout, probe_version, run_cli

pytestmark = pytest.mark.skipif(os.name != "posix", reason="process groups are POSIX-only")


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


async def _wait_dead(pid: int, seconds: float = 3.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not _alive(pid):
            return True
        await asyncio.sleep(0.05)
    return False


async def _grandchild_pid(pidfile: Path) -> int:
    for _ in range(100):
        if pidfile.exists() and pidfile.read_text().strip():
            return int(pidfile.read_text())
        await asyncio.sleep(0.02)
    raise AssertionError("grandchild never started")


SPAWN = "sleep 30 & echo $! > pid; wait"


async def test_timeout_kills_the_whole_process_group(tmp_path: Path):
    with pytest.raises(ProcTimeout):
        await run_cli(["/bin/sh", "-c", SPAWN], cwd=tmp_path, timeout_s=0.5)
    assert await _wait_dead(await _grandchild_pid(tmp_path / "pid"))


async def test_sigterm_ignoring_child_is_sigkilled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(_proc, "KILL_GRACE_S", 0.3)
    start = time.monotonic()
    with pytest.raises(ProcTimeout):
        await run_cli(["/bin/sh", "-c", f"trap '' TERM; {SPAWN}"], cwd=tmp_path, timeout_s=0.3)
    assert time.monotonic() - start < 5
    assert await _wait_dead(await _grandchild_pid(tmp_path / "pid"))


async def test_cancel_kills_group_and_reaps_child(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    procs = []
    real = asyncio.create_subprocess_exec

    async def spy(*a, **k):
        procs.append(await real(*a, **k))
        return procs[-1]

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spy)
    task = asyncio.ensure_future(run_cli(["/bin/sh", "-c", SPAWN], cwd=tmp_path, timeout_s=30))
    grandchild = await _grandchild_pid(tmp_path / "pid")
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert procs[0].returncode is not None  # reaped, not a zombie
    assert await _wait_dead(grandchild)


def test_probe_version_timeout_kills_group(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(_proc, "VERSION_TIMEOUT_S", 0.3)
    _proc.clear_version_cache()
    pidfile = tmp_path / "pid"
    start = time.monotonic()
    result = probe_version("/bin/sh", ("-c", f"sleep 30 & echo $! > {pidfile}; wait"))
    assert result == (None, "version check timed out") and time.monotonic() - start < 3
    pid = int(pidfile.read_text())
    assert asyncio.run(_wait_dead(pid))
    _proc.clear_version_cache()


async def test_clean_env_withholds_unrelated_variables(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("VV_TEST_SECRET", "s3cret")
    full = await run_cli(["/usr/bin/env"], cwd=tmp_path, timeout_s=10)
    clean = await run_cli(["/usr/bin/env"], cwd=tmp_path, timeout_s=10, clean_env=True)
    assert "VV_TEST_SECRET=s3cret" in full.stdout
    assert "VV_TEST_SECRET" not in clean.stdout and "PATH=" in clean.stdout


def test_clean_env_never_forwards_api_keys(monkeypatch):
    from pipeline._proc import _child_env

    for key in ("OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.setenv(key, "sk-test")
    env = _child_env(clean=True)
    assert not any(k.endswith("API_KEY") for k in env)
