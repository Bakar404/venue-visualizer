from __future__ import annotations

import copy

import pytest

from pipeline.brains.mock import canned_research
from pipeline.models import VenueSpec
from pipeline.research import (
    ResearchError,
    research_to_import_preview,
    research_venue,
    validation_errors,
)


class FakeBrain:
    id = "fake"

    def __init__(self, *answers: dict):
        self.answers = list(answers)
        self.calls: list[dict] = []

    async def complete_json(self, system, user, schema, images=None, timeout_s=180, *, web=False):
        self.calls.append({"system": system, "user": user, "web": web, "timeout_s": timeout_s})
        return copy.deepcopy(self.answers.pop(0))


def _research() -> dict:
    r = canned_research("Harbor Hall, Boston")
    space = r["matches"][0]["spaces"][0]
    space["ceiling_ft"] = 400  # outside VenueSpec bounds: must be dropped, not clamped
    r["matches"][0]["rules_found"].append(
        {"text": "Music must end by 11pm.", "maps_to": None, "allowed": None, "source": "https://example.com/faq"})
    return r


async def test_research_uses_web_and_maps_to_preview():
    brain = FakeBrain(_research())
    research = await research_venue("Harbor Hall, Boston", brain)
    assert len(brain.calls) == 1 and brain.calls[0]["web"] is True and brain.calls[0]["timeout_s"] == 420
    assert "Harbor Hall, Boston" in brain.calls[0]["user"]
    assert "source" in brain.calls[0]["system"].lower()

    preview = research_to_import_preview(research, 0)
    assert preview["venue_name"] == "Harbor Hall"
    assert preview["rules_suggested"] == [
        {"key": "live_candles", "allowed": False, "text": "Open flames are not permitted; flameless candles only.",
         "source": "https://example.com/venue/policies"},
        {"key": None, "allowed": None, "text": "Music must end by 11pm.", "source": "https://example.com/faq"},
    ]
    [space] = preview["spaces"]
    assert space["name"] == "Grand Ballroom"
    spec = VenueSpec.model_validate(space["venue_spec"])
    assert spec.length_ft == 90 and spec.width_ft == 60 and spec.ceiling_ft is None
    assert spec.style == "classic ballroom" and spec.fixtures == ["crystal chandeliers"]
    assert "200 seated" in spec.notes and "ceiling_ft=400" in spec.notes
    assert space["photos"][0]["url"] == "https://example.com/venue/ballroom.jpg"
    assert space["photos"][0]["source_page"] == "https://example.com/venue/spaces"
    assert preview["provided_items"] == ["60-inch round tables", "chiavari chairs"]
    with pytest.raises(IndexError):
        research_to_import_preview(research, 1)


async def test_invalid_then_valid_retries_once_with_errors():
    bad = _research()
    del bad["matches"][0]["spaces"][0]["photos"][0]["source_page"]
    bad["matches"][0]["sources"] = ["not a url"]
    assert validation_errors(bad)
    brain = FakeBrain(bad, _research())
    research = await research_venue("Harbor Hall", brain)
    assert len(brain.calls) == 2 and all(c["web"] for c in brain.calls)
    assert "failed validation" in brain.calls[1]["user"] and "source_page" in brain.calls[1]["user"]
    assert not validation_errors(research)


async def test_still_invalid_after_retry_raises():
    bad = {"query": "x", "matches": "nope"}
    with pytest.raises(ResearchError):
        await research_venue("x", FakeBrain(bad, bad))
