import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from sqlmodel import Session, select

from pipeline import rules
from pipeline.brains.base import BrainError
from pipeline.models import VenueRules, default_spec

from .contracts import (
    ChatIn,
    ChatMessageOut,
    ChatOut,
    GenerateBase,
    JobOut,
    PhotoOut,
    SpaceOut,
    SpacePatch,
    SpecCheck,
    SpecCheckResult,
    SpecJSON,
)
from .db import write_session
from .deps import RuntimeDep, photo_out, require, set_room, space_out
from .integrations import IntegrationError, pick_brain, pick_engine, pipeline_module
from .jobs import ACTIVE, dispatch
from .models import ChatMessage, Job, Photo, Render, Space, Venue, new_id
from .storage import (
    MAX_PHOTOS,
    clean_image,
    media_path,
    photo_path,
    publish,
    publish_image,
    remove_files,
    staging,
)

spaces = APIRouter(prefix="/api/spaces", tags=["spaces"])
photos = APIRouter(prefix="/api/photos", tags=["photos"])
specs = APIRouter(prefix="/api/spec", tags=["spec"])


@spaces.get("/{space_id}")
def get_space(space_id: UUID, runtime: RuntimeDep) -> SpaceOut:
    with Session(runtime.engine) as session:
        return space_out(session, require(session, Space, str(space_id)))


@spaces.patch("/{space_id}")
def patch_space(space_id: UUID, body: SpacePatch, runtime: RuntimeDep) -> SpaceOut:
    with write_session(runtime.engine) as session:
        space = require(session, Space, str(space_id))
        if body.name is not None:
            space.name = body.name
        if body.venue_spec is not None:
            set_room(space, body.venue_spec.to_dict())
        if "current_spec" in body.model_fields_set:
            if body.current_spec is None:
                space.current_spec_json = None
            else:
                venue = require(session, Venue, space.venue_id)
                fixed, _ = rules.check(body.current_spec, VenueRules.model_validate(venue.rules_json))
                space.current_spec_json = fixed.to_dict()
        return space_out(session, space)


