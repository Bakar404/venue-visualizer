"""Image engine interface. Every engine spawns an official tool or renders locally; no API keys."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

Size = Literal["auto", "1024x1024", "1536x1024", "1024x1536"]
Quality = Literal["auto", "low", "medium", "high"]


@dataclass
class EngineStatus:
    available: bool
    logged_in: bool | None = None
    version: str | None = None
    detail: str | None = None


@dataclass
class EngineCaps:
    can_generate: bool
    can_edit: bool
    photoreal: bool
    typical_seconds: int
    cost_note: str
    max_refs: int = 0
    sizes: tuple[str, ...] = ("1536x1024",)


@dataclass
class GenerateRequest:
    prompt: str
    out_path: Path
    size: Size = "1536x1024"
    quality: Quality = "high"
    timeout_s: int = 300
    design_spec: dict | None = None   # used by scene3d
    venue_spec: dict | None = None


@dataclass
class EditRequest:
    prompt: str
    input_image: Path
    out_path: Path
    ref_images: list[Path] = field(default_factory=list)
    size: Size = "auto"
    quality: Quality = "high"
    timeout_s: int = 300
    design_spec: dict | None = None
    venue_spec: dict | None = None


@dataclass
class ImageResult:
    path: Path
    width: int
    height: int
    engine: str
    seconds: float
    raw_log: str = ""


class EngineError(RuntimeError):
    pass


@runtime_checkable
class ImageEngine(Protocol):
    id: str
    label: str

    def detect(self) -> EngineStatus: ...          # must never raise
    def capabilities(self) -> EngineCaps: ...
    async def generate(self, req: GenerateRequest) -> ImageResult: ...
    async def edit(self, req: EditRequest) -> ImageResult: ...
