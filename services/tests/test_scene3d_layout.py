import base64
import builtins
import json
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from PIL import Image

from pipeline.engines import scene3d
from pipeline.engines.base import EditRequest, EngineError, GenerateRequest, ImageEngine
from pipeline.engines.scene3d import Scene3DEngine, build_scene_url


def decode_json(value: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))


def test_detect_missing_playwright(monkeypatch):
    original_import = builtins.__import__

    def without_playwright(name, *args, **kwargs):
        if name.startswith("playwright"):
            raise ModuleNotFoundError("No module named playwright")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without_playwright)
    get = Mock(side_effect=AssertionError("Must not probe the web when Playwright is missing"))
    monkeypatch.setattr(scene3d.httpx, "get", get)
    status = Scene3DEngine().detect()
    assert not status.available
    assert "Playwright is missing" in status.detail
    get.assert_not_called()


def test_detect_missing_chromium(monkeypatch):
    monkeypatch.setattr(scene3d, "_chromium_installed", lambda: False)
    status = Scene3DEngine().detect()
    assert not status.available
    assert "Chromium is not installed" in status.detail


def test_detect_web_down(monkeypatch):
    monkeypatch.setattr(scene3d, "_chromium_installed", lambda: True)
    get = Mock(side_effect=httpx.ConnectError("Connection refused"))
    monkeypatch.setattr(scene3d.httpx, "get", get)
    monkeypatch.setenv("VV_WEB_URL", "http://localhost:4567")
    status = Scene3DEngine().detect()
    assert not status.available
    assert "Connection refused" in status.detail
    get.assert_called_once_with("http://localhost:4567", timeout=1.0, follow_redirects=True)


@pytest.mark.asyncio
async def test_detect_available_inside_async_context(monkeypatch):
    monkeypatch.setattr(scene3d, "_chromium_installed", lambda: True)
    response = httpx.Response(200, request=httpx.Request("GET", "http://localhost:3000"))
    monkeypatch.setattr(scene3d.httpx, "get", lambda *args, **kwargs: response)
    engine = Scene3DEngine()
    assert engine.detect().available
    assert isinstance(engine, ImageEngine)
    assert engine.capabilities().cost_note == "Free, stylized, no AI; exact table counts"


def test_detect_broken_installation_and_http_errors(monkeypatch):
    def broken_installation():
        raise RuntimeError("Broken driver")

    monkeypatch.setattr(scene3d, "_chromium_installed", broken_installation)
    assert "Broken driver" in Scene3DEngine().detect().detail
    monkeypatch.setattr(scene3d, "_chromium_installed", lambda: True)
    response = httpx.Response(503, request=httpx.Request("GET", "http://localhost:3000"))
    monkeypatch.setattr(scene3d.httpx, "get", lambda *args, **kwargs: response)
    assert not Scene3DEngine().detect().available


@pytest.mark.parametrize("venue", [None, {}, {"length_ft": 80.5, "windows": "Large windows"}])
def test_scene_url_round_trip(venue):
    spec = {"version": 1, "space": "Caf\u00e9 & ballroom", "tables": {"count": 12}, "notes": "? / + ="}
    url = build_scene_url("http://localhost:3000/base/", spec, venue)
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    assert parsed.path == "/base/render/scene"
    assert query["camera"] == ["wide"]
    assert decode_json(query["spec"][0]) == spec
    assert decode_json(query["venue"][0]) == (venue or {})
    for name in ("spec", "venue"):
        assert all(char.isalnum() or char in "_-" for char in query[name][0])


def test_url_camera_and_default_web_url(monkeypatch):
    monkeypatch.delenv("VV_WEB_URL", raising=False)
    assert Scene3DEngine().web_url == "http://localhost:3000"
    assert parse_qs(urlparse(build_scene_url("http://localhost:3000", {}, camera="top")).query)["camera"] == [
        "top"
    ]
    with pytest.raises(ValueError, match="Unsupported scene camera"):
        build_scene_url("http://localhost:3000", {}, camera="invalid")


@pytest.mark.asyncio
async def test_generate_and_edit_share_spec_renderer(monkeypatch, tmp_path):
    requests = []

    async def render(self, req):
        requests.append(req)
        return "rendered"

    monkeypatch.setattr(Scene3DEngine, "_render", render)
    engine = Scene3DEngine()
    generate = GenerateRequest(
        prompt="ignored", out_path=tmp_path / "generate.png", design_spec={"version": 1}
    )
    edit = EditRequest(
        prompt="ignored",
        input_image=tmp_path / "does-not-exist.png",
        out_path=tmp_path / "edit.png",
        design_spec={"version": 1},
        venue_spec={"length_ft": 80},
    )
    assert await engine.generate(generate) == "rendered"
    assert await engine.edit(edit) == "rendered"
    assert requests == [generate, edit]


