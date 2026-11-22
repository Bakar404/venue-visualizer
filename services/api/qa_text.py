from collections.abc import Mapping
from typing import Literal

from typing_extensions import TypedDict

from pipeline.verify import STRUCTURE_OK

LARGE_BRIGHTNESS_CHANGE = 0.20  # fraction of the full 8-bit brightness range


class StructureMessage(TypedDict):
    level: Literal["ok", "unverified", "changed"]
    text: str


def structure_message(report: Mapping[str, object]) -> StructureMessage:
    method = report["method"]
    delta = report.get("brightness_delta")
    if method == "misaligned" and isinstance(delta, (int, float)) and delta >= LARGE_BRIGHTNESS_CHANGE:
        return {
            "level": "unverified",
            "text": "Lighting changed a lot, so we couldn't confirm the room matches; compare with the slider.",
        }
    if method == "unverifiable":
        return {
            "level": "unverified",
            "text": "We couldn't confirm the room matches; compare with the slider.",
        }
    score = report["score"]
    if method == "aligned" and isinstance(score, (int, float)) and score >= STRUCTURE_OK:
        return {"level": "ok", "text": "The room's architecture appears unchanged."}
    return {"level": "changed", "text": "This render may have changed the room's architecture."}
