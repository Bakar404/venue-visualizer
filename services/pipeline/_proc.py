"""Shared subprocess helpers for brains and engines.

Every CLI call goes through `run_cli`: explicit argv (never a shell), a fresh temp cwd chosen by the
caller, captured stdout/stderr and a hard timeout that kills the process. `probe_version` backs the
fast, cached, never-raising `detect()` implementations.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

VERSION_TIMEOUT_S = 2.5
_LOG_LIMIT = 20_000

_version_cache: dict[tuple[str, ...], tuple[str | None, str | None]] = {}


@dataclass
class ProcResult:
    argv: list[str]
    returncode: int
    stdout: str
    stderr: str
    seconds: float

    def log(self, limit: int = _LOG_LIMIT) -> str:
        return format_log(self.argv, self.stdout, self.stderr, self.returncode, limit)


class ProcTimeout(RuntimeError):
    def __init__(self, argv: list[str], timeout_s: float, stdout: str = "", stderr: str = ""):
        super().__init__(f"{Path(argv[0]).name} timed out after {timeout_s:.0f}s")
        self.argv = argv
        self.stdout = stdout
        self.stderr = stderr


def format_log(argv: list[str], stdout: str, stderr: str, returncode: int | None, limit: int = _LOG_LIMIT) -> str:
    shown = [a if len(a) <= 200 else a[:200] + "…" for a in argv]
    text = f"$ {' '.join(shown)}\n[exit {returncode}]\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}"
    return text if len(text) <= limit else text[: limit // 2] + "\n…\n" + text[-limit // 2 :]


def tail(text: str, n: int = 600) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else "…" + text[-n:]


def which(name: str) -> str | None:
    """`shutil.which` looked up at call time so tests can monkeypatch it."""
    try:
        return shutil.which(name)
    except (OSError, ValueError):
        return None


def probe_version(path: str, args: tuple[str, ...] = ("--version",)) -> tuple[str | None, str | None]:
    """Return (version, error) for a binary. Cached per (path, args); never raises; bounded by a timeout."""
    key = (path, *args)
    if key in _version_cache:
        return _version_cache[key]
    try:
        r = subprocess.run(
            [path, *args],
            capture_output=True,
            check=False,
            text=True,
            timeout=VERSION_TIMEOUT_S,
            stdin=subprocess.DEVNULL,
            env=_child_env(),
        )
        out = (r.stdout or r.stderr or "").strip().splitlines()
        version = out[0].strip()[:120] if out else None
        result = (version, None if r.returncode == 0 else f"--version exited {r.returncode}")
    except subprocess.TimeoutExpired:
        result = (None, "version check timed out")
    except Exception as e:  # noqa: BLE001 - detect() must never raise
        result = (None, f"version check failed: {e}")
    _version_cache[key] = result
    return result


def clear_version_cache() -> None:
    _version_cache.clear()


def _child_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ)
    env.setdefault("NO_COLOR", "1")
    env.setdefault("TERM", "dumb")
    if extra:
        env.update(extra)
    return env


async def run_cli(
    argv: list[str],
    *,
    cwd: Path,
    timeout_s: float,
    stdin_text: str | None = None,
    env: dict[str, str] | None = None,
) -> ProcResult:
    """Run argv (no shell) in cwd; kill the process if it exceeds timeout_s."""
    start = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=str(cwd),
        stdin=asyncio.subprocess.PIPE if stdin_text is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_child_env(env),
    )
    data = stdin_text.encode() if stdin_text is not None else None
    try:
        out, err = await asyncio.wait_for(proc.communicate(data), timeout=timeout_s)
    except asyncio.CancelledError:
        _kill(proc)
        raise
    except TimeoutError:
        _kill(proc)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=5)
        except Exception:  # noqa: BLE001
            out, err = b"", b""
        raise ProcTimeout(argv, timeout_s, out.decode(errors="replace"), err.decode(errors="replace")) from None
    return ProcResult(
        argv=argv,
        returncode=proc.returncode if proc.returncode is not None else -1,
        stdout=out.decode(errors="replace"),
        stderr=err.decode(errors="replace"),
        seconds=time.monotonic() - start,
    )


def _kill(proc: asyncio.subprocess.Process) -> None:
    try:
        proc.kill()
    except ProcessLookupError:
        pass


_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def extract_json(text: str) -> dict | None:
    """Return the first JSON object found in free-form CLI output (fenced block preferred)."""
    if not text:
        return None
    for m in _FENCE.finditer(text):
        try:
            obj = json.loads(m.group(1))
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
    decoder = json.JSONDecoder()
    idx = text.find("{")
    while idx != -1:
        try:
            obj, _ = decoder.raw_decode(text, idx)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
        idx = text.find("{", idx + 1)
    return None
