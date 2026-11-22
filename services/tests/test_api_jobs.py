import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from sqlmodel import Session

from api import worker
from api.config import Settings
from api.db import database, initialize, write_session
from api.deps import Runtime
from api.jobs import (
    MAX_ATTEMPTS,
    STALE_AFTER,
    JobCancelled,
    cancel_job,
    claim_job,
    completing,
    progress,
    reset_stale_jobs,
    run_claimed,
)
from api.models import Job, now


@pytest.fixture
def runtime(tmp_path):
    engine = database(tmp_path)
    initialize(engine)
    try:
        yield Runtime(Settings(tmp_path, dev=True), engine)
    finally:
        engine.dispose()


def _queue(runtime, *jobs):
    with write_session(runtime.engine) as session:
        session.add_all(jobs)


def test_two_workers_claim_atomically_and_respect_engine_limits(runtime):
    first = Job(kind="generate_base", queue_key="engine:mock")
    _queue(runtime, first)
    barrier = Barrier(2)

    def worker_claim():
        barrier.wait()
        return claim_job(runtime)

    with ThreadPoolExecutor(max_workers=2) as workers:
        claims = [workers.submit(worker_claim) for _ in range(2)]
        assert [j.id for future in claims if (j := future.result())] == [first.id]
    blocked = Job(kind="generate_base", queue_key="engine:mock")
    independent = Job(kind="generate_base", queue_key="engine:copilot")
    _queue(runtime, blocked, independent)
    assert claim_job(runtime).id == independent.id
    assert claim_job(runtime) is None


def test_recovery_requeues_stale_but_not_live_leases(runtime):
    old = now() - timedelta(minutes=5)
    stale = Job(
        kind="render",
        queue_key="engine:mock",
        status="running",
        progress=0.6,
        started_at=old,
        lease_id="old-lease",
        heartbeat_at=old,
        attempts=1,
    )
    live = Job(
        kind="render",
        queue_key="engine:copilot",
        status="running",
        started_at=old,
        lease_id="live-lease",
        heartbeat_at=now(),
    )
    _queue(runtime, stale, live)
    assert reset_stale_jobs(runtime, {stale.id}) == 0
    assert reset_stale_jobs(runtime) == 1
    with Session(runtime.engine) as session:
        recovered = session.get_one(Job, stale.id)
        assert recovered.status == "queued" and recovered.progress == 0 and recovered.started_at is None
        assert session.get_one(Job, live.id).status == "running"
    claim = claim_job(runtime)
    assert claim.id == stale.id and claim.lease_id != stale.lease_id
    with pytest.raises(JobCancelled):
        progress(runtime, stale, 0.9)


def test_stale_attempts_consume_retry_budget(runtime):
    job = Job(kind="render", queue_key="engine:mock")
    _queue(runtime, job)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        claim = claim_job(runtime)
        assert claim.id == job.id and claim.attempts == attempt
        with write_session(runtime.engine) as session:
            session.get_one(Job, job.id).heartbeat_at = now() - STALE_AFTER - timedelta(seconds=1)
        assert reset_stale_jobs(runtime) == 1
    with Session(runtime.engine) as session:
        saved = session.get_one(Job, job.id)
        assert saved.status == "failed" and saved.attempts == MAX_ATTEMPTS
        assert saved.error == "worker crashed repeatedly on this job"
    assert claim_job(runtime) is None


async def test_running_cancel_cancels_processing_and_holds_slot_during_cleanup(runtime, monkeypatch):
    started, stopping, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def process(_runtime, _claim):
        try:
            started.set()
            await asyncio.Future()
        except asyncio.CancelledError:
            stopping.set()
            await release.wait()
            raise

    monkeypatch.setattr("api.processing.process", process)
    first = Job(kind="render", queue_key="engine:mock")
    second = Job(kind="render", queue_key="engine:mock")
    _queue(runtime, first)
    runner = asyncio.create_task(run_claimed(runtime, claim_job(runtime)))
    try:
        await asyncio.wait_for(started.wait(), 2)
        _queue(runtime, second)
        with write_session(runtime.engine) as session:
            cancel_job(session, session.get_one(Job, first.id))
        await asyncio.wait_for(stopping.wait(), 2)
        with Session(runtime.engine) as session:
            assert session.get_one(Job, first.id).status == "running"
        assert claim_job(runtime) is None
    finally:
        release.set()
        await asyncio.wait_for(runner, 2)
    with Session(runtime.engine) as session:
        assert session.get_one(Job, first.id).status == "cancelled"
    assert claim_job(runtime).id == second.id


async def test_worker_refreshes_and_excludes_its_own_jobs_before_recovery_after_sleep(runtime, monkeypatch):
    stop, recovered = asyncio.Event(), asyncio.Event()
    before_sleep = now()
    tick = before_sleep
    job = Job(kind="render", queue_key="engine:mock")
    _queue(runtime, job)

    async def process(runtime, claim):
        nonlocal tick
        with write_session(runtime.engine) as session:
            session.get_one(Job, claim.id).heartbeat_at = before_sleep - STALE_AFTER
        tick += STALE_AFTER + timedelta(seconds=1)
        await stop.wait()
        with completing(runtime, claim):
            pass

    def recover(runtime, active_job_ids):
        if tick != before_sleep:
            assert active_job_ids == {job.id}
            with Session(runtime.engine) as session:
                saved = session.get_one(Job, job.id)
                assert saved.heartbeat_at >= before_sleep
                assert saved.status == "running" and saved.attempts == 1
            recovered.set()
        return reset_stale_jobs(runtime, active_job_ids)

    monkeypatch.setattr("api.processing.process", process)
    monkeypatch.setattr("api.jobs.CANCEL_POLL_SECONDS", 60)
    monkeypatch.setattr(worker, "now", lambda: tick)
    monkeypatch.setattr(worker, "monotonic", lambda: 100.0)
    monkeypatch.setattr(worker, "reset_stale_jobs", recover)
    serving = asyncio.create_task(worker.serve(runtime, stop))
    try:
        await asyncio.wait_for(recovered.wait(), 2)
    finally:
        stop.set()
        await asyncio.wait_for(serving, 2)


async def test_failed_attempt_retries_once_and_running_cancel_wins(runtime, monkeypatch):
    async def fail(_runtime, _job):
        raise RuntimeError("engine failed")

    monkeypatch.setattr("api.processing.process", fail)
    job = Job(kind="render", queue_key="engine:mock")
    _queue(runtime, job)
    for attempt in (1, 2):
        claim = claim_job(runtime)
        assert claim.attempts == attempt
        await run_claimed(runtime, claim)
    assert claim_job(runtime) is None
    with Session(runtime.engine) as session:
        saved = session.get_one(Job, job.id)
        assert saved.status == "failed" and saved.error == "engine failed"

    async def complete_after_cancel(runtime, claim):
        with write_session(runtime.engine) as session:
            cancel_job(session, session.get_one(Job, claim.id))
        with completing(runtime, claim):
            pytest.fail("A cancelled worker must not publish results")

    monkeypatch.setattr("api.processing.process", complete_after_cancel)
    cancelled = Job(kind="render", queue_key="engine:mock")
    _queue(runtime, cancelled)
    await run_claimed(runtime, claim_job(runtime))
    with Session(runtime.engine) as session:
        assert session.get_one(Job, cancelled.id).status == "cancelled"


def test_settings_resolves_symlinked_data_dir(tmp_path):
    from api.config import Settings

    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "link"
    link.symlink_to(real)
    assert Settings(link).data_dir == real.resolve()
