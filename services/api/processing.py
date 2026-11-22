import logging
from dataclasses import dataclass, field
from pathlib import Path

import jsonschema
from sqlmodel import Session, select

from pipeline import prompts, rules, verify
from pipeline.brains.base import BrainError
from pipeline.engines.base import EditRequest, EngineError, GenerateRequest
from pipeline.models import DesignSpec, VenueRules, load_schema

from .contracts import FrameOut, PhotoReference, VideoResult, VideoSpaceOut
from .deps import Runtime
from .integrations import (
    IntegrationError,
    invoke,
    layout_clause,
    layout_engine,
    pick_brain,
    pick_engine,
    pipeline_module,
    pipeline_output,
    require_web_brain,
)
from .jobs import completing, progress, video_input
from .models import Job, Look, Photo, Render, Space, Venue, new_id
from .storage import (
    MAX_PHOTOS,
    MAX_VIDEO_SECONDS,
    CleanImage,
    clean_image,
    media_path,
    photo_path,
    publish,
    publish_image,
    staging,
)

logger = logging.getLogger(__name__)

_PHOTO_REAL = (
    "A real photograph by a professional event photographer, 24mm, eye level, realistic materials, no CGI."
)
_QA_SCHEMA = {
    "type": "object",
    "properties": {
        "tables_seen": {"type": "integer", "minimum": 0},
        "notes": {"type": "string", "maxLength": 1500},
    },
    "required": ["tables_seen", "notes"],
    "additionalProperties": False,
}


@dataclass
class Outcome:
    result: dict
    photos: list[tuple[Photo, CleanImage]] = field(default_factory=list)
    render_fields: dict = field(default_factory=dict)
    render_image: CleanImage | None = None


async def _render(runtime: Runtime, job: Job, work: Path) -> Outcome:
    assert job.render_id is not None
    with Session(runtime.engine) as session:
        render = session.get_one(Render, job.render_id)
        look = session.get_one(Look, render.look_id)
        photo = session.get_one(Photo, render.photo_id)
        space = session.get_one(Space, look.space_id)
        venue = session.get_one(Venue, space.venue_id)
    original = media_path(runtime.settings.data_dir, photo.path)
    if not photo.approved or not original.is_file():
        raise IntegrationError(409, "The original base photo is missing or not approved")
    engine = await invoke(pick_engine, runtime.settings, render.engine, "can_edit")
    spec, warnings = rules.check(
        DesignSpec.model_validate(look.design_spec_json), VenueRules.model_validate(venue.rules_json)
    )
    prompt = f"{prompts.build_edit_prompt(spec, space.venue_spec_json)}\n{_PHOTO_REAL}"
    refs = []
    guide = await invoke(layout_engine) if spec.tables.count > 0 else None
    if guide:
        try:
            guide_result = await guide.generate(
                GenerateRequest(
                    prompt="Layout guide for table positions and counts",
                    out_path=work / "layout.png",
                    design_spec=spec.to_dict(),
                    venue_spec=space.venue_spec_json,
                    timeout_s=60,
                )
            )
        except (EngineError, OSError, RuntimeError, TimeoutError) as exc:  # optional aid; render without it
            logger.warning("Layout guide skipped for render %s: %s", render.id, exc)
        else:
            refs.append(pipeline_output(guide_result.path, work))
            prompt += f"\n{layout_clause(spec.to_dict())}"
    progress(runtime, job, 0.25, prompt)

    logs = []
    for index in range(2):
        edited = await engine.edit(
            EditRequest(
                prompt=prompt,
                input_image=original,
                ref_images=refs,
                out_path=work / f"edit-{index}.png",
                design_spec=spec.to_dict(),
                venue_spec=space.venue_spec_json,
            )
        )
        logs.append(edited.raw_log)
        processed = await invoke(
            clean_image, pipeline_output(edited.path, work), work / f"clean-{index}", None
        )
        score = await invoke(verify.structure_score, original, processed.path)
        aspect_matches = await invoke(verify.aspect_ok, original, processed.path)
        progress(runtime, job, 0.65 + index * 0.15)
        if score >= verify.STRUCTURE_OK and aspect_matches:
            break
    qa = {}
    if warnings:
        qa["rule_warnings"] = [warning.to_dict() for warning in warnings]
    if score < verify.STRUCTURE_OK or not aspect_matches:
        qa["structure_warning"] = "This render may have altered the room or changed the framing."
    if render.brain:
        try:
            brain = await invoke(pick_brain, render.brain)
            vision = await brain.complete_json(
                "Check an event-decor render. Return only the requested JSON.",
                "Count the visible tables and briefly describe their colors.",
                _QA_SCHEMA,
                images=[processed.path],
            )
            jsonschema.validate(vision, _QA_SCHEMA)
            qa.update(vision)
        except (BrainError, IntegrationError, jsonschema.ValidationError) as exc:
            qa["notes"] = f"Optional vision QA failed: {exc}"
    progress(runtime, job, 0.95)
    return Outcome(
        result={"render_id": render.id},
        render_image=processed,
        render_fields={
            "prompt": prompt,
            "path": f"venues/{venue.id}/renders/{render.id}{processed.path.suffix}",
            "structure_score": score,
            "qa_json": qa or None,
            "raw_log": "\n".join(logs),
        },
    )


