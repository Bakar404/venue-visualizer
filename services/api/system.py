import asyncio
import logging
import os
import tempfile
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from math import ceil
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from pipeline import registry, verify
from pipeline._proc import ProcTimeout, tail
from pipeline.brains.base import BrainError
from pipeline.engines.base import EngineError, GenerateRequest
from pipeline.providers import PROVIDERS

from . import readiness
from .contracts import (
    BackendsOut,
    BackendTestIn,
    BackendTestOut,
    JobOut,
    LastTest,
    RoleSetup,
    SetupOut,
    SetupSteps,
)
from .db import write_session
from .deps import Runtime, RuntimeDep, require
from .integrations import IntegrationError, backend_report, invoke, pick_brain, pick_engine, pipeline_output
from .jobs import cancel_job, cleanup_video
from .models import Job, Photo, Render
from .settings import load, preferences, save_test
from .storage import MEDIA_TYPES, media_path

system = APIRouter(tags=["system"])
jobs = APIRouter(prefix="/api/jobs", tags=["jobs"])
files = APIRouter(tags=["files"])
log = logging.getLogger(__name__)

_TEST_SCHEMA = {
    "type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False,
}
_TEST_PROMPT = "a small vase of white flowers on a wooden table, photo"
TEST_INTERVALS = {"brain": 10, "engine": 60}
KEEP_TEST_IMAGES = 5


class BackendTests:
    """One running test per backend, and a minimum interval between test starts, so tests can't drain quota."""

    def __init__(self) -> None:
        self._running: set[str] = set()
        self._started: dict[str, float] = {}

    @contextmanager
    def slot(self, kind: str, backend_id: str, label: str):
        # Runs on the event loop with no await between check and claim, so no lock is needed.
        key = f"{kind}:{backend_id}"
        if key in self._running:
            raise HTTPException(409, f"A {label} test is already running.")
        now = time.monotonic()
        last = self._started.get(key)
        wait = TEST_INTERVALS[kind] - (now - last) if last is not None else 0
        if wait > 0:
            raise HTTPException(429, f"{label} was tested moments ago. Try again in {ceil(wait)} s.",
                                headers={"Retry-After": str(ceil(wait))})
        self._running.add(key)
        self._started[key] = now
        try:
            yield
        finally:
            self._running.discard(key)


def _keep_recent_samples(directory: Path) -> None:
    samples = []
    for path in directory.glob("*.png"):
        try:
            samples.append((path.stat().st_mtime, path))
        except OSError:
            pass
    for _, old in sorted(samples, reverse=True)[KEEP_TEST_IMAGES:]:
        old.unlink(missing_ok=True)


@system.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@system.get("/api/system/backends")
def backends(runtime: RuntimeDep) -> BackendsOut:
    return BackendsOut.model_validate(
        {**backend_report(runtime), "thresholds": {"structure_ok": verify.STRUCTURE_OK}}
    )


@system.post("/api/system/backends/refresh")
def refresh_backends(runtime: RuntimeDep) -> BackendsOut:
    registry.refresh()
    return backends(runtime)


@system.get("/api/system/setup")
def setup(runtime: RuntimeDep, request: Request) -> SetupOut:
    report = backends(runtime)
    brain = readiness.role(item.model_dump() for item in report.brains)
    engine = readiness.role(item.model_dump() for item in report.engines)
    defaults = preferences(load(runtime.engine)).setup_completed_at is not None
    missing = []
    if brain["missing"]:
        missing.append("brain")
    if engine["missing"]:
        missing.append("engine")
    if not defaults:
        missing.append("defaults")
    complete = not missing
    tools = not brain["missing"] and not engine["missing"]
    return SetupOut(complete=complete, missing=missing,
                    steps=SetupSteps(tools=tools, defaults=defaults, try_it=complete),
                    brain=RoleSetup(**brain), engine=RoleSetup(**engine),
                    client="owner" if request.state.owner else "phone")


def _test_error(backend_id: str, exc: Exception) -> str:
    label = PROVIDERS[backend_id].label
    message = str(exc).lower()
    if isinstance(exc, (TimeoutError, ProcTimeout)) or "timed out" in message:
        return f"{label} timed out. Try again."
    if isinstance(exc, FileNotFoundError) or any(x in message for x in ("not installed", "not found on path")):
        return f"{label} is not installed. See the install instructions in Setup."
    if any(x in message for x in ("quota", "rate limit", "rate_limit", "usage limit", "out of credits",
                                  "credits exhausted", "too many requests", "429")):
        return f"{label} quota exceeded. Check your plan or try again later."
    if any(x in message for x in ("not logged in", "not signed in", "log in", "sign in", "login required",
                                  "/login", "authentication", "unauthorized", "401", "invalid api key")):
        return f"{label} is not signed in. Follow the sign-in instructions in Setup."
    return f"{label} test failed: {tail(str(exc), 300)}"


