import asyncio
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlmodel import Session, select

from .contracts import (
    ImportOut,
    ImportPreview,
    JobOut,
    Name,
    ResearchIn,
    SkippedPhoto,
    SpaceCreate,
    SpaceOut,
    VenueCreate,
    VenueImport,
    VenueOut,
    VenuePatch,
    VideoApply,
    sparse_rules,
)
from .db import write_session
from .deps import RuntimeDep, new_space, require, set_room, space_out, venue_out
from .integrations import (
    IntegrationError,
    invoke,
    pick_brain,
    pipeline_module,
    pipeline_output,
    require_web_brain,
)
from .jobs import ACTIVE, dispatch, video_input
from .models import Job, Look, Photo, Render, Space, Venue, new_id
from .storage import (
    MAX_PHOTOS,
    MAX_WEB_PHOTOS,
    VIDEO_SUFFIXES,
    InvalidMedia,
    clean_image,
    media_path,
    photo_path,
    publish,
    publish_image,
    remove_files,
    save_video,
    staging,
    validate_video_duration,
)

router = APIRouter(prefix="/api/venues", tags=["venues"])


@router.get("")
def list_venues(runtime: RuntimeDep) -> list[VenueOut]:
    with Session(runtime.engine) as session:
        return [
            venue_out(session, v) for v in session.exec(select(Venue).order_by(Venue.created_at, Venue.id))
        ]


@router.post("", status_code=201)
def create_venue(body: VenueCreate, runtime: RuntimeDep) -> VenueOut:
    with write_session(runtime.engine) as session:
        venue = Venue(name=body.name, rules_json=sparse_rules(body.rules))
        session.add(venue)
        return venue_out(session, venue)


@router.post("/research", status_code=202)
def research_venue(body: ResearchIn, runtime: RuntimeDep) -> JobOut:
    pipeline_module("research", "research_venue")
    brain = pick_brain(body.brain)
    require_web_brain(brain)
    job = Job(
        kind="venue_research",
        queue_key=f"brain:{brain.id}",
        payload_json={"query": body.query, "brain": brain.id},
    )
    with write_session(runtime.engine) as session:
        session.add(job)
    return dispatch(runtime, [job])[0]


def _import_choices(body: VenueImport, preview: ImportPreview):
    names = set(body.space_names)
    if len(names) != len(body.space_names):
        raise HTTPException(422, "Space selections must be unique")
    spaces = [space for space in preview.spaces if space.name in names]
    if len(spaces) != len(names) or {space.name for space in spaces} != names:
        raise HTTPException(422, "Each selected space must uniquely match a suggested space")
    selected_rules = {}
    for key in set(body.accepted_rules):
        values = {
            rule.allowed for rule in preview.rules_suggested if rule.key == key and rule.allowed is not None
        }
        if len(values) != 1:
            raise HTTPException(422, f"No unambiguous suggested value for rule {key!r}")
        selected_rules[key] = values.pop()
    if set(body.accepted_provided_items) - set(preview.provided_items):
        raise HTTPException(422, "Each accepted provided item must match a suggested item")
    if body.accepted_provided_items:
        selected_rules["provided_items"] = list(dict.fromkeys(body.accepted_provided_items))
    available = {photo.url for space in spaces for photo in space.photos}
    selections = {}
    for choice in body.photos:
        if choice.url not in available or choice.url in selections:
            raise HTTPException(422, "Each photo selection must uniquely match a photo in a selected space")
        if choice.mode == "import" and not choice.rights_confirmed:
            raise HTTPException(422, "Confirm usage rights before importing a photo")
        selections[choice.url] = choice
    return spaces, selected_rules, selections