async def _generate_base(runtime: Runtime, job: Job, work: Path) -> Outcome:
    assert job.space_id is not None
    with Session(runtime.engine) as session:
        space = session.get_one(Space, job.space_id)
    engine = await invoke(pick_engine, runtime.settings, job.payload_json["engine"], "can_generate")
    prompt = f"{prompts.build_base_prompt(space.venue_spec_json)}\n{_PHOTO_REAL}"
    if angle := job.payload_json.get("angle_hint"):
        prompt += f"\nApproximate alternative camera angle: {angle}."
    progress(runtime, job, 0.25)
    dest = work / "base.png"
    if space.references_json and engine.capabilities().can_edit:
        fetch = pipeline_module("fetch", "download_image", "FetchError")
        refs = []
        for index, data in enumerate(space.references_json[: 1 + engine.capabilities().max_refs]):
            reference = PhotoReference.model_validate(data)
            folder = work / f"ref-{index}"
            folder.mkdir()
            try:
                path = await invoke(fetch.download_image, reference.url, folder)
            except fetch.FetchError as exc:
                raise IntegrationError(502, f"Could not load a venue reference: {exc}") from exc
            refs.append((await invoke(clean_image, pipeline_output(path, folder), folder / "reference")).path)
        progress(runtime, job, 0.45)
        # TODO: Use GenerateRequest references when pipeline engines support them.
        generated = await engine.edit(
            EditRequest(
                prompt=f"{prompt}\nUse the input only as a reference for the room. Make a new, empty base view.",
                input_image=refs[0],
                ref_images=refs[1:],
                out_path=dest,
                venue_spec=space.venue_spec_json,
            )
        )
    else:
        if space.references_json:
            raise IntegrationError(422, "This engine cannot use venue photos as references")
        generated = await engine.generate(
            GenerateRequest(
                prompt=prompt,
                out_path=dest,
                venue_spec=space.venue_spec_json,
            )
        )
    image = await invoke(clean_image, pipeline_output(generated.path, work), work / "clean", None)
    key = new_id()
    photo = Photo(
        id=key,
        venue_id=space.venue_id,
        space_id=space.id,
        path=photo_path(space.venue_id, key, image),
        kind="generated_base",
        approved=False,
        width=image.width,
        height=image.height,
    )
    progress(runtime, job, 0.95)
    return Outcome({"photo_id": photo.id}, [(photo, image)])


