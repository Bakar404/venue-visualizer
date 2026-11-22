"""Brain interface: an LLM reached through a subscription CLI. Returns schema-valid JSON."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable


@dataclass
class BrainStatus:
    available: bool
    logged_in: bool | None = None
    version: str | None = None
    detail: str | None = None


class BrainError(RuntimeError):
    pass


@runtime_checkable
class Brain(Protocol):
    id: str
    label: str

    def detect(self) -> BrainStatus: ...           # must never raise
    async def complete_json(
        self, system: str, user: str, schema: dict, images: list[Path] | None = None, timeout_s: int = 180
    ) -> dict: ...