@router.post("/import", status_code=201)
def import_venue(body: VenueImport, runtime: RuntimeDep) -> ImportOut:
    module = pipeline_module("research", "research_to_import_preview")
    with Session(runtime.engine) as session:
        job = require(session, Job, str(body.research_job_id))
        if job.kind != "venue_research" or job.status != "done" or not job.result_json:
            raise HTTPException(409, "A completed venue research job is required")
        research = job.result_json["research"]
    if body.match_index >= len(research["matches"]):
        raise HTTPException(422, "Research match_index is out of range")
    try:
        preview = ImportPreview.model_validate(
            asyncio.run(invoke(module.research_to_import_preview, research, body.match_index))
        )
    except ValidationError as exc:
        raise IntegrationError(502, f"The pipeline returned an invalid venue import preview: {exc}") from exc
    spaces, rules, selections = _import_choices(body, preview)
    fetch = (
        pipeline_module("fetch", "download_image", "FetchError")
        if any(choice.mode == "import" for choice in selections.values())
        else None
    )
    root = runtime.settings.data_dir
    venue = Venue(name=preview.venue_name, rules_json=rules)
    with staging(root) as work:
        new_spaces = []
        imported = []
        skipped: dict[str, str] = {}
        for suggested in spaces:
            space = new_space(venue.id, suggested.name, suggested.venue_spec.to_dict())
            space.capacity_seated = suggested.capacity_seated
            space.capacity_standing = suggested.capacity_standing
            space.source = suggested.source
            new_spaces.append(space)
            seen = set()
            photos = [p for p in suggested.photos if p.url in selections]
            if len({p.url for p in photos}) > MAX_WEB_PHOTOS:
                raise HTTPException(422, f"Select at most {MAX_WEB_PHOTOS} web photos per space")
            for entry in photos:
                if entry.url in seen or entry.url in skipped:
                    continue
                seen.add(entry.url)
                if selections[entry.url].mode == "reference":
                    space.references_json.append(entry.model_dump())
                    continue
                assert fetch is not None
                key = new_id()
                folder = work / key
                folder.mkdir()
                try:
                    path = asyncio.run(invoke(fetch.download_image, entry.url, folder))
                    image = clean_image(pipeline_output(path, folder), folder / "clean")
                except (fetch.FetchError, InvalidMedia) as exc:
                    skipped[entry.url] = str(exc)
                    continue
                photo = Photo(
                    id=key,
                    venue_id=venue.id,
                    space_id=space.id,
                    path=photo_path(venue.id, key, image),
                    kind="web",
                    source_url=entry.url,
                    source_page=entry.source_page,
                    credit=entry.credit,
                    approved=True,
                    width=image.width,
                    height=image.height,
                )
                imported.append((photo, image))
        with publish() as published, write_session(runtime.engine) as session:
            session.add(venue)
            session.flush()
            session.add_all(new_spaces)
            session.flush()
            for photo, image in imported:
                publish_image(root, image.path, photo.path, published)
                session.add(photo)
            session.flush()
            return ImportOut(
                **dict(venue_out(session, venue)),
                skipped_photos=[SkippedPhoto(url=url, reason=reason) for url, reason in skipped.items()],
            )


@router.get("/{venue_id}")
def get_venue(venue_id: UUID, runtime: RuntimeDep) -> VenueOut:
    with Session(runtime.engine) as session:
        return venue_out(session, require(session, Venue, str(venue_id)))


@router.patch("/{venue_id}")
def patch_venue(venue_id: UUID, body: VenuePatch, runtime: RuntimeDep) -> VenueOut:
    with write_session(runtime.engine) as session:
        venue = require(session, Venue, str(venue_id))
        if body.name is not None:
            venue.name = body.name
        if body.rules is not None:
            venue.rules_json = {**venue.rules_json, **body.rules.model_dump(exclude_unset=True)}
        return venue_out(session, venue)


@router.delete("/{venue_id}")
def delete_venue(venue_id: UUID, runtime: RuntimeDep) -> VenueOut:
    with write_session(runtime.engine) as session:
        venue = require(session, Venue, str(venue_id))
        if session.exec(select(Job.id).where(Job.venue_id == venue.id, Job.status.in_(ACTIVE))).first():
            raise HTTPException(409, "Cancel or finish active venue jobs before deleting")
        response = venue_out(session, venue)
        photo_paths = session.exec(select(Photo.path).where(Photo.venue_id == venue.id)).all()
        render_paths = session.exec(
            select(Render.path)
            .join(Look)
            .join(Space)
            .where(
                Space.venue_id == venue.id,
                Render.path.is_not(None),
            )
        ).all()
        paths = [
            media_path(runtime.settings.data_dir, path) for path in [*photo_paths, *render_paths] if path
        ]
        session.delete(venue)
    remove_files(paths)
    return response


