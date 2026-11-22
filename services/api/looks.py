from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from sqlmodel import Session, select

from pipeline import rules
from pipeline.models import VenueRules

from .contracts import JobOut, LookCreate, LookOut, Regenerate, RenderBatch, RenderIn
from .db import write_session
from .deps import RuntimeDep, look_out, render_out, require
from .integrations import pick_brain, pick_engine
from .jobs import ACTIVE, dispatch
from .models import ChatMessage, Job, Look, Photo, Render, Space, Venue
from .storage import media_path, remove_files

router = APIRouter(tags=["looks"])


@router.get("/api/spaces/{space_id}/looks")
def list_looks(space_id: UUID, runtime: RuntimeDep) -> list[LookOut]:
    with Session(runtime.engine) as session:
        space = require(session, Space, str(space_id))
        return [
            look_out(session, look)
            for look in session.exec(
                select(Look).where(Look.space_id == space.id).order_by(Look.created_at, Look.id)
            )
        ]


@router.post("/api/spaces/{space_id}/looks", status_code=201)
def create_look(space_id: UUID, body: LookCreate, runtime: RuntimeDep) -> LookOut:
    with write_session(runtime.engine) as session:
        space = require(session, Space, str(space_id))
        venue = require(session, Venue, space.venue_id)
        parent = None
        if body.parent_look_id:
            parent = require(session, Look, str(body.parent_look_id))
            if parent.space_id != space.id:
                raise HTTPException(422, "A variation must be in the same space as its parent look")
        spec, warnings = rules.check(body.spec, VenueRules.model_validate(venue.rules_json))
        warning_data = [w.to_dict() for w in warnings + rules.capacity_warnings(spec)]
        last_chat = session.exec(
            select(ChatMessage)
            .where(
                ChatMessage.space_id == space.id,
                ChatMessage.role == "assistant",
            )
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        ).first()
        if last_chat and last_chat.spec_after_json == spec.to_dict():
            warning_data += [warning for warning in last_chat.warnings_json if warning not in warning_data]
        look = Look(
            space_id=space.id,
            name=body.name,
            design_spec_json=spec.to_dict(),
            parent_look_id=parent.id if parent else None,
            warnings_json=warning_data,
        )
        session.add(look)
        return look_out(session, look)


@router.get("/api/looks/{look_id}")
def get_look(look_id: UUID, runtime: RuntimeDep) -> LookOut:
    with Session(runtime.engine) as session:
        return look_out(session, require(session, Look, str(look_id)))


@router.delete("/api/looks/{look_id}")
def delete_look(look_id: UUID, runtime: RuntimeDep) -> LookOut:
    with write_session(runtime.engine) as session:
        look = require(session, Look, str(look_id))
        response = look_out(session, look)
        if any(r.status in ACTIVE for r in response.renders):
            raise HTTPException(409, "Cancel or finish active renders before deleting this look")
        paths = session.exec(
            select(Render.path).where(Render.look_id == look.id, Render.path.is_not(None))
        ).all()
        targets = [media_path(runtime.settings.data_dir, path) for path in paths if path]
        session.delete(look)
    remove_files(targets)
    return response


def _enqueue_render(session: Session, look: Look, photo: Photo, engine_id: str, brain_id: str | None):
    render = Render(look_id=look.id, photo_id=photo.id, engine=engine_id, brain=brain_id)
    session.add(render)
    session.flush()
    job = Job(
        kind="render",
        queue_key=f"engine:{engine_id}",
        space_id=look.space_id,
        venue_id=photo.venue_id,
        render_id=render.id,
        payload_json={"render_id": render.id},
    )
    session.add(job)
    return job, render


@router.post("/api/looks/{look_id}/render", status_code=202, tags=["jobs"])
def render_look(look_id: UUID, runtime: RuntimeDep, body: RenderIn | None = None) -> RenderBatch:
    body = body or RenderIn()
    engine = pick_engine(runtime, body.engine, "can_edit")
    brain = pick_brain(runtime, body.brain) if body.brain_qa or body.brain else None
    with write_session(runtime.engine) as session:
        look = require(session, Look, str(look_id))
        photos = session.exec(
            select(Photo).where(Photo.space_id == look.space_id, Photo.approved.is_(True)).order_by(Photo.id)
        ).all()
        if body.photo_ids is not None:
            approved = {photo.id: photo for photo in photos}
            requested = [str(key) for key in body.photo_ids]
            if len(set(requested)) != len(requested) or set(requested) - approved.keys():
                raise HTTPException(422, "Select unique approved base photos from this look's space")
            photos = [approved[key] for key in requested]
        if not photos:
            raise HTTPException(409, "Add or approve a base photo before rendering")
        batch = [
            _enqueue_render(session, look, photo, engine.id, brain.id if brain else None) for photo in photos
        ]
    jobs = dispatch(runtime, [job for job, _render in batch])
    with Session(runtime.engine) as session:
        return RenderBatch(
            jobs=jobs,
            renders=[render_out(require(session, Render, render.id)) for _job, render in batch],
        )


@router.post("/api/renders/{render_id}/regenerate", status_code=202, tags=["jobs"])
def regenerate(render_id: UUID, runtime: RuntimeDep, body: Regenerate | None = None) -> JobOut:
    body = body or Regenerate()
    with Session(runtime.engine) as session:
        source = require(session, Render, str(render_id))
    engine = pick_engine(runtime, body.engine or source.engine, "can_edit")
    with write_session(runtime.engine) as session:
        previous = require(session, Render, source.id)
        photo = require(session, Photo, previous.photo_id)
        look = require(session, Look, previous.look_id)
        if not photo.approved:
            raise HTTPException(409, "The original base photo is not approved")
        job, _ = _enqueue_render(session, look, photo, engine.id, previous.brain)
    return dispatch(runtime, [job])[0]


@router.get(
    "/api/looks/{look_id}/export.pdf",
    response_class=Response,
    tags=["export"],
    responses={200: {"content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}},
)
def export_look(look_id: UUID, runtime: RuntimeDep) -> Response:
    from .pdf import make_pdf

    with Session(runtime.engine) as session:
        look = require(session, Look, str(look_id))
        space = require(session, Space, look.space_id)
        venue = require(session, Venue, space.venue_id)
        renders = session.exec(
            select(Render)
            .where(Render.look_id == look.id, Render.status == "done")
            .order_by(Render.created_at, Render.id)
        ).all()
        originals = [require(session, Photo, render.photo_id) for render in renders]
    contents = make_pdf(runtime.settings.data_dir, venue, space, look, zip(renders, originals, strict=True))
    return Response(
        contents,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="look-{look.id}.pdf"'},
    )
