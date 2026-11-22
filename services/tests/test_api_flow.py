import shutil
import sys
from io import BytesIO
from types import ModuleType, SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session

from api.main import create_app
from api.models import Photo
from pipeline import registry, verify
from pipeline.engines.base import EngineStatus
from pipeline.engines.mock import MockEngine

from .conftest import make_room

DESCRIPTION = (
    "12 round tables of 8, ivory linens, gold chiavari chairs, "
    "low ivory and blush centerpieces with greenery, warm amber uplighting, live candles"
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VV_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("VV_DEV", "1")
    monkeypatch.setenv("VV_INLINE_JOBS", "1")
    monkeypatch.setenv("VV_DEFAULT_ENGINE", "mock")
    monkeypatch.setenv("VV_DEFAULT_BRAIN", "mock")
    monkeypatch.setattr(shutil, "which", lambda *_args, **_kwargs: None)
    with TestClient(create_app()) as api:
        yield api


def _json(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def _venue(client, name="The Elm", rules=None):
    return _json(client.post("/api/venues", json={"name": name, "rules": rules or {}}), 201)


def _space(client, venue, name="Ballroom"):
    return _json(client.post(f"/api/venues/{venue['id']}/spaces", json={"name": name}), 201)


def _upload(client, space, paths):
    return _json(
        client.post(
            f"/api/spaces/{space['id']}/photos",
            files=[("files[]", (p.name, p.read_bytes(), "image/png")) for p in paths],
        ),
        201,
    )


def _look(client, space, spec=None, name="Ivory reception", **extra):
    if spec is None:
        spec = _json(client.get("/api/spec/default"))
    return _json(
        client.post(
            f"/api/spaces/{space['id']}/looks",
            json={"name": name, "spec": spec, **extra},
        ),
        201,
    )


def _render(client, look, **body):
    return _json(client.post(f"/api/looks/{look['id']}/render", json={"engine": "mock", **body}), 202)


def test_phase_one_chat_render_compare_and_export(client, tmp_path):
    venue = _venue(client, rules={"live_candles": False})
    space = _space(client, venue)
    photos = _upload(
        client, space, [make_room(tmp_path / f"room-{i}.png", (320, 220), i * 4) for i in range(5)]
    )
    url = f"/api/spaces/{space['id']}"
    chat = _json(client.post(f"{url}/chat", json={"message": DESCRIPTION, "spec": None, "brain": "mock"}))
    spec = chat["spec"]
    assert spec["tables"]["count"] == 12
    assert spec["centerpieces"]["candles"] == "flameless"
    [warning] = chat["warnings"]
    assert warning["rule"] == "live_candles" and "flameless" in warning["fix"]
    assert _json(client.get(url))["current_spec"] == spec
    assert [message["role"] for message in _json(client.get(f"{url}/chat"))] == ["user", "assistant"]

    original = _look(client, space, spec)
    batch = _render(client, original, brain_qa=True, brain="mock")
    assert len(batch["renders"]) == len(batch["jobs"]) == 5
    assert {render["photo_id"] for render in batch["renders"]} == {photo["id"] for photo in photos}
    for job, render in zip(batch["jobs"], batch["renders"], strict=True):
        assert _json(client.get(f"/api/jobs/{job['id']}")) == job
        assert job["status"] == render["status"] == "done"
        assert job["result"]["render_id"] == render["id"] and job["progress"] == 1
        assert 0 <= render["structure_score"] <= 1
        assert isinstance(render["qa"]["tables_seen"], int)
        assert client.get(render["url"]).headers["content-type"] == "image/png"

    spec["centerpieces"]["height"] = "tall"
    changed = _look(client, space, spec, "Tall flowers", parent_look_id=original["id"])
    assert len(_render(client, changed)["renders"]) == 5
    first, second = _json(client.get(f"{url}/looks"))
    assert first["spec"]["centerpieces"]["height"] == "low" and len(first["renders"]) == 5
    assert second["spec"]["centerpieces"]["height"] == "tall" and len(second["renders"]) == 5
    assert second["parent_look_id"] == first["id"]
    assert _json(client.get(f"/api/looks/{first['id']}")) == first

    pdf = client.get(f"/api/looks/{first['id']}/export.pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF-") and pdf.content.rstrip().endswith(b"%%EOF")
    for text in (
        b"flameless LED candles",
        b"Live candles are not allowed",
        b"chiavari",
        b"warm amber",
        b"Original",
        b"Saved render",
    ):
        assert text in pdf.content
    assert len(_json(client.get("/api/jobs", params={"space_id": space["id"]}))) == 10


def _pipeline(monkeypatch, name, **functions):
    module = ModuleType(f"pipeline.{name}")
    for key, value in functions.items():
        setattr(module, key, value)
    monkeypatch.setitem(sys.modules, module.__name__, module)


def test_research_import_uses_only_selected_rules_and_downloads_rights_confirmed_photos(
    client,
    monkeypatch,
    tmp_path,
):
    source = "https://example.com/ballroom"
    imported = "https://example.com/base.png"
    reference = "https://example.com/ref.png"
    omitted = "https://example.com/unselected.png"
    calls = []

    async def research(query, brain):
        assert brain.id == "mock"
        return {
            "query": query,
            "matches": [{"name": "Hotel Marigold", "confidence": 0.9, "sources": [source]}],
        }

    def preview(data, match_index):
        assert data["query"] == "Marigold Hotel" and match_index == 0
        return {
            "venue_name": "Hotel Marigold",
            "rules_suggested": [
                {"key": "live_candles", "allowed": False, "text": "No flames", "source": source},
                {"key": "confetti", "allowed": False, "text": "No confetti", "source": source},
            ],
            "spaces": [
                {
                    "name": "Ballroom",
                    "venue_spec": {"floor": "oak"},
                    "photos": [
                        {"url": url, "source_page": source, "credit": "Marigold Photography"}
                        for url in (imported, reference, omitted)
                    ],
                },
                {"name": "Terrace", "venue_spec": {}, "photos": []},
            ],
            "provided_items": ["Ivory tablecloths"],
        }

    class FetchError(Exception):
        pass

    def fetch(url, dest_dir, max_bytes=20_000_000):
        calls.append(url)
        path = dest_dir / "download.png"
        shutil.copyfile(tmp_path / "remote.png", path)
        return path

    make_room(tmp_path / "remote.png", (320, 220))
    _pipeline(monkeypatch, "research", research_venue=research, research_to_import_preview=preview)
    _pipeline(monkeypatch, "fetch", download_image=fetch, FetchError=FetchError)
    research_job = _json(
        client.post(
            "/api/venues/research",
            json={"query": "Marigold Hotel", "brain": "mock"},
        ),
        202,
    )
    assert research_job["status"] == "done"
    data = {
        "research_job_id": research_job["id"],
        "match_index": 0,
        "space_names": ["Ballroom"],
        "accepted_rules": ["live_candles"],
        "photos": [
            {"url": imported, "mode": "import"},
            {"url": reference, "mode": "reference"},
        ],
    }
    assert client.post("/api/venues/import", json=data).status_code == 422
    assert not calls and not _json(client.get("/api/venues"))
    data["photos"][0]["rights_confirmed"] = True
    venue = _json(client.post("/api/venues/import", json=data), 201)
    assert venue["rules"] == {"live_candles": False, "provided_items": ["Ivory tablecloths"]}
    [space] = venue["spaces"]
    [photo] = space["photos"]
    assert photo["kind"] == "web" and photo["approved"] and photo["source_url"] == imported
    assert [p["url"] for p in space["references"]] == [reference] and calls == [imported]
    current = _json(client.get("/api/spec/default"))
    current["centerpieces"]["candles"] = "live"
    current["effects"]["confetti"] = True
    checked = _json(client.post("/api/spec/check", json={"spec": current, "venue_id": venue["id"]}))
    assert (
        checked["spec"]["centerpieces"]["candles"] == "flameless" and checked["spec"]["effects"]["confetti"]
    )
    look = _look(client, space, current)
    _render(client, look)
    pdf = client.get(f"/api/looks/{look['id']}/export.pdf")
    assert (
        pdf.status_code == 200 and b"Marigold Photography" in pdf.content and source.encode() in pdf.content
    )
    assert calls == [imported]


def test_video_review_apply_and_missing_modules(client, monkeypatch):
    venue = _venue(client)
    path = f"/api/venues/{venue['id']}/video"
    upload = {"file": ("tour.mov", b"mock video", "video/quicktime")}
    _pipeline(monkeypatch, "research")
    _pipeline(monkeypatch, "video")
    assert (
        "research_venue" in _json(client.post("/api/venues/research", json={"query": "Elm"}), 501)["detail"]
    )
    assert "ingest_video" in _json(client.post(path, files=upload), 501)["detail"]

    def ingest(video_path, out_dir, brain=None, max_frames=12):
        assert max_frames == 12 and brain.id == "mock" and video_path.read_bytes() == b"mock video"
        frames = []
        for i in range(3):
            image = make_room(out_dir / f"frame-{i}.png", (240, 160))
            frames.append(
                {
                    "path": str(image),
                    "t": i * 2.5,
                    "sharpness": 100,
                    "exposure_ok": True,
                    "space_guess": "A hall",
                    "view": "wide",
                    "description": "Empty hall",
                    "fixtures": ["windows"],
                    "usable": True,
                }
            )
        return SimpleNamespace(
            to_dict=lambda: {
                "frames": frames,
                "spaces_suggested": [
                    {"name": "A hall", "venue_spec": {"floor": "oak"}, "frame_indexes": [0, 1, 2]},
                ],
                "duration_s": 9.0,
                "warnings": ["Dimensions are estimates"],
            }
        )

    _pipeline(monkeypatch, "video", ingest_video=ingest)
    job = _json(client.post(path, files=upload, data={"brain": "mock"}), 202)
    assert job["status"] == "done"
    frames = job["result"]["frames"]
    ids = job["result"]["spaces_suggested"][0]["photo_ids"]
    assert ids == [row["photo_id"] for row in frames]
    runtime = client.app.state.runtime
    with Session(runtime.engine) as session:
        assert all(not session.get_one(Photo, key).approved for key in ids)
    assert client.get(frames[2]["url"]).status_code == 200
    assert client.post(f"/api/photos/{ids[0]}/approve").status_code == 409
    assert not list((runtime.settings.data_dir / "tmp").glob("video-*"))
    body = {"job_id": job["id"], "spaces": [{"name": "Main Hall", "photo_ids": ids[:2], "venue_spec": {}}]}
    [space] = _json(client.post(f"{path}/apply", json=body))["spaces"]
    assert space["name"] == "Main Hall"
    assert {
        photo["id"] for photo in space["photos"] if photo["approved"] and photo["kind"] == "video_frame"
    } == (set(ids[:2]))
    assert client.get(frames[2]["url"]).status_code == 404
    assert client.post(f"{path}/apply", json=body).status_code == 409


def test_upload_validation_metadata_and_file_isolation(client, tmp_path):
    v = _venue(client)
    s = _space(client, v)
    url = f"/api/spaces/{s['id']}/photos"
    good = BytesIO()
    image = Image.new("RGB", (11, 20))
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "Private metadata"
    image.save(good, "JPEG", exif=exif)
    good_upload = ("files[]", ("original.jpg", good.getvalue(), "image/jpeg"))
    bad_upload = ("files[]", ("pretend.png", b"not an image", "image/png"))
    assert client.post(url, files=[good_upload, bad_upload]).status_code == 422
    assert not _json(client.get(f"/api/spaces/{s['id']}"))["photos"]
    [photo] = _json(client.post(url, files=[good_upload]), 201)
    response = client.get(photo["url"])
    with Image.open(BytesIO(response.content)) as saved:
        assert saved.size == (20, 11) and not saved.getexif()
    for path in (
        "/files/%2e%2e/docs/api.md",
        "/files/venues/%2e%2e/venue-visualizer.sqlite",
        "/files/venue-visualizer.sqlite",
    ):
        assert client.get(path).status_code == 404
    root = client.app.state.runtime.settings.data_dir
    original = root / photo["url"].removeprefix("/files/")
    original.unlink()
    secret = tmp_path / "secret.png"
    secret.write_bytes(b"not public")
    original.symlink_to(secret)
    assert client.get(photo["url"]).status_code == 404


def test_generated_base_approval_and_regeneration_uses_original(client, monkeypatch):
    venue = _venue(client)
    space = _space(client, venue)
    assert "scene3d" not in {e["id"] for e in _json(client.get("/api/system/backends"))["engines"]}
    assert (
        client.post(
            f"/api/spaces/{space['id']}/generate-base",
            json={"engine": "scene3d"},
        ).status_code
        == 422
    )
    job = _json(
        client.post(
            f"/api/spaces/{space['id']}/generate-base",
            json={"engine": "mock", "angle_hint": "corner"},
        ),
        202,
    )
    [photo] = _json(client.get(f"/api/spaces/{space['id']}"))["photos"]
    assert (
        not photo["approved"]
        and photo["id"] == job["result"]["photo_id"]
        and photo["kind"] == "generated_base"
    )
    look = _look(client, space)
    assert client.post(f"/api/looks/{look['id']}/render", json={}).status_code == 409
    assert _json(client.post(f"/api/photos/{photo['id']}/approve"))["approved"]

    calls = []
    guide_specs = []
    edit = MockEngine.edit

    class Guide(MockEngine):
        id = "scene3d"

        def detect(self):
            return EngineStatus(available=True)

        async def generate(self, request):
            guide_specs.append(request.design_spec)
            return await super().generate(request)

    def engines(include_internal=False):
        return {"scene3d": Guide()} if include_internal else {}

    async def tracking_edit(self, request):
        assert request.ref_images[0].is_file() and "layout guide" in request.prompt
        calls.append(request.input_image)
        return await edit(self, request)

    monkeypatch.setattr(registry, "engines", engines)
    monkeypatch.setattr(MockEngine, "edit", tracking_edit)
    scores = iter((0.2, 0.95, 0.97))
    monkeypatch.setattr(verify, "structure_score", lambda *_: next(scores))
    [render] = _render(client, look)["renders"]
    assert render["structure_score"] == 0.95 and len(calls) == 2
    rerun = _json(client.post(f"/api/renders/{render['id']}/regenerate"), 202)
    assert rerun["status"] == "done" and rerun["result"]["render_id"] != render["id"]
    assert len(calls) == 3 and {p.name for p in calls} == {f"{photo['id']}.png"}
    assert len(guide_specs) == 2 and guide_specs[0]["tables"]["count"] > 0
    assert client.get(f"/api/looks/{look['id']}/export.pdf").status_code == 200
    assert len(calls) == 3


def test_edits_and_deletes_keep_saved_resources_consistent(client, tmp_path):
    venue = _venue(client, rules={"live_candles": False})
    base = f"/api/venues/{venue['id']}"
    updated = _json(client.patch(base, json={"name": "The Oak", "rules": {"fog": False}}))
    assert updated["name"] == "The Oak" and updated["rules"] == {"live_candles": False, "fog": False}
    space = _space(client, updated)
    space_url = f"/api/spaces/{space['id']}"
    design = _json(client.get("/api/spec/default"))
    renamed = _json(client.patch(space_url, json={"name": "Oak hall", "current_spec": design}))
    assert renamed["name"] == "Oak hall" and renamed["current_spec"] == design
    assert _json(client.patch(space_url, json={"current_spec": None}))["current_spec"] is None

    [photo] = _upload(client, space, [make_room(tmp_path / "room.png", (320, 220))])
    look = _look(client, space)
    [render] = _render(client, look)["renders"]
    assert client.delete(f"/api/photos/{photo['id']}").status_code == 204
    assert client.get(photo["url"]).status_code == client.get(render["url"]).status_code == 404
    assert _json(client.get(f"/api/looks/{look['id']}"))["renders"] == []
    assert _json(client.delete(f"/api/looks/{look['id']}"))["id"] == look["id"]
    assert _json(client.delete(base))["id"] == venue["id"]
    assert client.get(base).status_code == client.get(space_url).status_code == 404