@router.post("/{venue_id}/spaces", status_code=201)
def create_space(venue_id: UUID, body: SpaceCreate, runtime: RuntimeDep) -> SpaceOut:
    with write_session(runtime.engine) as session:
        venue = require(session, Venue, str(venue_id))
        space = new_space(venue.id, body.name, body.venue_spec.to_dict())
        session.add(space)
        return space_out(session, space)


@router.post("/{venue_id}/video", status_code=202)
def upload_video(
    venue_id: UUID,
    runtime: RuntimeDep,
    file: Annotated[UploadFile, File()],
    brain: Annotated[Name | None, Form()] = None,
) -> JobOut:
    with Session(runtime.engine) as session:
        require(session, Venue, str(venue_id))
    pipeline_module("video", "ingest_video")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in VIDEO_SUFFIXES:
        raise HTTPException(422, "Upload an MP4, MOV, WebM, M4V or HEVC video")
    brain_id = pick_brain(brain).id if brain is not None else None
    job = Job(
        kind="video_ingest",
        queue_key="video",
        venue_id=str(venue_id),
        payload_json={"suffix": suffix, "brain": brain_id},
    )
    target = video_input(runtime, job)
    try:
        save_video(file.file, target)
        validate_video_duration(target)
        with write_session(runtime.engine) as session:
            require(session, Venue, str(venue_id))
            session.add(job)
    except BaseException:
        remove_files([target])
        raise
    return dispatch(runtime, [job])[0]


@router.post("/{venue_id}/video/apply")
def apply_video(venue_id: UUID, body: VideoApply, runtime: RuntimeDep) -> VenueOut:
    with write_session(runtime.engine) as session:
        venue = require(session, Venue, str(venue_id))
        job = require(session, Job, str(body.job_id))
        if job.venue_id != venue.id or job.kind != "video_ingest":
            raise HTTPException(404, "Video job not found for this venue")
        if job.status != "done" or not job.result_json or job.result_json.get("applied"):
            raise HTTPException(409, "A completed, unapplied video job is required")
        frame_set = session.exec(select(Photo).where(Photo.video_job_id == job.id)).all()
        frames = {photo.id: photo for photo in frame_set}
        chosen: set[str] = set()
        names: set[str] = set()
        for selection in body.spaces:
            if selection.name in names:
                raise HTTPException(422, "Video space names must be unique")
            names.add(selection.name)
            ids = [str(key) for key in selection.photo_ids]
            if len(set(ids)) != len(ids) or set(ids) & chosen or set(ids) - frames.keys():
                raise HTTPException(422, "Assign each frame from this video at most once")
            chosen.update(ids)
            matches = session.exec(
                select(Space).where(
                    Space.venue_id == venue.id,
                    Space.name == selection.name,
                )
            ).all()
            if len(matches) > 1:
                raise HTTPException(409, f"More than one existing space is named {selection.name!r}")
            spec = selection.venue_spec.to_dict()
            if matches:
                space = matches[0]
                if "venue_spec" in selection.model_fields_set:
                    set_room(space, spec)
            else:
                space = new_space(venue.id, selection.name, spec)
                session.add(space)
                session.flush()
            count = len(session.exec(select(Photo.id).where(Photo.space_id == space.id)).all())
            if count + len(ids) > MAX_PHOTOS:
                raise HTTPException(409, f"A space can hold at most {MAX_PHOTOS} photos")
            for key in ids:
                frames[key].space_id = space.id
                frames[key].approved = True
        discarded = []
        for photo in frame_set:
            if photo.id not in chosen:
                discarded.append(media_path(runtime.settings.data_dir, photo.path))
                session.delete(photo)
        job.result_json = {**job.result_json, "applied": True}
        session.flush()
        response = venue_out(session, venue)
    remove_files(discarded)
    return response
