"""Local, non-AI screenshots of the web app's /render/scene route."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode

import httpx
from PIL import Image

from .base import EditRequest, EngineCaps, EngineError, EngineStatus, GenerateRequest, ImageResult


def _encode_json(value: dict) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def build_scene_url(
    web_url: str,
    design_spec: dict,
    venue_spec: dict | None = None,
    camera: str = "wide",
) -> str:
    if camera not in {"wide", "top", "corner"}:
        raise ValueError(f"Unsupported scene camera: {camera}")
    query = urlencode(
        {
            "spec": _encode_json(design_spec),
            "venue": _encode_json(venue_spec if venue_spec is not None else {}),
            "camera": camera,
        }
    )
    return f"{web_url.rstrip('/')}/render/scene?{query}"


def _chromium_installed() -> bool:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        executable = Path(playwright.chromium.executable_path)
        return executable.is_file() and os.access(executable, os.X_OK)


class Scene3DEngine:
    id = "scene3d"
    label = "3D scene (no AI)"

    @property
    def web_url(self) -> str:
        return os.environ.get("VV_WEB_URL", "http://localhost:3000")

    def detect(self) -> EngineStatus:
        try:
            # The synchronous inspector must also work when detect is called inside an async API route.
            with ThreadPoolExecutor(max_workers=1) as executor:
                installed = executor.submit(_chromium_installed).result()
            if not installed:
                return EngineStatus(
                    available=False,
                    detail="Chromium is not installed; run uv run --extra scene3d playwright install chromium.",
                )
            response = httpx.get(self.web_url, timeout=1.0, follow_redirects=True)
            response.raise_for_status()
            return EngineStatus(available=True, detail=f"Local scene renderer at {self.web_url}")
        except ImportError:
            return EngineStatus(available=False, detail="Playwright is missing; install the scene3d extra.")
        except Exception as exc:  # noqa: BLE001 - protocol requires detection to never raise
            # Detection is intentionally best-effort and must never raise, including broken installations.
            return EngineStatus(available=False, detail=f"Scene renderer unavailable: {exc}")

    def capabilities(self) -> EngineCaps:
        return EngineCaps(
            can_generate=True,
            can_edit=True,
            photoreal=False,
            typical_seconds=5,
            cost_note="Free, stylized, no AI; exact table counts",
            sizes=("auto", "1024x1024", "1536x1024", "1024x1536"),
        )

    async def generate(self, req: GenerateRequest) -> ImageResult:
        return await self._render(req)

    async def edit(self, req: EditRequest) -> ImageResult:
        """Rebuild from the full spec; input_image and ref_images are intentionally ignored."""
        return await self._render(req)

    async def _render(self, req: GenerateRequest | EditRequest) -> ImageResult:
        if req.design_spec is None:
            raise EngineError("scene3d requires design_spec; it cannot interpret a text prompt.")
        size = "1536x1024" if req.size == "auto" else req.size
        if size not in self.capabilities().sizes:
            raise EngineError(f"Unsupported scene3d size: {size}")
        width, height = (int(value) for value in size.split("x"))
        started = time.monotonic()
        try:
            from playwright.async_api import Error as PlaywrightError
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise EngineError("Install the scene3d extra and Playwright Chromium before rendering.") from exc
        url = build_scene_url(self.web_url, req.design_spec, req.venue_spec)
        errors: list[str] = []
        try:
            async with asyncio.timeout(req.timeout_s):
                async with async_playwright() as playwright:
                    browser = await playwright.chromium.launch(headless=True)
                    try:
                        page = await browser.new_page(
                            viewport={"width": width, "height": height},
                            device_scale_factor=1,
                        )
                        page.set_default_timeout(req.timeout_s * 1000)
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        response = await page.goto(url, wait_until="domcontentloaded")
                        if response is None or not response.ok:
                            status = response.status if response is not None else "no response"
                            raise EngineError(
                                f"Scene route returned {status}; /render/scene must be installed."
                            )
                        await page.wait_for_function("window.__VV_SCENE_READY === true")
                        canvas = page.locator("canvas")
                        await canvas.wait_for(state="visible")
                        bounds = await canvas.bounding_box()
                        if (
                            bounds is None
                            or abs(bounds["width"] - width) > 0.5
                            or abs(bounds["height"] - height) > 0.5
                        ):
                            raise EngineError("Scene route canvas must fill the requested viewport exactly.")
                        req.out_path.parent.mkdir(parents=True, exist_ok=True)
                        await canvas.screenshot(path=str(req.out_path), type="png", animations="disabled")
                    finally:
                        await browser.close()
        except (TimeoutError, PlaywrightError) as exc:
            detail = "; ".join(errors)
            raise EngineError(
                f"Scene render failed: {exc}" + (f"; page errors: {detail}" if detail else "")
            ) from exc
        with Image.open(req.out_path) as image:
            actual_width, actual_height = image.size
        if (actual_width, actual_height) != (width, height):
            raise EngineError(
                f"Scene canvas produced {actual_width}x{actual_height}, expected {width}x{height}."
            )
        return ImageResult(
            path=req.out_path,
            width=width,
            height=height,
            engine=self.id,
            seconds=time.monotonic() - started,
            raw_log="Rendered DesignSpec locally; no AI or input-image editing."
            + (f" Page errors: {'; '.join(errors)}" if errors else ""),
        )
