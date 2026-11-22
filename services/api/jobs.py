import asyncio
import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from time import sleep

from sqlalchemy import DateTime, bindparam, text
from sqlmodel import Session, select

from .contracts import JobOut
from .db import write_session
from .deps import Runtime
from .integrations import IntegrationError
from .models import Job, JobStatus, Render, new_id, now
from .storage import VIDEO_SUFFIXES, remove_files

log = logging.getLogger(__name__)
HEARTBEAT_SECONDS = 10
STALE_AFTER = timedelta(seconds=60)
MAX_ATTEMPTS = 2
ACTIVE = ("queued", "running")

_CLAIM = text("""
    UPDATE jobs SET status = 'running', started_at = :now, heartbeat_at = :now,
        lease_id = :lease, attempts = attempts + 1, error = NULL, error_status = NULL
    WHERE id = (
        SELECT candidate.id FROM jobs AS candidate
        WHERE candidate.status = 'queued' AND NOT candidate.cancel_requested
          AND (SELECT COUNT(*) FROM jobs AS busy
               WHERE busy.status = 'running' AND busy.queue_key = candidate.queue_key)
            < COALESCE((SELECT value FROM json_each(:limits) WHERE key = candidate.queue_key), 1)
        ORDER BY candidate.created_at, candidate.id LIMIT 1
    ) RETURNING id
""").bindparams(bindparam("now", type_=DateTime()))


class JobCancelled(Exception):
    pass


def _render_status(session: Session, job: Job, status: JobStatus, error: str | None = None) -> None:
    if job.render_id and (render := session.get(Render, job.render_id)) is not None:
        render.status = status
        render.error = error


def claim_job(runtime: Runtime) -> Job | None:
    with Session(runtime.engine, expire_on_commit=False) as session:
        key = session.execute(
            _CLAIM,
            {
                "now": now(),
                "lease": new_id(),
                "limits": json.dumps(runtime.settings.engine_limits),
            },
        ).scalar_one_or_none()
        job = session.get(Job, key) if key else None
        if job is not None:
            _render_status(session, job, "running")
        session.commit()
        return job


def _end_lease(job: Job, status: JobStatus) -> None:
    job.status = status
    job.lease_id = job.heartbeat_at = None
    if status == "queued":
        job.started_at = None
        job.progress = 0
    else:
        job.finished_at = now()


def video_input(runtime: Runtime, job: Job) -> Path:
    suffix = job.payload_json["suffix"]
    if suffix not in VIDEO_SUFFIXES:
        raise RuntimeError("Invalid stored video extension")
    return runtime.settings.data_dir / "tmp" / f"video-{job.id}{suffix}"


def cleanup_video(runtime: Runtime, job: Job) -> None:
    if job.kind == "video_ingest" and job.status not in ACTIVE:
        remove_files([video_input(runtime, job)])


def reset_stale_jobs(runtime: Runtime) -> int:
    cutoff = now() - STALE_AFTER
    with write_session(runtime.engine) as session:
        stale = session.exec(
            select(Job).where(
                Job.status == "running",
                Job.lease_id.is_(None)
                | (Job.heartbeat_at < cutoff)
                | (Job.heartbeat_at.is_(None) & ((Job.started_at < cutoff) | Job.started_at.is_(None))),
            )
        ).all()
        for job in stale:
            if job.cancel_requested:
                _end_lease(job, "cancelled")
            else:
                job.attempts = max(0, job.attempts - 1)
                _end_lease(job, "queued")
            _render_status(session, job, job.status)
    for job in stale:
        cleanup_video(runtime, job)
    return len(stale)


def cancel_job(session: Session, job: Job) -> None:
    if job.status in ACTIVE:
        job.cancel_requested = True
        if job.status == "queued":
            _end_lease(job, "cancelled")
            job.error = job.error_status = None
            _render_status(session, job, "cancelled")


def _owned(session: Session, claimed: Job) -> Job:
    job = session.get(Job, claimed.id)
    if job is None or job.status != "running" or job.lease_id != claimed.lease_id:
        raise JobCancelled()
    return job


def progress(runtime: Runtime, claimed: Job, amount: float | None = None, prompt: str | None = None) -> None:
    with write_session(runtime.engine) as session:
        job = _owned(session, claimed)
        if job.cancel_requested:
            raise JobCancelled()
        job.heartbeat_at = now()
        if amount is not None:
            job.progress = amount
        if prompt is not None and job.render_id and (render := session.get(Render, job.render_id)):
            render.prompt = prompt


@contextmanager
def completing(runtime: Runtime, claimed: Job) -> Iterator[tuple[Session, Job]]:
    with write_session(runtime.engine) as session:
        job = _owned(session, claimed)
        if job.cancel_requested:
            raise JobCancelled()
        yield session, job
        _end_lease(job, "done")
        job.progress = 1
        _render_status(session, job, "done")


def _fail(runtime: Runtime, claimed: Job, exc: Exception) -> None:
    with write_session(runtime.engine) as session:
        job = session.get(Job, claimed.id)
        if job is None or job.status != "running" or job.lease_id != claimed.lease_id:
            return
        if job.cancel_requested or isinstance(exc, JobCancelled):
            _end_lease(job, "cancelled")
            job.error = job.error_status = None
        else:
            code = exc.status_code if isinstance(exc, IntegrationError) else None
            retry = job.attempts < MAX_ATTEMPTS and code not in (404, 409, 413, 422, 501)
            _end_lease(job, "queued" if retry else "failed")
            job.error = (str(exc) or type(exc).__name__)[-4000:]
            job.error_status = code
        _render_status(session, job, job.status, job.error)
    cleanup_video(runtime, job)


async def _heartbeat(runtime: Runtime, claimed: Job) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        try:
            progress(runtime, claimed)
        except JobCancelled:
            return


async def run_claimed(runtime: Runtime, claimed: Job) -> None:
    from .processing import process

    heartbeat = asyncio.create_task(_heartbeat(runtime, claimed))
    try:
        progress(runtime, claimed, 0.05)
        await process(runtime, claimed)
    except JobCancelled as exc:
        _fail(runtime, claimed, exc)
    except Exception as exc:
        log.exception("Job %s (%s) failed", claimed.id, claimed.kind)
        _fail(runtime, claimed, exc)
    else:
        claimed.status = "done"
        cleanup_video(runtime, claimed)
    finally:
        heartbeat.cancel()
        await asyncio.gather(heartbeat, return_exceptions=True)


def dispatch(runtime: Runtime, jobs: list[Job]) -> list[JobOut]:
    if not runtime.settings.inline_jobs:
        return [JobOut.model_validate(job) for job in jobs]
    ids = [job.id for job in jobs]
    while True:
        with Session(runtime.engine) as session:
            saved = {job.id: job for job in session.exec(select(Job).where(Job.id.in_(ids)))}
            if len(saved) != len(ids):
                raise IntegrationError(404, "Job was deleted")
            if all(job.status not in ACTIVE for job in saved.values()):
                for job in saved.values():
                    if job.error_status == 501:
                        raise IntegrationError(501, job.error or "Pipeline feature not implemented")
                return [JobOut.model_validate(saved[key]) for key in ids]
        sleep(0.05)
