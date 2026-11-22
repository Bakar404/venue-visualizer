from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    AnyHttpUrl,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    WrapSerializer,
)

from pipeline.models import DesignSpec, RuleWarning, VenueRules, VenueSpec

from .models import JobKind, JobStatus, PhotoKind

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8_000)]
UtcTime = Annotated[
    datetime,
    BeforeValidator(
        lambda dt: dt.replace(tzinfo=UTC) if (isinstance(dt, datetime) and dt.tzinfo is None) else dt
    ),
]


def _http_url(value: str) -> str:
    parsed = TypeAdapter(AnyHttpUrl).validate_python(value)
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("URLs must not contain credentials")
    return value


def sparse_rules(rules: VenueRules) -> dict:
    return rules.model_dump(mode="json", exclude_unset=True, exclude_none=True)


def _pipeline_json(value, _handler):
    return value.to_dict()


HttpUrl = Annotated[str, StringConstraints(max_length=8192), AfterValidator(_http_url)]
SpecJSON = Annotated[DesignSpec, WrapSerializer(_pipeline_json, when_used="json")]
RoomJSON = Annotated[VenueSpec, WrapSerializer(_pipeline_json, when_used="json")]
RulesJSON = Annotated[VenueRules, WrapSerializer(lambda value, _: sparse_rules(value), when_used="json")]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VenueCreate(Input):
    name: Name
    rules: VenueRules = Field(default_factory=VenueRules)


class VenuePatch(Input):
    name: Name | None = None
    rules: VenueRules | None = None


class SpaceCreate(Input):
    name: Name
    venue_spec: VenueSpec = Field(default_factory=VenueSpec)


class SpacePatch(Input):
    name: Name | None = None
    venue_spec: VenueSpec | None = None
    current_spec: DesignSpec | None = None


class PhotoReference(BaseModel):
    url: HttpUrl
    source_page: HttpUrl
    caption: str | None = None
    credit: str | None = None


class PhotoOut(BaseModel):
    id: str
    space_id: str | None
    url: str
    kind: PhotoKind
    source_url: str | None
    source_page: str | None
    credit: str | None
    approved: bool
    width: int
    height: int


class SpaceOut(BaseModel):
    id: str
    venue_id: str
    name: str
    venue_spec: RoomJSON
    photos: list[PhotoOut]
    current_spec: SpecJSON | None
    references: list[PhotoReference]
    capacity_seated: int | None
    capacity_standing: int | None
    source: str | None


class VenueOut(BaseModel):
    id: str
    name: str
    rules: RulesJSON
    created_at: UtcTime
    spaces: list[SpaceOut]


class GenerateBase(Input):
    engine: Name | None = None
    angle_hint: Name | None = None


class ChatIn(Input):
    message: Text
    spec: DesignSpec | None = None
    brain: Name | None = None


class SpecCheckResult(BaseModel):
    spec: SpecJSON
    warnings: list[RuleWarning]


class ChatOut(SpecCheckResult):
    reply: str
    rule_notes: list[str]
    ambiguities: list[str]
    brain: str


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: UtcTime


class SpecCheck(Input):
    spec: DesignSpec
    venue_id: UUID


class LookCreate(Input):
    name: Name
    spec: DesignSpec
    parent_look_id: UUID | None = None


class RenderQA(BaseModel):
    tables_seen: int | None = None
    notes: str | None = None
    structure_warning: str | None = None
    rule_warnings: list[RuleWarning] = Field(default_factory=list)


class RenderOut(BaseModel):
    id: str
    look_id: str
    photo_id: str
    engine: str
    status: JobStatus
    url: str | None
    prompt: str
    structure_score: float | None
    qa: RenderQA | None
    error: str | None
    created_at: UtcTime


class LookOut(BaseModel):
    id: str
    space_id: str
    name: str
    spec: SpecJSON
    parent_look_id: str | None
    created_at: UtcTime
    warnings: list[RuleWarning]
    renders: list[RenderOut]


class Regenerate(Input):
    engine: Name | None = None


class RenderIn(Regenerate):
    photo_ids: Annotated[list[UUID], Field(min_length=1, max_length=30)] | None = None
    brain_qa: bool = False
    brain: Name | None = None


class FrameOut(BaseModel):
    photo_id: str
    url: str
    t: float
    sharpness: float
    exposure_ok: bool
    space_guess: str | None = None
    view: str | None = None
    description: str | None = None
    fixtures: list[str] = Field(default_factory=list)
    usable: bool


class VideoSpaceOut(BaseModel):
    name: Name
    venue_spec: RoomJSON
    photo_ids: list[str]


class VideoResult(BaseModel):
    frames: list[FrameOut]
    spaces_suggested: list[VideoSpaceOut]
    duration_s: float
    warnings: list[str]
    applied: bool = False


class ResearchResult(BaseModel):
    research: dict


class RenderResult(BaseModel):
    render_id: str


class BaseResult(BaseModel):
    photo_id: str


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: JobKind
    status: JobStatus
    progress: float
    cancel_requested: bool
    error: str | None
    error_status: int | None
    result: RenderResult | BaseResult | ResearchResult | VideoResult | None = Field(
        validation_alias="result_json"
    )


class RenderBatch(BaseModel):
    jobs: list[JobOut]
    renders: list[RenderOut]


class ResearchIn(Input):
    query: Name
    brain: Name | None = None


RuleKey = Literal["live_candles", "fog", "confetti", "sparklers", "adhesives", "nails", "ceiling_draping"]


class PhotoSelection(Input):
    url: HttpUrl
    mode: Literal["reference", "import"] = "reference"
    rights_confirmed: bool = False


class VenueImport(Input):
    research_job_id: UUID
    match_index: int = Field(ge=0)
    space_names: list[Name] = Field(max_length=100)
    accepted_rules: list[RuleKey] = Field(default_factory=list, max_length=7)
    accepted_provided_items: list[str] = Field(default_factory=list)
    photos: list[PhotoSelection] = Field(default_factory=list, max_length=1200)


class SuggestedRule(BaseModel):
    key: RuleKey | None = None
    allowed: bool | None = None
    text: str
    source: HttpUrl


class SuggestedVenueSpec(VenueSpec):
    model_config = ConfigDict(extra="ignore")


class SuggestedSpace(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: Name
    venue_spec: SuggestedVenueSpec = Field(default_factory=SuggestedVenueSpec)
    photos: list[PhotoReference] = Field(default_factory=list)
    capacity_seated: int | None = None
    capacity_standing: int | None = None
    source: HttpUrl | None = None


class ImportPreview(BaseModel):
    venue_name: Name
    rules_suggested: list[SuggestedRule]
    spaces: list[SuggestedSpace]
    provided_items: list[str]


class VideoSpaceIn(SpaceCreate):
    photo_ids: list[UUID] = Field(max_length=30)


class VideoApply(Input):
    job_id: UUID
    spaces: list[VideoSpaceIn] = Field(max_length=12)


class BackendCaps(BaseModel):
    can_generate: bool
    can_edit: bool
    typical_seconds: int
    cost_note: str
    photoreal: bool


class BackendStatus(BaseModel):
    id: str
    label: str
    kind: Literal["brain", "engine"]
    available: bool
    logged_in: bool | None
    version: str | None
    detail: str | None
    caps: BackendCaps | None = None


class BackendDefaults(BaseModel):
    brain: str | None
    engine: str | None


class BackendsOut(BaseModel):
    brains: list[BackendStatus]
    engines: list[BackendStatus]
    defaults: BackendDefaults
    internal: dict[str, BackendStatus] = {}
