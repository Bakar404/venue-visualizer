from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from sqlalchemy import JSON, CheckConstraint, Column, DateTime, Index, String
from sqlmodel import Field, SQLModel

JobKind = Literal["render", "generate_base", "venue_research", "video_ingest"]
JobStatus = Literal["queued", "running", "done", "failed", "cancelled"]
PhotoKind = Literal["upload", "generated_base", "video_frame", "web"]


def new_id() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class SchemaVersion(SQLModel, table=True):
    __tablename__ = "schema_version"

    version: int = Field(primary_key=True)


class Settings(SQLModel, table=True):
    __table_args__ = (CheckConstraint("id = 1"),)

    id: int = Field(default=1, primary_key=True)
    values_json: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    lan_signing_key: str


class LanDevice(SQLModel, table=True):
    token_hash: str = Field(primary_key=True)
    id: str = Field(default_factory=lambda: uuid4().hex, index=True, unique=True)
    label: str = "Unknown device"
    paired_at: int = 0
    last_seen: int = 0
    expires_at: int


class Venue(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    rules_json: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=now, sa_type=DateTime)


class Space(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    venue_id: str = Field(foreign_key="venue.id", ondelete="CASCADE", index=True)
    name: str
    venue_spec_json: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    dimensions_json: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    current_spec_json: dict | None = Field(default=None, sa_column=Column(JSON))
    references_json: list[dict] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    capacity_seated: int | None = None
    capacity_standing: int | None = None
    source: str | None = None


class Photo(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    venue_id: str = Field(foreign_key="venue.id", ondelete="CASCADE", index=True)
    space_id: str | None = Field(default=None, foreign_key="space.id", ondelete="CASCADE", index=True)
    path: str
    kind: PhotoKind = Field(sa_type=String)
    source_url: str | None = None
    source_page: str | None = None
    credit: str | None = None
    approved: bool
    width: int
    height: int
    video_job_id: str | None = Field(default=None, index=True)


class Look(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    space_id: str = Field(foreign_key="space.id", ondelete="CASCADE", index=True)
    name: str
    design_spec_json: dict = Field(sa_column=Column(JSON, nullable=False))
    warnings_json: list[dict] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    parent_look_id: str | None = Field(default=None, foreign_key="look.id", ondelete="SET NULL")
    created_at: datetime = Field(default_factory=now, sa_type=DateTime)


class Render(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    look_id: str = Field(foreign_key="look.id", ondelete="CASCADE", index=True)
    photo_id: str = Field(foreign_key="photo.id", ondelete="CASCADE", index=True)
    engine: str
    brain: str | None = None
    status: JobStatus = Field(default="queued", sa_type=String)
    path: str | None = None
    prompt: str = ""
    structure_score: float | None = None
    qa_json: dict | None = Field(default=None, sa_column=Column(JSON))
    error: str | None = None
    raw_log: str | None = None
    created_at: datetime = Field(default_factory=now, sa_type=DateTime)


class Job(SQLModel, table=True):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_claim", "status", "created_at"),
        Index("ix_jobs_concurrency", "status", "queue_key"),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    kind: JobKind = Field(sa_type=String)
    queue_key: str
    venue_id: str | None = Field(default=None, foreign_key="venue.id", ondelete="CASCADE", index=True)
    space_id: str | None = Field(default=None, foreign_key="space.id", ondelete="CASCADE", index=True)
    render_id: str | None = Field(default=None, foreign_key="render.id", ondelete="CASCADE", index=True)
    payload_json: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    result_json: dict | None = Field(default=None, sa_column=Column(JSON))
    status: JobStatus = Field(default="queued", sa_type=String)
    progress: float = 0
    attempts: int = 0
    error: str | None = None
    error_status: int | None = None
    cancel_requested: bool = False
    created_at: datetime = Field(default_factory=now, sa_type=DateTime)
    started_at: datetime | None = Field(default=None, sa_type=DateTime)
    finished_at: datetime | None = Field(default=None, sa_type=DateTime)
    lease_id: str | None = None
    heartbeat_at: datetime | None = Field(default=None, sa_type=DateTime)


class ChatMessage(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    space_id: str = Field(foreign_key="space.id", ondelete="CASCADE", index=True)
    role: Literal["user", "assistant"] = Field(sa_type=String)
    content: str
    spec_patch_json: dict | None = Field(default=None, sa_column=Column(JSON))
    spec_after_json: dict | None = Field(default=None, sa_column=Column(JSON))
    warnings_json: list[dict] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    chat_meta_json: dict | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=now, sa_type=DateTime)
