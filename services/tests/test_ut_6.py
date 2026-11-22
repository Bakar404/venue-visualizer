import json
from pathlib import Path

import pytest

from api.db import write_session
from api.models import Space
from pipeline import fetch
from pipeline._proc import ProcResult
from pipeline.engines import codex, copilot
from pipeline.engines.base import GenerateRequest, ImageResult
from pipeline.engines.mock import MockEngine

from .conftest import make_room
from .test_api_flow import _json, _space, _upload, _venue

REFERENCES = [
    {"url": f"https://example.com/{name}.png", "source_page": "https://example.com/venues/hall",
     "credit": "Hall photographer", "caption": f"{name.title()} view"}
    for name in ("front", "side")
]


@pytest.fixture
def reference_space(client, monkeypatch):
    space = _space(client, _venue(client))
    with write_session(client.app.state.runtime.engine) as session:
        session.get_one(Space, space["id"]).references_json = REFERENCES

    async def download_image(url, folder):
        raise AssertionError(f"Unexpected download of {url}")

    monkeypatch.setattr(fetch, "download_image", download_image)
    return f"/api/spaces/{space['id']}"


def test_reference_becomes_approved_base_photo_without_removing_reference(client, reference_space, monkeypatch):
    before = _json(client.get(reference_space))
    assert before["references"] == REFERENCES and before["photos"] == []
    ref = REFERENCES[0]

    async def download_image(url, folder):
        assert url == ref["url"]
        return make_room(folder / "ref.png")

    monkeypatch.setattr(fetch, "download_image", download_image)
    photo = _json(client.post(f"{reference_space}/references/import", json={
        "url": ref["url"], "rights_confirmed": True,
    }), 201)
    assert photo["approved"] and photo["kind"] == "web"
    assert (photo["source_url"], photo["source_page"], photo["credit"]) == (
        ref["url"], ref["source_page"], ref["credit"],
    )
    after = _json(client.get(reference_space))
    assert after["photos"] == [photo] and after["references"] == REFERENCES
    assert client.get(photo["url"]).status_code == 200


def test_import_requires_rights_and_a_reference_belonging_to_the_space(client, reference_space):
    url = f"{reference_space}/references/import"
    _json(client.post(url, json={"url": REFERENCES[0]["url"], "rights_confirmed": False}), 422)
    _json(client.post(url, json={"url": "https://example.com/other.png", "rights_confirmed": True}), 422)


def test_reference_download_errors_include_the_reason(client, reference_space, monkeypatch):
    async def download_image(url, folder):
        raise fetch.FetchError("HTTP 404")

    monkeypatch.setattr(fetch, "download_image", download_image)
    result = _json(client.post(f"{reference_space}/references/import", json={
        "url": REFERENCES[0]["url"], "rights_confirmed": True,
    }), 502)
    assert "HTTP 404" in result["detail"]
    assert _json(client.get(reference_space))["photos"] == []


def test_reference_import_obeys_the_photo_cap_before_downloading(client, reference_space, room):
    space = _json(client.get(reference_space))
    _upload(client, space, [room] * 30)
    _json(client.post(f"{reference_space}/references/import", json={
        "url": REFERENCES[0]["url"], "rights_confirmed": True,
    }), 409)
    assert len(_json(client.get(reference_space))["photos"]) == 30


def test_generate_base_passes_only_the_chosen_reference_to_generate(client, reference_space, monkeypatch):
    chosen = REFERENCES[1]["url"]

    async def download_image(url, folder):
        assert url == chosen
        return make_room(folder / "ref.png")

    async def generate(self, request):
        [reference] = request.ref_images
        assert reference.is_file() and reference.is_relative_to(request.out_path.parent)
        assert "an empty version of the room shown in the reference photo" in request.prompt
        assert "same architecture and viewpoint, no furniture or people" in request.prompt
        make_room(request.out_path)
        return ImageResult(request.out_path, 768, 512, "mock", 0)

    monkeypatch.setattr(fetch, "download_image", download_image)
    monkeypatch.setattr(MockEngine, "generate", generate)
    url = f"{reference_space}/generate-base"
    _json(client.post(url, json={"engine": "mock", "reference_url": "https://example.com/missing.png"}), 422)
    job = _json(client.post(url, json={"engine": "mock", "reference_url": chosen}), 202)
    assert job["status"] == "done", job
    [photo] = _json(client.get(reference_space))["photos"]
    assert photo["id"] == job["result"]["photo_id"] and photo["kind"] == "generated_base"
    assert photo["approved"] is False


@pytest.mark.parametrize(("module", "engine"), [
    (copilot, copilot.CopilotEngine), (codex, codex.CodexEngine),
])
async def test_cli_generators_attach_reference_as_an_image(module, engine, room, tmp_path, monkeypatch):
    monkeypatch.setattr(module, "which", lambda name: f"/cli/{name}")

    async def run_cli(argv, *, cwd, **kwargs):
        if module is copilot:
            instruction = argv[1]
            args = json.loads(instruction[instruction.index("{"): instruction.rindex("}") + 1])
            [image] = args["input_images"]
            staged = Path(image["path"])
        else:
            staged = Path(argv[argv.index("-i") + 1])
            assert "Generate one image" in argv[-1] and "reference" in argv[-1]
        assert staged.is_relative_to(cwd) and staged.read_bytes() == room.read_bytes()
        output = make_room(cwd / "vv-output.png")
        return ProcResult(argv, 0, f"SAVED_TO: {output}", "", 0)

    monkeypatch.setattr(module, "run_cli", run_cli)
    request = GenerateRequest(prompt="Recreate the empty room", out_path=tmp_path / "base.png",
                              ref_images=[room])
    assert (await engine().generate(request)).path.is_file()
