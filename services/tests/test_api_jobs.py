from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from sqlmodel import Session

from api.config import Settings
from api.db import database, initialize, write_session
from api.deps import Runtime
from api.jobs import JobCancelled, cancel_job, claim_job, completing, progress, reset_stale_jobs, run_claimed
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
    assert reset_stale_jobs(runtime) == 1
    with Session(runtime.engine) as session:
        recovered = session.get_one(Job, stale.id)
        assert recovered.status == "queued" and recovered.progress == 0 and recovered.started_at is None
        assert session.get_one(Job, live.id).status == "running"
    claim = claim_job(runtime)
    assert claim.id == stale.id and claim.lease_id != stale.lease_id
    with pytest.raises(JobCancelled):
        progress(runtime, stale, 0.9)


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
