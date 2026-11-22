"""Regression tests for the cross-family review of the user-test backend changes (R1–R5).
Written before the fixes; red/green output is saved in docs/proof/R*-red.txt / R*-green.txt."""
import pytest

from api.contracts import StructureReport
from api.qa_text import structure_message
from pipeline.brains.codex import strictify
from pipeline.models import default_spec
from pipeline.prompts import CHAT_RESPONSE_SCHEMA, build_edit_prompt
from pipeline.spec_ops import apply_merge_patch, chat_to_spec, validate_spec


# R1: renders saved by the older structure check (methods edges/gray/flat) must still load.
@pytest.mark.parametrize("method", ["edges", "gray", "flat"])
def test_r1_legacy_structure_methods_still_validate(method):
    report = StructureReport.model_validate(
        {"score": 0.53, "method": method, "aligned": False, "inliers": 0, "scale": None, "rotation": None,
         "coverage": None}
    )
    assert structure_message(report.model_dump())["level"] == "unverified"


class _Brain:
    id = "fake"
    label = "fake"

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0

    def detect(self):  # pragma: no cover
        return None

    async def complete_json(self, system, user, schema, images=None, timeout_s=180, web=False):
        self.calls += 1
        return self.replies.pop(0)


# R2: a too-long look_name or a one-option ambiguity must not throw away the user's edit.
async def test_r2_cosmetic_fields_are_sanitised_not_fatal():
    reply = {
        "reply": "Made it moody.",
        "spec_patch": {"palette": ["burgundy", "plum", "blue"]},
        "intent": "edit",
        "look_name": "Moody night, burgundy linens & blue uplighting with plum florals",
        "ambiguities": [{"question": "Tall or low?", "options": ["Tall"]},
                        {"question": "Runner?", "options": ["Velvet", "None", "Linen", "Silk", "Lace"]}],
    }
    brain = _Brain([reply])
    result = await chat_to_spec(brain, "make it moody", None)
    assert brain.calls == 1
    assert result.spec.palette == ["burgundy", "plum", "blue"]
    assert result.look_name and len(result.look_name) <= 40
    by_q = {a["question"]: a["options"] for a in result.ambiguities}
    assert by_q["Tall or low?"] == []  # too few options -> shown as a question without chips
    assert len(by_q["Runner?"]) == 4


# R3: Codex strict structured outputs: length/count keywords must not reach the CLI schema.
def test_r3_strictify_drops_length_and_count_keywords():
    strict, _ = strictify(CHAT_RESPONSE_SCHEMA)
    text = repr(strict)
    for kw in ("minLength", "maxLength", "minItems", "maxItems", "pattern"):
        assert kw not in text


# R4: "add sheer drapes" must not force daylight into the prompt.
def test_r4_windows_only_patch_does_not_force_daylight():
    spec = validate_spec(apply_merge_patch(default_spec("ballroom").to_dict(), {"scene": {"windows": "sheer_draped"}}))
    prompt = build_edit_prompt(spec)
    assert "sheer" in prompt.lower()
    assert "daylight" not in prompt.lower()


# R5: generating a base from a reference needs an engine that accepts reference images.
def test_r5_generate_base_with_reference_requires_ref_capable_engine(client, monkeypatch):
    from api import studio

    venue = client.post("/api/venues", json={"name": "Ref venue"}).json()
    space = client.post(f"/api/venues/{venue['id']}/spaces", json={"name": "Hall"}).json()
    url = "https://example.com/hall.jpg"
    monkeypatch.setattr(studio, "_require_reference", lambda space, ref: None)
    resp = client.post(f"/api/spaces/{space['id']}/generate-base", json={"engine": "mock", "reference_url": url})
    assert resp.status_code == 422
    assert "reference" in resp.json()["detail"].lower()
