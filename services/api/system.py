from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from .contracts import BackendsOut, JobOut
from .db import write_session
from .deps import RuntimeDep, require
from .integrations import backend_report
from .jobs import cancel_job, cleanup_video
from .models import Job, Photo, Render
from .storage import MEDIA_TYPES, media_path

system = APIRouter(tags=["system"])
jobs = APIRouter(prefix="/api/jobs", tags=["jobs"])
files = APIRouter(tags=["files"])


@system.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@system.get("/api/system/backends")
def backends(runtime: RuntimeDep) -> BackendsOut:
    return BackendsOut.model_validate(backend_report(runtime.settings))


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
