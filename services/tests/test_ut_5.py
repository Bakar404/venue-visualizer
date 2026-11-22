from sqlmodel import Session, select

from api.db import database, initialize, write_session
from api.models import ChatMessage, Space, Venue
from pipeline.models import default_spec

from .test_api_flow import _json, _space, _venue


def test_look_name_reflects_the_latest_patch_not_the_old_palette(client):
    url = f"/api/spaces/{_space(client, _venue(client))['id']}/chat"
    spec = default_spec("Ballroom").to_dict()
    spec["palette"] = ["ivory", "gold", "sage green"]
    edited = _json(client.post(url, json={
        "message": "Make it moody with burgundy linens and blue uplighting.",
        "spec": spec,
    }))
    assert edited["intent"] == "edit"
    name = edited["look_name"].lower()
    assert 1 <= len(name) <= 40
    assert "blue" in name or "burgundy" in name
    assert not any(color in name for color in ("ivory", "gold", "sage green"))
    assert edited["spec"]["palette"][:3] == spec["palette"]
    assert _json(client.get(url))[-1]["look_name"] == edited["look_name"]

    latest = _json(client.post(url, json={"message": "Switch to plum napkins."}))
    assert "plum" in latest["look_name"].lower()
    assert latest["look_name"] != edited["look_name"]
    review = _json(client.post(url, json={"message": "Show me how it looks"}))
    assert review["look_name"] == latest["look_name"]


def test_schema_v2_upgrade_preserves_chat_and_adds_response_storage(tmp_path):
    engine = database(tmp_path)
    initialize(engine)
    venue = Venue(name="Venue")
    space = Space(venue_id=venue.id, name="Ballroom")
    with write_session(engine) as session:
        session.add(venue)
        session.flush()
        session.add(space)
        session.flush()
        session.add(ChatMessage(space_id=space.id, role="assistant", content="Your original plan."))
    with engine.begin() as conn:
        conn.exec_driver_sql("DELETE FROM schema_version WHERE version > 2")
        conn.exec_driver_sql("INSERT OR IGNORE INTO schema_version (version) VALUES (2)")
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(chatmessage)")}
        if "chat_meta_json" in columns:
            conn.exec_driver_sql("ALTER TABLE chatmessage DROP COLUMN chat_meta_json")

    initialize(engine)
    initialize(engine)
    with engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT MAX(version) FROM schema_version").scalar_one() == 3
    with write_session(engine) as session:
        [history] = session.exec(select(ChatMessage)).all()
        assert history.content == "Your original plan." and history.chat_meta_json is None
        history.chat_meta_json = {"intent": "edit", "look_name": "Burgundy reception", "ambiguities": []}
    with Session(engine) as session:
        assert session.exec(select(ChatMessage)).one().chat_meta_json["look_name"] == "Burgundy reception"
    engine.dispose()