@system.post("/api/system/backends/{kind}/{id}/test")
async def test_backend(
    kind: Literal["brain", "engine"], id: str, runtime: RuntimeDep, request: Request,
    body: BackendTestIn | None = None,
) -> BackendTestOut:
    choices = registry.brains() if kind == "brain" else registry.engines()
    if id not in choices or (kind == "engine" and id == "mock" and not runtime.settings.dev):
        raise HTTPException(404, f"Unknown {kind}: {id}")
    # A paired phone always confirms image tests, even for engines that are free on this computer.
    free = id in {"mock", "mflux"} and not request.state.lan_remote
    if kind == "engine" and not free and not (body and body.confirm_credits):
        raise HTTPException(422, "Set confirm_credits to true to run an image test that may use credits.")
    label = PROVIDERS[id].label
    tests: BackendTests = request.app.state.backend_tests
    with tests.slot(kind, id, label):
        return await _run_test(kind, id, label, runtime)


async def _run_test(kind: str, id: str, label: str, runtime: Runtime) -> BackendTestOut:
    start = time.monotonic()
    sample_url = None
    ok = False
    try:
        if kind == "brain":
            brain = await invoke(pick_brain, runtime, id)
            async with asyncio.timeout(60):
                value = await brain.complete_json("Respond with JSON.", 'Reply with {"ok": true}', _TEST_SCHEMA,
                                                  timeout_s=60)
            if value != {"ok": True} or value["ok"] is not True:
                raise BrainError('Expected the response {"ok": true}.')
            detail = f'{label} replied with {{"ok": true}}.'
        else:
            engine = await invoke(pick_engine, runtime, id, "can_generate")
            directory = runtime.settings.data_dir / "tests"
            directory.mkdir(exist_ok=True)
            name = f"{uuid4()}.png"
            with tempfile.TemporaryDirectory(dir=directory) as tmp:
                work = Path(tmp)
                image = await engine.generate(GenerateRequest(_TEST_PROMPT, work / name, size="1024x1024",
                                                              quality="low"))
                os.replace(pipeline_output(image.path, work), directory / name)
            _keep_recent_samples(directory)
            sample_url = f"/files/tests/{name}"
            detail = f"{label} generated a {image.width}x{image.height} sample."
        ok = True
    except (BrainError, EngineError, IntegrationError, TimeoutError, ProcTimeout, OSError) as exc:
        detail = _test_error(id, exc)
        log.warning("Backend test failed for %s/%s: %s", kind, id, detail)
    seconds = round(time.monotonic() - start, 3)
    await invoke(save_test, runtime.engine, kind, id, LastTest(
        ok=ok, at=datetime.now(UTC), seconds=seconds, detail=detail,
    ))
    return BackendTestOut(ok=ok, seconds=seconds, detail=detail, sample_url=sample_url)


@jobs.get("")
def list_jobs(runtime: RuntimeDep, space_id: UUID | None = None) -> list[JobOut]:
    stmt = select(Job)
    if space_id is not None:
        stmt = stmt.where(Job.space_id == str(space_id))
    with Session(runtime.engine) as session:
        return [
            JobOut.model_validate(job)
            for job in session.exec(stmt.order_by(Job.created_at.desc(), Job.id.desc()).limit(100))
        ]


@jobs.get("/{job_id}")
def get_job(job_id: UUID, runtime: RuntimeDep) -> JobOut:
    with Session(runtime.engine) as session:
        return JobOut.model_validate(require(session, Job, str(job_id)))


@jobs.post("/{job_id}/cancel")
def cancel(job_id: UUID, runtime: RuntimeDep) -> JobOut:
    with write_session(runtime.engine) as session:
        job = require(session, Job, str(job_id))
        cancel_job(session, job)
        response = JobOut.model_validate(job)
    cleanup_video(runtime, job)
    return response


@files.get("/files/tests/{sample_id}.png", response_class=FileResponse,
           responses={200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}})
def get_test_sample(sample_id: UUID, runtime: RuntimeDep) -> FileResponse:
    target = runtime.settings.data_dir / "tests" / f"{sample_id}.png"
    if target.resolve() != target or not target.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(target, media_type="image/png", headers={"X-Content-Type-Options": "nosniff"})


@files.get(
    "/files/{path:path}",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                kind: {"schema": {"type": "string", "format": "binary"}} for kind in MEDIA_TYPES.values()
            }
        }
    },
)
def get_file(path: str, runtime: RuntimeDep) -> FileResponse:
    try:
        target = media_path(runtime.settings.data_dir, path)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(404, "Image not found") from exc
    with Session(runtime.engine) as session:
        stmt = (
            select(Photo.id).where(Photo.path == path)
            if target.parent.name == "photos"
            else (select(Render.id).where(Render.path == path, Render.status == "done"))
        )
        if not session.exec(stmt).first() or not target.is_file():
            raise HTTPException(404, "Image not found")
    return FileResponse(
        target, media_type=MEDIA_TYPES[target.suffix], headers={"X-Content-Type-Options": "nosniff"}
    )
