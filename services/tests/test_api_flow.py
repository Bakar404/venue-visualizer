import shutil
import subprocess
import sys
from io import BytesIO
from types import ModuleType, SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session

from api.contracts import ImportPreview
from api.db import database, initialize, write_session
from api.main import create_app
from api.models import Photo, Space, Venue
from pipeline import fetch, registry, research, verify
from pipeline.brains.mock import canned_research
from pipeline.engines.base import EngineStatus, ImageResult
from pipeline.engines.mock import MockEngine
from pipeline.models import RuleWarning, default_spec

from .conftest import make_room

DESCRIPTION = (
    "12 round tables of 8, ivory linens, gold chiavari chairs, "
    "low ivory and blush centerpieces with greenery, warm amber uplighting, live candles"
)
JSON_HEADERS = {"Content-Type": "application/json"}


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


def test_host_and_write_request_policy(client):
    health = "/api/health"
    assert _json(client.get(health, headers={"Host": "localhost:8000"})) == {"ok": True}
    assert client.get(health, headers={"Host": "evil.example"}).status_code == 400
    assert client.get(health, headers={"Host": "[::1]:8000"}).status_code == 200
    assert client.get(health, headers={"X-Forwarded-Host": "localhost:3000"}).status_code == 200
    assert client.get(health, headers={"X-Forwarded-Host": "evil.example"}).status_code == 400

    url = "/api/venues"
    assert client.post(url, content='{"name":"Elm"}').status_code == 415
    assert client.post(url, data={"name": "Elm"}).status_code == 415
    assert client.post(url, json={"name": "Elm"}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post(
        url, files={"name": (None, "Elm")}, headers={"Origin": "https://evil.example"}
    ).status_code == 403
    assert not _json(client.get(url))
    for origin in ("http://localhost:3000", "http://127.0.0.1:3000"):
        assert client.post(url, json={"name": "Elm"}, headers={"Origin": origin}).status_code == 201
    venue = _venue(client)
    assert client.delete(f"{url}/{venue['id']}").status_code == 415
    assert client.delete(f"{url}/{venue['id']}", headers=JSON_HEADERS).status_code == 200


def test_additional_hosts_and_origins_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("VV_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("VV_ALLOWED_HOSTS", " api.example.test, planner.example.test ")
    monkeypatch.setenv("VV_ALLOWED_ORIGINS", " https://planner.example.test ")
    monkeypatch.setattr(shutil, "which", lambda *_args, **_kwargs: None)
    headers = {"Origin": "https://planner.example.test", "X-Forwarded-Host": "planner.example.test"}
    with TestClient(create_app(), base_url="http://api.example.test:8000") as client:
        response = client.post("/api/venues", json={"name": "Elm"}, headers=headers)
        assert response.status_code == 201
        assert response.headers["Access-Control-Allow-Origin"] == headers["Origin"]


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


@pytest.mark.parametrize("has_rule_notes", [False, True])
def test_chat_rule_notes_and_history(client, monkeypatch, has_rule_notes):
    venue = _venue(client)
    space = _space(client, venue)
    url = f"/api/spaces/{space['id']}/chat"
    messages = ["Use flameless candles.", "Skip confetti."]
    adjustment = "\n\nAdjusted for venue rules: " + "; ".join(messages)
    expected_reply = "Here's your plan." + adjustment

    async def chat_to_spec(*_args):
        result = SimpleNamespace(
            reply=expected_reply if has_rule_notes else "Here's your plan.",
            spec=default_spec(),
            spec_patch={},
            intent="edit",
            spec_changed=False,
            look_name=None,
            ambiguities=[],
            warnings=[
                RuleWarning(rule="live_candles", field="centerpieces.candles", message=messages[0]),
                RuleWarning(rule="confetti", field="effects.confetti", message=messages[1]),
            ],
        )
        if has_rule_notes:
            result.rule_notes = messages
        return result

    monkeypatch.setattr("pipeline.spec_ops.chat_to_spec", chat_to_spec)
    chat = _json(client.post(url, json={"message": "Use candles and confetti.", "brain": "mock"}))
    assert chat["rule_notes"] == (messages if has_rule_notes else [])
    assert chat["reply"] == expected_reply
    _, assistant = _json(client.get(url))
    assert assistant["role"] == "assistant" and assistant["content"] == expected_reply


def _pipeline(monkeypatch, name, **functions):
    module = ModuleType(f"pipeline.{name}")
    for key, value in functions.items():
        setattr(module, key, value)
    monkeypatch.setitem(sys.modules, module.__name__, module)


def test_import_preview_ignores_extra_pipeline_fields(client):
    preview = ImportPreview.model_validate(
        {
            "venue_name": "Elm",
            "rules_suggested": [],
            "provided_items": [],
            "spaces": [{"name": "Ballroom", "other": 1, "venue_spec": {"floor": "oak", "other": 1}}],
        }
    )
    [space] = preview.spaces
    assert "other" not in space.model_dump() and space.venue_spec.to_dict() == {"floor": "oak"}
    venue = _venue(client)
    response = client.post(
        f"/api/venues/{venue['id']}/spaces", json={"name": "Ballroom", "venue_spec": {"other": 1}}
    )
    assert response.status_code == 422


def test_import_capacity_columns_added_to_existing_database(tmp_path):
    engine = database(tmp_path)
    try:
        initialize(engine)
        venue = Venue(name="Elm")
        space = Space(venue_id=venue.id, name="Old Ballroom")
        with write_session(engine) as session:
            session.add(venue)
            session.flush()
            session.add(space)
        with engine.begin() as conn:
            conn.exec_driver_sql("DELETE FROM schema_version WHERE version > 1")
            conn.exec_driver_sql("INSERT INTO schema_version (version) VALUES (1)")
            for column in ("capacity_seated", "capacity_standing", "source"):
                conn.exec_driver_sql(f"ALTER TABLE space DROP COLUMN {column}")
            conn.exec_driver_sql("ALTER TABLE chatmessage DROP COLUMN chat_meta_json")
        initialize(engine)
        initialize(engine)
        with Session(engine) as session:
            restored = session.get_one(Space, space.id)
            assert restored.name == "Old Ballroom"
            assert (restored.capacity_seated, restored.capacity_standing, restored.source) == (None, None, None)
    finally:
        engine.dispose()


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

    async def research_venue(query, brain):
        assert brain.id == "mock"
        return {
            "query": query,
            "matches": [
                {
                    "name": "Hotel Marigold",
                    "confidence": 0.9,
                    "sources": [source],
                    "rules_found": [
                        {"maps_to": "live_candles", "allowed": False, "text": "No flames", "source": source},
                        {"maps_to": "confetti", "allowed": False, "text": "No confetti", "source": source},
                    ],
                    "spaces": [
                        {
                            "name": "Ballroom",
                            "floor": "oak",
                            "capacity_seated": 100,
                            "capacity_standing": 150,
                            "source": source,
                            "photos": [
                                {"url": url, "source_page": source, "credit": "Marigold Photography"}
                                for url in (imported, reference, omitted)
                            ],
                        },
                        {"name": "Terrace"},
                    ],
                    "provided_items": ["Ivory tablecloths", "Folding chairs"],
                },
            ],
        }

    class FetchError(Exception):
        pass

    def fetch(url, dest_dir, max_bytes=20_000_000):
        calls.append(url)
        path = dest_dir / "download.png"
        shutil.copyfile(tmp_path / "remote.png", path)
        return path

    make_room(tmp_path / "remote.png", (320, 220))
    monkeypatch.setattr(research, "research_venue", research_venue)
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
    invalid_items = {**data, "accepted_provided_items": ["Cutlery"]}
    assert client.post("/api/venues/import", json=invalid_items).status_code == 422
    assert client.post("/api/venues/import", json={**data, "unknown": True}).status_code == 422
    assert not calls and not _json(client.get("/api/venues"))
    default = _json(client.post("/api/venues/import", json={**data, "photos": []}), 201)
    assert default["rules"] == {"live_candles": False}
    assert default["skipped_photos"] == []
    data["accepted_provided_items"] = ["Ivory tablecloths"]
    venue = _json(client.post("/api/venues/import", json=data), 201)
    assert venue["rules"] == {"live_candles": False, "provided_items": ["Ivory tablecloths"]}
    [space] = venue["spaces"]
    saved = _json(client.get(f"/api/spaces/{space['id']}"))
    assert (saved["capacity_seated"], saved["capacity_standing"], saved["source"]) == (100, 150, source)
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


def test_import_skips_a_photo_that_no_longer_downloads(client, monkeypatch):
    research_data = canned_research("The Elm")
    [ballroom] = research_data["matches"][0]["spaces"]
    [photo] = ballroom["photos"]
    missing = "https://example.com/venue/missing.jpg"
    ballroom["photos"].insert(0, {**photo, "url": missing})

    async def research_venue(query, brain):
        return research_data

    async def download_image(url, folder):
        if url == missing:
            raise fetch.FetchError("HTTP 404")
        assert url == photo["url"]
        return make_room(folder / "room.png")

    monkeypatch.setattr(research, "research_venue", research_venue)
    monkeypatch.setattr(fetch, "download_image", download_image)
    job = _json(client.post("/api/venues/research", json={"query": "The Elm"}), 202)
    imported = _json(
        client.post("/api/venues/import", json={
            "research_job_id": job["id"],
            "match_index": 0,
            "space_names": [ballroom["name"]],
            "photos": [
                {"url": url, "mode": "import", "rights_confirmed": True}
                for url in (missing, photo["url"])
            ],
        }),
        201,
    )
    assert imported["name"] == "The Elm"
    assert imported["skipped_photos"] == [{"url": missing, "reason": "HTTP 404"}]
    saved = _json(client.get(f"/api/venues/{imported['id']}"))
    assert saved == {key: value for key, value in imported.items() if key != "skipped_photos"}
    [saved_photo] = saved["spaces"][0]["photos"]
    assert saved_photo["source_url"] == photo["url"]
    assert client.get(saved_photo["url"]).status_code == 200


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
    monkeypatch.setattr("api.venues.validate_video_duration", lambda _path: None)
    job = _json(client.post(path, files=upload, data={"brain": "mock"}), 202)
    assert job["status"] == "done"
    frames = job["result"]["frames"]
    ids = job["result"]["spaces_suggested"][0]["photo_ids"]
    assert ids == [row["photo_id"] for row in frames]
    runtime = client.app.state.runtime
    with Session(runtime.engine) as session:
        assert all(not session.get_one(Photo, key).approved for key in ids)
    assert client.get(frames[2]["url"]).status_code == 200
    assert client.post(f"/api/photos/{ids[0]}/approve", headers=JSON_HEADERS).status_code == 409
    assert not list((runtime.settings.data_dir / "tmp").glob("video-*"))
    body = {"job_id": job["id"], "spaces": [{"name": "Main Hall", "photo_ids": ids[:2], "venue_spec": {}}]}
    [space] = _json(client.post(f"{path}/apply", json=body))["spaces"]
    assert space["name"] == "Main Hall"
    assert {
        photo["id"] for photo in space["photos"] if photo["approved"] and photo["kind"] == "video_frame"
    } == (set(ids[:2]))
    assert client.get(frames[2]["url"]).status_code == 404
    assert client.post(f"{path}/apply", json=body).status_code == 409


@pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg tools required")
def test_long_video_is_rejected_before_enqueue(client, monkeypatch, tmp_path):
    video = tmp_path / "long.mp4"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=size=32x32:rate=1:duration=301",
            "-c:v", "mpeg4", str(video),
        ],
        check=True,
        timeout=30,
    )
    venue = _venue(client)

    def ingest(*_args, **_kwargs):
        pytest.fail("The over-long video must not be ingested")

    _pipeline(monkeypatch, "video", ingest_video=ingest)
    with video.open("rb") as file:
        response = client.post(f"/api/venues/{venue['id']}/video", files={"file": (video.name, file)})
    assert "at most five minutes" in _json(response, 422)["detail"]
    assert not _json(client.get("/api/jobs"))
    assert not list((client.app.state.runtime.settings.data_dir / "tmp").glob("video-*"))


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


