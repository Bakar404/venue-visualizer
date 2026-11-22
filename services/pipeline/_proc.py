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
import signal
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
    """Return (version, error) for a binary. Cached per (path, args); never raises; bounded by a timeout.

    The binary runs in its own session so a timeout kills it and anything it spawned."""
    key = (path, *args)
    if key in _version_cache:
        return _version_cache[key]
    try:
        proc = subprocess.Popen(
            [path, *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            text=True,
            env=_child_env(),
            start_new_session=True,
        )
        try:
            stdout, stderr = proc.communicate(timeout=VERSION_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            _signal_group(proc.pid, signal.SIGKILL)
            try:
                proc.communicate(timeout=1)
            except subprocess.TimeoutExpired:
                pass
            finally:
                for pipe in (proc.stdout, proc.stderr):
                    if pipe:
                        pipe.close()
            raise
        out = (stdout or stderr or "").strip().splitlines()
        version = out[0].strip()[:120] if out else None
        result = (version, None if proc.returncode == 0 else f"--version exited {proc.returncode}")
    except subprocess.TimeoutExpired:
        result = (None, "version check timed out")
    except Exception as e:  # noqa: BLE001 - detect() must never raise
        result = (None, f"version check failed: {e}")
    _version_cache[key] = result
    return result


def clear_version_cache() -> None:
    _version_cache.clear()


# Variables a CLI may legitimately need when it runs with a minimal environment (`clean_env=True`):
# its own config/auth location, locale, temp dir and proxy/CA settings. Everything else is withheld.
_CLEAN_ENV_KEYS = (
    "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "CODEX_HOME", "OPENAI_API_KEY",
    "CODEX_API_KEY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR",
)


def _child_env(extra: dict[str, str] | None = None, clean: bool = False) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k in _CLEAN_ENV_KEYS} if clean else dict(os.environ)
    env.setdefault("NO_COLOR", "1")
    env.setdefault("TERM", "dumb")
    if extra:
        env.update(extra)
    return env


KILL_GRACE_S = 3.0


async def run_cli(
    argv: list[str],
    *,
    cwd: Path,
    timeout_s: float,
    stdin_text: str | None = None,
    env: dict[str, str] | None = None,
    clean_env: bool = False,
) -> ProcResult:
    """Run argv (no shell) in cwd; kill its whole process group if it exceeds timeout_s or is cancelled.

    The child starts in a new session, so helpers it spawns are killed with it. The child is always reaped
    (even when the caller is cancelled) and its pipes are closed. `clean_env=True` passes only
    `_CLEAN_ENV_KEYS` (plus `env`) instead of the whole parent environment."""
    start = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=str(cwd),
        stdin=asyncio.subprocess.PIPE if stdin_text is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_child_env(env, clean_env),
        start_new_session=True,
    )
    data = stdin_text.encode() if stdin_text is not None else None
    comm = asyncio.ensure_future(proc.communicate(data))
    try:
        out, err = await asyncio.wait_for(asyncio.shield(comm), timeout=timeout_s)
    except asyncio.CancelledError:
        await _shielded(_stop(proc, comm))
        raise
    except TimeoutError:
        out, err = await _shielded(_stop(proc, comm))
        raise ProcTimeout(argv, timeout_s, out.decode(errors="replace"), err.decode(errors="replace")) from None
    finally:
        _close_pipes(proc)
    return ProcResult(
        argv=argv,
        returncode=proc.returncode if proc.returncode is not None else -1,
        stdout=out.decode(errors="replace"),
        stderr=err.decode(errors="replace"),
        seconds=time.monotonic() - start,
    )


async def _shielded(coro):
    """Finish `coro` even if the awaiting task is cancelled again meanwhile (then re-raise the cancel)."""
    task = asyncio.ensure_future(coro)
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await asyncio.wait({task})
        raise


def _signal_group(pgid: int, sig: int) -> None:
    try:
        os.killpg(pgid, sig)
    except (ProcessLookupError, PermissionError):
        pass


async def _stop(proc: asyncio.subprocess.Process, comm: asyncio.Future) -> tuple[bytes, bytes]:
    """SIGTERM the process group, SIGKILL it after KILL_GRACE_S, then reap; returns any captured output."""
    pgid = proc.pid  # start_new_session=True: the child leads its own process group
    _signal_group(pgid, signal.SIGTERM)
    try:
        await asyncio.wait_for(proc.wait(), timeout=KILL_GRACE_S)
    except TimeoutError:
        pass
    _signal_group(pgid, signal.SIGKILL)  # also reaches grandchildren that ignored SIGTERM
    await proc.wait()
    try:
        return await asyncio.wait_for(comm, timeout=KILL_GRACE_S)
    except (TimeoutError, asyncio.CancelledError, OSError):
        comm.cancel()
        return b"", b""


def _close_pipes(proc: asyncio.subprocess.Process) -> None:
    if proc.stdin is not None and not proc.stdin.is_closing():
        proc.stdin.close()
    transport = getattr(proc, "_transport", None)
    if transport is not None and proc.returncode is not None:
        transport.close()


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
