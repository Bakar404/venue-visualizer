from __future__ import annotations

import pytest

from pipeline.brains.base import BrainError
from pipeline.brains.mock import MockBrain
from pipeline.models import VenueRules, default_spec
from pipeline.spec_ops import SpecValidationError, apply_merge_patch, chat_to_spec, validate_spec

EXAMPLE = ("12 round tables of 8, ivory linens, gold chairs, low ivory and blush centerpieces with greenery, "
           "warm amber uplighting, flameless candles")


def test_merge_patch_rfc7396():
    target = {"a": "b", "c": {"d": "e", "f": "g"}, "list": [1, 2]}
    patch = {"a": "z", "c": {"f": None, "h": 1}, "list": [3], "new": {"x": None, "y": 2}}
    out = apply_merge_patch(target, patch)
    assert out == {"a": "z", "c": {"d": "e", "h": 1}, "list": [3], "new": {"y": 2}}
    assert target == {"a": "b", "c": {"d": "e", "f": "g"}, "list": [1, 2]}  # not mutated
    assert apply_merge_patch({"a": 1}, ["x"]) == ["x"]
    assert apply_merge_patch({"a": {"b": 1}}, {"a": "s"}) == {"a": "s"}


def test_validate_spec():
    assert validate_spec(default_spec().to_dict()).tables.seats == 8
    bad = default_spec().to_dict()
    bad["tables"]["shape"] = "hexagon"
    with pytest.raises(SpecValidationError, match="/tables/shape"):
        validate_spec(bad)
    with pytest.raises(SpecValidationError):
        validate_spec({**default_spec().to_dict(), "unknown": 1})


class FlakyBrain:
    id = "flaky"
    label = "Flaky"

    def __init__(self):
        self.calls: list[str] = []

    async def complete_json(self, system, user, schema, images=None, timeout_s=180):
        self.calls.append(user)
        if len(self.calls) == 1:
            return {"reply": "oops", "spec_patch": {"tables": {"shape": "hexagon"}}, "ambiguities": []}
        return {"reply": "Fixed", "spec_patch": {"tables": {"shape": "banquet", "count": 6}},
                "ambiguities": ["Head table?"]}


async def test_chat_retries_once_on_invalid_patch():
    brain = FlakyBrain()
    result = await chat_to_spec(brain, "long tables please", None, None, None)
    assert len(brain.calls) == 2 and result.attempts == 2
    assert "/tables/shape" in brain.calls[1]
    assert result.spec.tables.shape == "banquet" and result.spec.tables.count == 6
    assert result.reply == "Fixed" and result.ambiguities == ["Head table?"]


async def test_chat_gives_up_after_second_invalid_patch():
    class AlwaysBad(FlakyBrain):
        async def complete_json(self, system, user, schema, images=None, timeout_s=180):
            self.calls.append(user)
            return {"reply": "", "spec_patch": {"guest_count": -5}, "ambiguities": []}

    brain = AlwaysBad()
    with pytest.raises(BrainError):
        await chat_to_spec(brain, "x", default_spec(), None, None)
    assert len(brain.calls) == 2


async def test_chat_with_mock_brain_applies_rules_and_capacity():
    result = await chat_to_spec(MockBrain(), "150 guests, real taper candles, a dance floor", default_spec(),
                                None, VenueRules(live_candles=False))
    assert result.spec.centerpieces.candles == "flameless"
    assert result.spec.guest_count == 150
    rules = {w.rule for w in result.warnings}
    assert {"live_candles", "capacity"} <= rules
    assert "dance floor" in result.spec.extras


async def test_mock_brain_parses_example_message():
    result = await chat_to_spec(MockBrain(), EXAMPLE, default_spec(), None, None)
    s = result.spec
    assert (s.tables.count, s.tables.shape, s.tables.seats) == (12, "round", 8)
    assert s.linens.color == "ivory"
    assert s.chairs.color == "gold" and s.chairs.style == "chiavari"
    assert s.centerpieces.height == "low"
    assert s.centerpieces.colors == ["ivory", "blush"]
    assert s.centerpieces.greenery
    assert s.centerpieces.candles == "flameless"
    assert s.lighting.uplighting == "warm amber"
    assert s.palette == ["ivory", "gold", "blush"]
    assert result.warnings == []