async def _research(runtime: Runtime, job: Job) -> Outcome:
    module = pipeline_module("research", "research_venue")
    brain = await invoke(pick_brain, job.payload_json["brain"])
    require_web_brain(brain)
    progress(runtime, job, 0.25)
    try:
        research = await invoke(module.research_venue, job.payload_json["query"], brain)
    except TypeError as exc:
        if "unexpected keyword argument 'web'" not in str(exc):
            raise
        raise IntegrationError(
            501, f"The {brain.id} brain does not yet support web-enabled research"
        ) from exc
    jsonschema.validate(research, load_schema("venue-research"), format_checker=jsonschema.FormatChecker())
    progress(runtime, job, 0.95)
    return Outcome({"research": research})


async def _video(runtime: Runtime, job: Job, work: Path) -> Outcome:
    assert job.venue_id is not None
    module = pipeline_module("video", "ingest_video")
    brain_id = job.payload_json.get("brain")
    brain = await invoke(pick_brain, brain_id) if brain_id else None
    progress(runtime, job, 0.15)
    result = (
        await invoke(module.ingest_video, video_input(runtime, job), work, brain=brain, max_frames=12)
    ).to_dict()
    if result["duration_s"] > MAX_VIDEO_SECONDS:
        raise IntegrationError(422, "Venue tours must be at most five minutes long")
    if len(result["frames"]) > 12:
        raise IntegrationError(502, "The video pipeline returned more than 12 frames")
    progress(runtime, job, 0.65)

    photos = []
    frames = []
    for index, data in enumerate(result["frames"]):
        image = await invoke(clean_image, pipeline_output(data["path"], work), work / f"clean-{index}")
        key = new_id()
        photo = Photo(
            id=key,
            venue_id=job.venue_id,
            path=photo_path(job.venue_id, key, image),
            kind="video_frame",
            approved=False,
            width=image.width,
            height=image.height,
            video_job_id=job.id,
        )
        frames.append(FrameOut.model_validate({**data, "photo_id": key, "url": f"/files/{photo.path}"}))
        photos.append((photo, image))
    spaces = []
    for data in result["spaces_suggested"]:
        indexes = data["frame_indexes"]
        if any(type(index) is not int or not 0 <= index < len(frames) for index in indexes):
            raise IntegrationError(502, "The video pipeline returned an invalid frame index")
        spaces.append(
            VideoSpaceOut(
                name=data["name"],
                venue_spec=data["venue_spec"],
                photo_ids=[frames[i].photo_id for i in indexes],
            )
        )
    review = VideoResult(
        frames=frames,
        spaces_suggested=spaces,
        duration_s=result["duration_s"],
        warnings=result["warnings"],
    )
    progress(runtime, job, 0.95)
    return Outcome(review.model_dump(mode="json"), photos)


def _save(runtime: Runtime, job: Job, outcome: Outcome) -> None:
    root = runtime.settings.data_dir
    with publish() as published, completing(runtime, job) as (session, saved):
        if job.kind == "generate_base":
            existing = session.exec(select(Photo.id).where(Photo.space_id == job.space_id)).all()
            if len(existing) >= MAX_PHOTOS:
                raise IntegrationError(409, "A space can hold at most 30 photos")
        for photo, image in outcome.photos:
            publish_image(root, image.path, photo.path, published)
            session.add(photo)
        if outcome.render_image:
            assert job.render_id is not None
            render = session.get_one(Render, job.render_id)
            for key, value in outcome.render_fields.items():
                setattr(render, key, value)
            assert render.path is not None
            publish_image(root, outcome.render_image.path, render.path, published)
        saved.result_json = outcome.result


async def process(runtime: Runtime, job: Job) -> None:
    from .storage import InvalidMedia

    with staging(runtime.settings.data_dir) as work:
        try:
            if job.kind == "render":
                outcome = await _render(runtime, job, work)
            elif job.kind == "generate_base":
                outcome = await _generate_base(runtime, job, work)
            elif job.kind == "venue_research":
                outcome = await _research(runtime, job)
            elif job.kind == "video_ingest":
                outcome = await _video(runtime, job, work)
            else:
                raise IntegrationError(422, f"Unknown job kind: {job.kind}")
        except (EngineError, BrainError, InvalidMedia) as exc:
            raise IntegrationError(502, str(exc)) from exc
        _save(runtime, job, outcome)