@pytest.mark.asyncio
async def test_missing_spec_is_an_explicit_error(tmp_path):
    with pytest.raises(EngineError, match="requires design_spec"):
        await Scene3DEngine().generate(GenerateRequest(prompt="a room", out_path=tmp_path / "scene.png"))


@pytest.fixture
def fake_playwright(monkeypatch):
    canvas = SimpleNamespace(
        wait_for=AsyncMock(),
        bounding_box=AsyncMock(),
        screenshot=AsyncMock(),
    )
    page = SimpleNamespace(
        set_default_timeout=Mock(),
        on=Mock(),
        goto=AsyncMock(return_value=SimpleNamespace(ok=True)),
        wait_for_function=AsyncMock(),
        locator=Mock(return_value=canvas),
    )
    browser = SimpleNamespace(new_page=AsyncMock(return_value=page), close=AsyncMock())
    chromium = SimpleNamespace(launch=AsyncMock(return_value=browser))
    context = SimpleNamespace(chromium=chromium)
    manager = AsyncMock()
    manager.__aenter__.return_value = context
    api = ModuleType("playwright.async_api")
    api.async_playwright = Mock(return_value=manager)
    api.Error = type("FakePlaywrightError", (Exception,), {})
    monkeypatch.setitem(sys.modules, "playwright", ModuleType("playwright"))
    monkeypatch.setitem(sys.modules, "playwright.async_api", api)
    return SimpleNamespace(page=page, canvas=canvas, browser=browser, chromium=chromium)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("size", "dimensions", "editing"),
    [
        ("auto", (1536, 1024), True),
        ("1024x1024", (1024, 1024), False),
        ("1024x1536", (1024, 1536), False),
    ],
)
async def test_render_captures_ready_canvas_at_requested_size(
    fake_playwright, tmp_path, size, dimensions, editing
):
    width, height = dimensions
    fake_playwright.canvas.bounding_box.return_value = {"width": width, "height": height}

    async def screenshot(*, path, **kwargs):
        Image.new("RGB", dimensions).save(path)

    fake_playwright.canvas.screenshot.side_effect = screenshot
    kwargs = {
        "prompt": "ignored",
        "out_path": tmp_path / "nested" / "scene.png",
        "size": size,
        "design_spec": {"tables": {"count": 12}},
        "venue_spec": {"length_ft": 80},
    }
    engine = Scene3DEngine()
    if editing:
        result = await engine.edit(EditRequest(input_image=tmp_path / "missing.png", **kwargs))
    else:
        result = await engine.generate(GenerateRequest(**kwargs))
    assert result.path.is_file()
    assert (result.width, result.height) == dimensions
    assert result.engine == "scene3d"
    fake_playwright.page.wait_for_function.assert_awaited_once_with("window.__VV_SCENE_READY === true")
    fake_playwright.page.locator.assert_called_once_with("canvas")
    fake_playwright.browser.new_page.assert_awaited_once_with(
        viewport={"width": width, "height": height},
        device_scale_factor=1,
    )
    fake_playwright.browser.close.assert_awaited_once()
    query = parse_qs(urlparse(fake_playwright.page.goto.call_args.args[0]).query)
    assert decode_json(query["spec"][0]) == kwargs["design_spec"]
    assert decode_json(query["venue"][0]) == kwargs["venue_spec"]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "missing_route", "wrong_canvas_size"])
async def test_render_failures_close_browser_without_screenshot(fake_playwright, tmp_path, failure):
    if failure == "timeout":
        fake_playwright.page.wait_for_function.side_effect = TimeoutError("Scene never ready")
    elif failure == "missing_route":
        fake_playwright.page.goto.return_value = SimpleNamespace(ok=False, status=404)
    else:
        fake_playwright.canvas.bounding_box.return_value = {"width": 320, "height": 240}
    req = GenerateRequest(prompt="ignored", out_path=tmp_path / "scene.png", design_spec={})
    with pytest.raises(EngineError):
        await Scene3DEngine().generate(req)
    fake_playwright.browser.close.assert_awaited_once()
    fake_playwright.canvas.screenshot.assert_not_awaited()
    assert not req.out_path.exists()
