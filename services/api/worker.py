import asyncio
import logging
import signal
from time import monotonic

from .config import Settings
from .db import database, initialize
from .deps import Runtime
from .jobs import HEARTBEAT_SECONDS, claim_job, reset_stale_jobs, run_claimed


async def serve(runtime: Runtime, stop: asyncio.Event) -> None:
    active: set[asyncio.Task] = set()
    next_recovery = 0.0
    try:
        while not stop.is_set():
            done = {task for task in active if task.done()}
            active.difference_update(done)
            for task in done:
                task.result()
            if monotonic() >= next_recovery:
                reset_stale_jobs(runtime)
                next_recovery = monotonic() + HEARTBEAT_SECONDS
            if job := claim_job(runtime):
                active.add(asyncio.create_task(run_claimed(runtime, job)))
                await asyncio.sleep(0)
                continue
            try:
                await asyncio.wait_for(stop.wait(), 0.25)
            except TimeoutError:
                pass
    finally:
        # In-flight CLI calls keep their lease and finish; no more jobs are claimed.
        if active:
            await asyncio.gather(*active)


async def _main() -> None:
    settings = Settings.from_env()
    engine = database(settings.data_dir)
    try:
        initialize(engine)
        loop = asyncio.get_running_loop()
        stop = asyncio.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, stop.set)
        await serve(Runtime(settings, engine), stop)
    finally:
        engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    asyncio.run(_main())