@spaces.post("/{space_id}/photos", status_code=201, tags=["photos"])
def upload_photos(
    space_id: UUID,
    runtime: RuntimeDep,
    bracket_files: Annotated[list[UploadFile] | None, File(alias="files[]")] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> list[PhotoOut]:
    uploads = [*(bracket_files or []), *(files or [])]
    if not 1 <= len(uploads) <= MAX_PHOTOS:
        raise HTTPException(422, f"Upload between 1 and {MAX_PHOTOS} photos at a time")
    root = runtime.settings.data_dir
    with Session(runtime.engine) as session:
        require(session, Space, str(space_id))
    with staging(root) as stage:
        images = [clean_image(upload.file, stage / str(index)) for index, upload in enumerate(uploads)]
        with publish() as published, write_session(runtime.engine) as session:
            space = require(session, Space, str(space_id))
            count = len(session.exec(select(Photo.id).where(Photo.space_id == space.id)).all())
            if count + len(images) > MAX_PHOTOS:
                raise HTTPException(409, f"A space can hold at most {MAX_PHOTOS} photos")
            response = []
            for image in images:
                key = new_id()
                path = photo_path(space.venue_id, key, image)
                publish_image(root, image.path, path, published)
                photo = Photo(
                    id=key,
                    venue_id=space.venue_id,
                    space_id=space.id,
                    path=path,
                    kind="upload",
                    approved=True,
                    width=image.width,
                    height=image.height,
                )
                session.add(photo)
                response.append(photo_out(photo))
            return response


@photos.delete("/{photo_id}", status_code=204)
def delete_photo(photo_id: UUID, runtime: RuntimeDep) -> Response:
    with write_session(runtime.engine) as session:
        photo = require(session, Photo, str(photo_id))
        renders = session.exec(select(Render).where(Render.photo_id == photo.id)).all()
        if any(render.status in ACTIVE for render in renders):
            raise HTTPException(409, "Cancel or finish active renders before deleting this photo")
        paths = [
            media_path(runtime.settings.data_dir, path)
            for path in [photo.path, *(r.path for r in renders)]
            if path
        ]
        session.delete(photo)
    remove_files(paths)
    return Response(status_code=204)


@photos.post("/{photo_id}/approve")
def approve_photo(photo_id: UUID, runtime: RuntimeDep) -> PhotoOut:
    with write_session(runtime.engine) as session:
        photo = require(session, Photo, str(photo_id))
        if photo.space_id is None:
            raise HTTPException(409, "Assign video frames to a space using video/apply")
        photo.approved = True
        return photo_out(photo)


@spaces.post("/{space_id}/generate-base", status_code=202, tags=["photos"])
def generate_base(space_id: UUID, body: GenerateBase, runtime: RuntimeDep) -> JobOut:
    engine = pick_engine(runtime.settings, body.engine, "can_generate")
    with write_session(runtime.engine) as session:
        space = require(session, Space, str(space_id))
        if space.references_json:
            pipeline_module("fetch", "download_image", "FetchError")
            if not engine.capabilities().can_edit:
                raise HTTPException(422, "This engine cannot use venue photos as references")
        count = len(session.exec(select(Photo.id).where(Photo.space_id == space.id)).all())
        if count >= MAX_PHOTOS:
            raise HTTPException(409, f"A space can hold at most {MAX_PHOTOS} photos")
        job = Job(
            kind="generate_base",
            queue_key=f"engine:{engine.id}",
            space_id=space.id,
            venue_id=space.venue_id,
            payload_json={"engine": engine.id, "angle_hint": body.angle_hint},
        )
        session.add(job)
    return dispatch(runtime, [job])[0]


@spaces.get("/{space_id}/chat", tags=["spec"])
def chat_history(space_id: UUID, runtime: RuntimeDep) -> list[ChatMessageOut]:
    with Session(runtime.engine) as session:
        space = require(session, Space, str(space_id))
        rows = session.exec(
            select(ChatMessage)
            .where(ChatMessage.space_id == space.id)
            .order_by(ChatMessage.created_at, ChatMessage.id)
        ).all()
        return [ChatMessageOut.model_validate(row) for row in rows]


@spaces.post("/{space_id}/chat", tags=["spec"])
def chat(space_id: UUID, body: ChatIn, runtime: RuntimeDep) -> ChatOut:
    from pipeline.spec_ops import chat_to_spec

    chosen = pick_brain(body.brain)
    with Session(runtime.engine) as session:
        space = require(session, Space, str(space_id))
        venue = require(session, Venue, space.venue_id)
        current = body.spec or space.current_spec_json or default_spec(space.name)
    try:
        result = asyncio.run(
            chat_to_spec(chosen, body.message, current, space.venue_spec_json, venue.rules_json)
        )
    except BrainError as exc:
        raise IntegrationError(502, str(exc)) from exc
    reply = result.reply
    rule_notes = getattr(result, "rule_notes", [])
    if result.warnings and not hasattr(result, "rule_notes"):
        reply += "\n\nAdjusted for venue rules: " + "; ".join(warning.message for warning in result.warnings)
    with write_session(runtime.engine) as session:
        saved = require(session, Space, space.id)
        if body.spec is None and saved.current_spec_json != space.current_spec_json:
            raise HTTPException(409, "The current spec changed during chat; retry with the latest spec")
        active_rules = require(session, Venue, saved.venue_id).rules_json
        if active_rules != venue.rules_json:
            raise HTTPException(409, "Venue rules changed during chat; retry with the latest rules")
        saved.current_spec_json = result.spec.to_dict()
        session.add_all(
            [
                ChatMessage(space_id=space.id, role="user", content=body.message),
                ChatMessage(
                    space_id=space.id,
                    role="assistant",
                    content=reply,
                    spec_patch_json=result.spec_patch,
                    spec_after_json=result.spec.to_dict(),
                    warnings_json=[w.to_dict() for w in result.warnings],
                ),
            ]
        )
    return ChatOut(
        brain=chosen.id,
        reply=reply,
        rule_notes=rule_notes,
        spec=result.spec,
        warnings=result.warnings,
        ambiguities=result.ambiguities,
    )


@specs.post("/check")
def check_spec(body: SpecCheck, runtime: RuntimeDep) -> SpecCheckResult:
    with Session(runtime.engine) as session:
        venue = require(session, Venue, str(body.venue_id))
        fixed, warnings = rules.check(body.spec, VenueRules.model_validate(venue.rules_json))
    return SpecCheckResult(spec=fixed, warnings=warnings + rules.capacity_warnings(fixed))


@specs.get("/default")
def get_default_spec() -> SpecJSON:
    return default_spec()
