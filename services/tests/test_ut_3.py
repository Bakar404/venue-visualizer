import jsonschema
import pytest

from api.db import write_session
from api.models import ChatMessage
from pipeline.prompts import CHAT_RESPONSE_SCHEMA

from .test_api_flow import _json, _space, _venue


def test_chat_returns_and_persists_actionable_options(client):
    url = f"/api/spaces/{_space(client, _venue(client))['id']}/chat"
    response = _json(client.post(url, json={"message": "Add candles"}))
    [clarification] = response["ambiguities"]
    assert "candles" in clarification["question"]
    assert clarification["options"] == ["Live candles", "Flameless candles"]
    assert _json(client.get(url))[-1]["ambiguities"] == response["ambiguities"]
    edited = _json(client.post(url, json={"message": clarification["options"][1]}))
    assert edited["spec"]["centerpieces"]["candles"] == "flameless"


def test_brain_schema_requires_two_to_four_options():
    envelope = {
        "reply": "What kind of candles?",
        "spec_patch": {},
        "intent": "question",
        "look_name": None,
        "ambiguities": [{"question": "What kind of candles?", "options": ["Live", "Flameless"]}],
    }
    validator = jsonschema.Draft202012Validator(CHAT_RESPONSE_SCHEMA)
    validator.validate(envelope)
    # Too few options are repaired server-side (spec_ops._sanitise_cosmetics, see test_review_ut_backend R2);
    # the raw schema still rejects plain strings and more than four options.
    for ambiguous in ["What kind of candles?",
                      {"question": "Which?", "options": ["One", "Two", "Three", "Four", "Five"]}]:
        with pytest.raises(jsonschema.ValidationError):
            validator.validate({**envelope, "ambiguities": [ambiguous]})


def test_history_normalizes_legacy_string_ambiguities(client):
    space = _space(client, _venue(client))
    with write_session(client.app.state.runtime.engine) as session:
        session.add(ChatMessage(
            space_id=space["id"], role="assistant", content="One more detail.",
            chat_meta_json={"ambiguities": ["How many guests?"]},
        ))
    [message] = _json(client.get(f"/api/spaces/{space['id']}/chat"))
    assert message["ambiguities"] == [{"question": "How many guests?", "options": []}]
