import pytest
from PIL import Image, ImageEnhance

from pipeline.engines.base import ImageResult
from pipeline.engines.mock import MockEngine

from .test_api_flow import _json, _look, _render, _space, _upload, _venue

LIGHTING = "Lighting changed a lot, so we couldn't confirm the room matches; compare with the slider."
CHANGED = "This render may have changed the room's architecture."


def test_render_explains_when_relighting_prevents_verification(client, noise, monkeypatch):
    async def edit(self, request):
        with Image.open(request.input_image) as photo:
            ImageEnhance.Brightness(photo).enhance(0.05).save(request.out_path)
        return ImageResult(request.out_path, 768, 512, "mock", 0)

    monkeypatch.setattr(MockEngine, "edit", edit)
    space = _space(client, _venue(client))
    _upload(client, space, [noise])
    look = _look(client, space)
    batch = _render(client, look)
    [render] = _json(client.get(f"/api/looks/{look['id']}"))["renders"]
    qa = render["qa"]
    assert batch["renders"][0]["qa"] == qa
    assert qa["structure"]["method"] == "misaligned"
    assert qa["structure"]["reason"]
    assert qa["structure_message"] == {"level": "unverified", "text": LIGHTING}


@pytest.mark.parametrize(("report", "level", "text"), [
    ({"method": "misaligned", "score": 0.35, "brightness_delta": 0.40}, "unverified", LIGHTING),
    ({"method": "misaligned", "score": 0.35, "brightness_delta": 0.05}, "changed", CHANGED),
    ({"method": "aligned", "score": 0.60, "brightness_delta": 0.40}, "changed", CHANGED),
    ({"method": "aligned", "score": 0.85}, "ok", None),
    ({"method": "unverifiable", "score": 0.50}, "unverified", None),
])
def test_structure_message_distinguishes_changed_from_unverified(report, level, text):
    from api.qa_text import structure_message

    message = structure_message(report)
    assert message["level"] == level and message["text"]
    if text:
        assert message["text"] == text
