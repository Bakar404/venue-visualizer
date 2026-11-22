from dataclasses import dataclass
from typing import Annotated, TypeVar

from fastapi import Depends, HTTPException, Request
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, select

from .config import Settings
from .contracts import LookOut, PhotoOut, RenderOut, SpaceOut, VenueOut
from .models import Look, Photo, Render, Space, Venue

Model = TypeVar("Model", bound=SQLModel)


@dataclass(frozen=True)
class Runtime:
    settings: Settings
    engine: Engine


def runtime(request: Request) -> Runtime:
    return request.app.state.runtime


RuntimeDep = Annotated[Runtime, Depends(runtime)]


def require(session: Session, model: type[Model], key: str) -> Model:
    instance = session.get(model, key)
    if instance is None:
        raise HTTPException(404, f"{model.__name__} not found")
    return instance


def new_space(venue_id: str, name: str, spec: dict) -> Space:
    space = Space(venue_id=venue_id, name=name)
    set_room(space, spec)
    return space


def set_room(space: Space, spec: dict) -> None:
    space.venue_spec_json = spec
    space.dimensions_json = {key: spec[key] for key in ("length_ft", "width_ft", "ceiling_ft") if key in spec}


def photo_out(photo: Photo) -> PhotoOut:
    return PhotoOut.model_validate({**photo.model_dump(), "url": f"/files/{photo.path}"})


def space_out(session: Session, space: Space) -> SpaceOut:
    photos = session.exec(select(Photo).where(Photo.space_id == space.id).order_by(Photo.id)).all()
    return SpaceOut(
        id=space.id,
        venue_id=space.venue_id,
        name=space.name,
        venue_spec=space.venue_spec_json,
        photos=[photo_out(photo) for photo in photos],
        current_spec=space.current_spec_json,
        references=space.references_json,
    )


def venue_out(session: Session, venue: Venue) -> VenueOut:
    spaces = session.exec(
        select(Space).where(Space.venue_id == venue.id).order_by(Space.name, Space.id)
    ).all()
    return VenueOut(
        id=venue.id,
        name=venue.name,
        rules=venue.rules_json,
        created_at=venue.created_at,
        spaces=[space_out(session, space) for space in spaces],
    )


def render_out(render: Render) -> RenderOut:
    return RenderOut.model_validate(
        {
            **render.model_dump(),
            "url": f"/files/{render.path}" if render.path else None,
            "qa": render.qa_json,
        }
    )


def look_out(session: Session, look: Look) -> LookOut:
    renders = session.exec(
        select(Render).where(Render.look_id == look.id).order_by(Render.created_at, Render.id)
    ).all()
    return LookOut(
        id=look.id,
        space_id=look.space_id,
        name=look.name,
        spec=look.design_spec_json,
        parent_look_id=look.parent_look_id,
        created_at=look.created_at,
        warnings=look.warnings_json,
        renders=[render_out(render) for render in renders],
    )
