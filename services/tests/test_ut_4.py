import pytest

from pipeline import prompts, rules
from pipeline.brains.mock import MockBrain
from pipeline.models import VenueRules, default_spec
from pipeline.spec_ops import chat_to_spec, validate_spec


@pytest.mark.parametrize("message", [
    "Make it 7pm", "Make it dark outside", "Make it night", "I mean it's not daylight outside",
    "Make it after sunset",
])
async def test_night_chat_changes_the_outside_and_the_render_prompt(message):
    result = await chat_to_spec(MockBrain(), message, default_spec())
    assert result.spec.to_dict()["scene"] == {"time_of_day": "night", "windows": "dark"}
    fixed, _ = rules.check(result.spec, VenueRules(live_candles=False))
    assert fixed.scene == result.spec.scene
    prompt = prompts.build_edit_prompt(fixed).lower()
    assert (
        "photographed at night: windows are dark with no daylight; interior lit by the event lighting"
        in prompt
    )


@pytest.mark.parametrize("message", ["Make it golden hour", "Show the room at sunset"])
async def test_sunset_maps_to_golden_hour(message):
    result = await chat_to_spec(MockBrain(), message, default_spec())
    assert result.spec.to_dict()["scene"] == {"time_of_day": "golden_hour", "windows": "as_photographed"}
    assert "golden hour" in prompts.build_edit_prompt(result.spec)


def test_scene_is_optional_and_defaults_when_present():
    spec = default_spec().to_dict()
    assert "scene" not in spec
    scene = validate_spec({**spec, "scene": {}}).to_dict()["scene"]
    assert scene == {"time_of_day": "daylight", "windows": "as_photographed"}
    draped = validate_spec({**spec, "scene": {"time_of_day": "evening", "windows": "sheer_draped"}})
    assert "sheer drapes" in prompts.build_edit_prompt(draped)
