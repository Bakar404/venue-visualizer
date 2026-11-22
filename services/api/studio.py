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
    PhotoReference,
    ReferenceImport,
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
    download_reference,
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


def _check_photo_capacity(session: Session, space_id: str, adding: int = 1) -> None:
    count = len(session.exec(select(Photo.id).where(Photo.space_id == space_id)).all())
    if count + adding > MAX_PHOTOS:
        raise HTTPException(409, f"A space can hold at most {MAX_PHOTOS} photos")


def _require_reference(space: Space, url: str) -> PhotoReference:
    for entry in space.references_json:
        if entry["url"] == url:
            return PhotoReference.model_validate(entry)
    raise HTTPException(422, "The URL is not a stored reference for this space")


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
            _check_photo_capacity(session, space.id, len(images))
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


@spaces.post("/{space_id}/references/import", status_code=201, tags=["photos"])
def import_reference(space_id: UUID, body: ReferenceImport, runtime: RuntimeDep) -> PhotoOut:
    with Session(runtime.engine) as session:
        space = require(session, Space, str(space_id))
        if not body.rights_confirmed:
            raise HTTPException(422, "Confirm you have the right to use this photo for personal planning")
        reference = _require_reference(space, body.url)
        _check_photo_capacity(session, space.id)

    root = runtime.settings.data_dir
    with staging(root) as stage:
        image = asyncio.run(download_reference(reference.url, stage))
        with publish() as published, write_session(runtime.engine) as session:
            space = require(session, Space, str(space_id))
            _check_photo_capacity(session, space.id)
            key = new_id()
            photo = Photo(
                id=key,
                venue_id=space.venue_id,
                space_id=space.id,
                path=photo_path(space.venue_id, key, image),
                kind="web",
                source_url=reference.url,
                source_page=reference.source_page,
                credit=reference.credit,
                approved=True,
                width=image.width,
                height=image.height,
            )
            publish_image(root, image.path, photo.path, published)
            session.add(photo)
            return photo_out(photo)


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
    if body.reference_url is not None:
        with Session(runtime.engine) as session:
            _require_reference(require(session, Space, str(space_id)), body.reference_url)
    engine = pick_engine(runtime.settings, body.engine, "can_generate")
    if body.reference_url is not None and engine.capabilities().max_refs < 1:
        raise HTTPException(422, f"{engine.label} can't use a reference photo; pick Copilot, Codex or mflux.")
    with write_session(runtime.engine) as session:
        space = require(session, Space, str(space_id))
        if body.reference_url is not None:
            pipeline_module("fetch", "download_image", "FetchError")
        _check_photo_capacity(session, space.id)
        job = Job(
            kind="generate_base",
            queue_key=f"engine:{engine.id}",
            space_id=space.id,
            venue_id=space.venue_id,
            payload_json={"engine": engine.id, "angle_hint": body.angle_hint, "reference_url": body.reference_url},
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
        messages = []
        for row in rows:
            meta = row.chat_meta_json or {}
            ambiguities = [
                {"question": item, "options": []} if isinstance(item, str) else item
                for item in meta.get("ambiguities", [])
            ]
            messages.append(ChatMessageOut(
                id=row.id, role=row.role, content=row.content, created_at=row.created_at,
                intent=meta.get("intent"), look_name=meta.get("look_name"), ambiguities=ambiguities,
            ))
        return messages


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
    spec_after = result.spec.to_dict()
    look_name = result.look_name
    with write_session(runtime.engine) as session:
        saved = require(session, Space, space.id)
        if body.spec is None and saved.current_spec_json != space.current_spec_json:
            raise HTTPException(409, "The current spec changed during chat; retry with the latest spec")
        active_rules = require(session, Venue, saved.venue_id).rules_json
        if active_rules != venue.rules_json:
            raise HTTPException(409, "Venue rules changed during chat; retry with the latest rules")
        if not result.spec_changed:
            latest = session.exec(
                select(ChatMessage)
                .where(ChatMessage.space_id == space.id, ChatMessage.role == "assistant")
                .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
                .limit(1)
            ).first()
            if latest and latest.spec_after_json == spec_after and latest.chat_meta_json:
                look_name = latest.chat_meta_json.get("look_name") or look_name
        saved.current_spec_json = spec_after
        session.add_all(
            [
                ChatMessage(space_id=space.id, role="user", content=body.message),
                ChatMessage(
                    space_id=space.id,
                    role="assistant",
                    content=reply,
                    spec_patch_json=result.spec_patch,
                    spec_after_json=spec_after,
                    warnings_json=[w.to_dict() for w in result.warnings],
                    chat_meta_json={
                        "intent": result.intent,
                        "look_name": look_name,
                        "ambiguities": result.ambiguities,
                    },
                ),
            ]
        )
    return ChatOut(
        brain=chosen.id,
        reply=reply,
        rule_notes=rule_notes,
        spec=result.spec,
        warnings=result.warnings,
        intent=result.intent,
        spec_changed=result.spec_changed,
        look_name=look_name,
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
