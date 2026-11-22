"""Pydantic v2 models mirroring `packages/schema/*.schema.json` (the JSON Schema is the source of truth).

Hand-written to match the schemas exactly; `python -m pipeline.schema_gen` checks them for drift.
Serialize with `.to_dict()`: optional keys that are null/absent are omitted (absent == null, which is
also what an RFC 7396 merge patch `null` produces).
"""
from __future__ import annotations

import json
import os
from functools import cache
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from typing_extensions import TypedDict

EventType = Literal["wedding", "corporate", "birthday", "gala", "shower", "other"]
TableShape = Literal["round", "banquet", "square", "oval", "cocktail", "mixed"]
LinenLength = Literal["floor", "lap", "none"]
CenterpieceHeight = Literal["none", "low", "medium", "tall", "mixed"]
Candles = Literal["none", "flameless", "live"]
Ambient = Literal["daylight", "evening_warm", "dim", "colored"]
ChatIntent = Literal["edit", "render", "question", "none"]


class Ambiguity(TypedDict):
    question: str
    options: list[str]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True)


class Tables(_Model):
    count: Annotated[int, Field(ge=0, le=300)]
    shape: TableShape
    size_in: Annotated[int, Field(ge=24, le=120)] | None = None
    seats: Annotated[int, Field(ge=1, le=24)] | None = None


class Linens(_Model):
    color: str
    pattern: str | None = None
    length: LinenLength = "floor"
    runner: str | None = None


class Napkins(_Model):
    color: str | None = None
    fold: str | None = None


class Chairs(_Model):
    style: str
    color: str
    cushion: str | None = None
    sash: str | None = None


class Centerpieces(_Model):
    height: CenterpieceHeight
    flowers: list[str] | None = None
    colors: list[str] | None = None
    greenery: str | None = None
    container: str | None = None
    candles: Candles = "none"


class Lighting(_Model):
    uplighting: str | None = None
    pin_spots: bool = False
    string_lights: bool = False
    ambient: Ambient = "evening_warm"


class Scene(_Model):
    time_of_day: Literal["daylight", "golden_hour", "evening", "night"] = "daylight"
    windows: Literal["as_photographed", "dark", "sheer_draped"] = "as_photographed"


class Effects(_Model):
    fog: bool = False
    confetti: bool = False
    sparklers: bool = False


class Install(_Model):
    uses_adhesives: bool = False
    uses_nails: bool = False
    ceiling_draping: bool = False


class DesignSpec(_Model):
    version: Literal[1] = 1
    space: str
    event_type: EventType = "wedding"
    guest_count: Annotated[int, Field(ge=1, le=2000)] | None = None
    palette: Annotated[list[str], Field(max_length=8)]
    tables: Tables
    linens: Linens
    napkins: Napkins | None = None
    chairs: Chairs
    centerpieces: Centerpieces
    lighting: Lighting
    extras: list[str]
    effects: Effects = Field(default_factory=Effects)
    install: Install = Field(default_factory=Install)
    notes: Annotated[str, Field(max_length=2000)] | None = None
    scene: Scene | None = None


class VenueRules(_Model):
    live_candles: bool = True
    fog: bool = True
    confetti: bool = True
    sparklers: bool = True
    adhesives: bool = True
    nails: bool = True
    ceiling_draping: bool = True
    provided_items: list[str] | None = None
    notes: str | None = None


class VenueSpec(_Model):
    style: str | None = None
    length_ft: Annotated[float, Field(ge=5, le=1000)] | None = None
    width_ft: Annotated[float, Field(ge=5, le=1000)] | None = None
    ceiling_ft: Annotated[float, Field(ge=6, le=120)] | None = None
    walls: str | None = None
    floor: str | None = None
    windows: str | None = None
    fixtures: list[str] | None = None
    notes: str | None = None


class RuleWarning(_Model):
    rule: str
    field: str
    message: str
    fix: str | None = None


# --- schema files ---------------------------------------------------------------------------------

_SCHEMA_ALIASES = {
    "design-spec": "design-spec.schema.json",
    "designspec": "design-spec.schema.json",
    "venue": "venue.schema.json",
}


def schema_dir() -> Path:
    """`packages/schema/` resolved relative to the repo root (override with VV_SCHEMA_DIR)."""
    env = os.environ.get("VV_SCHEMA_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "packages" / "schema"
        if (candidate / "design-spec.schema.json").is_file():
            return candidate
    return here.parents[2] / "packages" / "schema"


@cache
def _load_schema_cached(path: str) -> str:
    return Path(path).read_text()


def load_schema(name: str) -> dict:
    """Load a schema by name: 'design-spec', 'venue', or a file name like 'venue.schema.json'."""
    key = name.lower().removesuffix(".json").removesuffix(".schema")
    filename = _SCHEMA_ALIASES.get(key, name if name.endswith(".json") else f"{name}.schema.json")
    return json.loads(_load_schema_cached(str(schema_dir() / filename)))


def venue_def_schema(def_name: str) -> dict:
    """A standalone schema for one of venue.schema.json's $defs (VenueRules, VenueSpec, RuleWarning)."""
    doc = load_schema("venue")
    if def_name not in doc.get("$defs", {}):
        raise KeyError(def_name)
    return {**doc, "$ref": f"#/$defs/{def_name}"}


# --- defaults -------------------------------------------------------------------------------------


def default_spec(space: str = "main") -> DesignSpec:
    """Sensible starting point: round 60" tables of 8, ivory floor-length linens, gold chiavari chairs,
    low centerpieces, warm uplighting, no candles."""
    return DesignSpec(
        space=space,
        event_type="wedding",
        palette=["ivory", "gold", "sage green"],
        tables=Tables(count=10, shape="round", size_in=60, seats=8),
        linens=Linens(color="ivory", length="floor"),
        napkins=Napkins(color="ivory"),
        chairs=Chairs(style="chiavari", color="gold"),
        centerpieces=Centerpieces(
            height="low", flowers=["roses"], colors=["ivory"], greenery="eucalyptus", candles="none"
        ),
        lighting=Lighting(uplighting="warm amber", ambient="evening_warm"),
        extras=[],
        effects=Effects(),
        install=Install(),
    )