def test_upload_mpo_saves_only_first_frame_as_jpeg(client):
    space = _space(client, _venue(client))
    upload = BytesIO()
    first = Image.new("RGB", (18, 12), "red")
    second = Image.new("RGB", (21, 14), "blue")
    first.save(upload, "MPO", save_all=True, append_images=[second])
    with Image.open(upload) as original:
        assert original.format == "MPO" and original.n_frames == 2
    response = client.post(
        f"/api/spaces/{space['id']}/photos", files={"files[]": ("phone.jpg", upload.getvalue(), "image/jpeg")}
    )
    [photo] = _json(response, 201)
    saved = client.get(photo["url"])
    assert saved.headers["content-type"] == "image/jpeg"
    with Image.open(BytesIO(saved.content)) as image:
        assert image.format == "JPEG" and image.size == first.size and not image.getexif()


@pytest.mark.parametrize("scores", [(0.8,), (0.2, 0.35)])
def test_render_qa_uses_alignment_not_aspect_ratio(client, monkeypatch, tmp_path, scores):
    space = _space(client, _venue(client))
    _upload(client, space, [make_room(tmp_path / "original.png", (384, 288))])
    look = _look(client, space)
    assert _json(client.get("/api/system/backends"))["thresholds"] == {"structure_ok": 0.70}
    calls = []
    reports = []
    remaining = iter(scores)

    async def edit(self, request):
        calls.append(request)
        with Image.open(request.input_image) as image:
            image.crop((0, 0, 384, 256)).resize((1536, 1024)).save(request.out_path)
        return ImageResult(request.out_path, 1536, 1024, "mock", 0)

    def structure_report(original, render):
        assert verify.image_size(original) == (384, 288)
        assert verify.image_size(render) == (1536, 1024)
        score = next(remaining)
        aligned = score == 0.8
        report = {
            "score": score, "method": "aligned" if aligned else "misaligned", "aligned": aligned,
            "inliers": 36 if aligned else 0, "scale": 1.0 if aligned else None,
            "rotation": 0.0 if aligned else None, "coverage": 0.95 if aligned else None,
            "edge_density": 0.1, "flat": False, "brightness_delta": 0.03,
            "reason": "protected room features match" if aligned else "no consistent match with the photo",
        }
        reports.append(report)
        return report

    monkeypatch.setattr(MockEngine, "edit", edit)
    monkeypatch.setattr(verify, "structure_report", structure_report)
    batch = _render(client, look)
    assert batch["jobs"][0]["status"] == "done"
    [render] = _json(client.get(f"/api/looks/{look['id']}"))["renders"]
    assert len(calls) == len(scores)
    assert render["structure_score"] == scores[-1] and render["qa"]["structure"] == reports[-1]
    assert render["qa"]["structure_warning"] == (
        None if len(scores) == 1 else "This render may have altered the room or changed the framing."
    )


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
    assert _json(client.post(f"/api/photos/{photo['id']}/approve", headers=JSON_HEADERS))["approved"]

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
    structure_report = verify.structure_report
    monkeypatch.setattr(verify, "structure_report", lambda *paths: {**structure_report(*paths), "score": next(scores)})
    [render] = _render(client, look)["renders"]
    assert render["structure_score"] == 0.95 and len(calls) == 2
    rerun = _json(client.post(f"/api/renders/{render['id']}/regenerate", headers=JSON_HEADERS), 202)
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
    assert client.delete(f"/api/photos/{photo['id']}", headers=JSON_HEADERS).status_code == 204
    assert client.get(photo["url"]).status_code == client.get(render["url"]).status_code == 404
    assert _json(client.get(f"/api/looks/{look['id']}"))["renders"] == []
    assert _json(client.delete(f"/api/looks/{look['id']}", headers=JSON_HEADERS))["id"] == look["id"]
    assert _json(client.delete(base, headers=JSON_HEADERS))["id"] == venue["id"]
    assert client.get(base).status_code == client.get(space_url).status_code == 404
