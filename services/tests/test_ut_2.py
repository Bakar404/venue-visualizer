import pytest

from pipeline.models import default_spec

from .test_api_flow import _json, _space, _venue


@pytest.mark.parametrize("message", [
    "Show me how it looks", "Render a new photo", "I want to see it", "I don't see new photos",
])
def test_chat_offers_render_without_changing_the_plan(client, message):
    url = f"/api/spaces/{_space(client, _venue(client))['id']}/chat"
    spec = default_spec("Ballroom").to_dict()
    response = _json(client.post(url, json={"message": message, "spec": spec}))
    assert response["intent"] == "render"
    assert response["spec_changed"] is False
    assert response["spec"] == spec
    assert "couldn't find" not in response["reply"]
    assert _json(client.get(url))[-1]["intent"] == "render"


def test_chat_reports_real_changes_even_when_the_user_also_wants_to_render(client):
    url = f"/api/spaces/{_space(client, _venue(client))['id']}/chat"
    payload = {"message": "Add silver chairs and show me how it looks."}
    edited = _json(client.post(url, json=payload))
    assert edited["intent"] == "render"
    assert edited["spec_changed"] is True
    assert edited["spec"]["chairs"]["color"] == "silver"

    repeated = _json(client.post(url, json={**payload, "spec": edited["spec"]}))
    assert repeated["spec_changed"] is False


def test_rules_adjustments_count_as_changes_to_the_requested_spec(client):
    venue = _venue(client, rules={"live_candles": False})
    url = f"/api/spaces/{_space(client, venue)['id']}/chat"
    spec = default_spec("Ballroom").to_dict()
    spec["centerpieces"]["candles"] = "live"
    response = _json(client.post(url, json={"message": "Show me", "spec": spec}))
    assert response["spec_changed"] is True
    assert response["spec"]["centerpieces"]["candles"] == "flameless"
