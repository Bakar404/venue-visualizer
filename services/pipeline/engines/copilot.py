"""GitHub Copilot CLI image engine (built-in `image_generation` tool; uses Copilot AI credits).

Copilot CLI 1.0.115 in non-interactive mode exposes `image_generation(prompt, input_images=[{"path"}], size,
quality)`, which saves PNGs to ~/.copilot/session-state/<session-id>/images/image-<hash>.png and returns
`saved_to`. We run `copilot -p` in a fresh temp cwd with ONLY that tool visible, shell/write denied, and ask
the model to call it once and print `SAVED_TO: <path>`.

The tool raises a `custom-tool` permission request. In -p mode an unapproved request does not get denied; the
CLI waits forever. So we pre-approve exactly that tool with `--allow-tool=custom-tool(image_generation)`
(verified on 1.0.115) and never use --allow-all-tools. Each run gets its own `--session-id=<uuid4>`, so the
output folder is known in advance. The output must be bound to THIS run: a SAVED_TO path is accepted only inside
`<state>/<this session id>/images/` or the job's temp cwd, and the fallback is the newest image written since the
run started in those same two folders. Another session's images are never used; if nothing can be attributed
the run fails. We only list/copy image files there; nothing else under ~/.copilot is read.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path

from PIL import Image

from .._images import register_heif
from .._proc import ProcTimeout, probe_version, run_cli, tail, which
from .base import EditRequest, EngineCaps, EngineError, EngineStatus, GenerateRequest, ImageResult

register_heif()

SIZES = ("1024x1024", "1536x1024", "1024x1536")
_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
_SAVED_RE = [
    re.compile(r"SAVED_TO:\s*`?\"?([^\s`\"]+?\.(?:png|jpe?g|webp))", re.IGNORECASE),
    re.compile(r"\"saved_to\"\s*:\s*\"([^\"]+)\"", re.IGNORECASE),
    re.compile(r"saved_to[\s:=]+`?([^\s`\"']+?\.(?:png|jpe?g|webp))", re.IGNORECASE),
]


def state_dir() -> Path:
    return Path(os.environ.get("VV_COPILOT_STATE_DIR") or Path.home() / ".copilot" / "session-state")


def nearest_size(width: int, height: int) -> str:
    """Pick the supported size whose aspect ratio is closest to width/height."""
    aspect = width / height if height else 1.5
    return min(SIZES, key=lambda s: abs(aspect - int(s.split("x")[0]) / int(s.split("x")[1])))


def _within(path: Path, roots: list[Path]) -> bool:
    try:
        rp = path.resolve()
    except OSError:
        return False
    for root in roots:
        try:
            rp.relative_to(root.resolve())
            return True
        except (ValueError, OSError):
            continue
    return False


_SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def locate_output(stdout: str, states: Path, since: float, cwd: Path | None = None,
                  session_id: str | None = None) -> Path | None:
    """Find the image THIS run generated: a SAVED_TO / saved_to path in stdout, else the newest new image.

    Only `<states>/<session_id>/images/` (when `session_id` is given) and `cwd` are considered, both for
    SAVED_TO paths and for the fallback; staged inputs (`vv-input*`) never count as output.
    """
    roots: list[Path] = []
    if session_id and _SESSION_ID.match(session_id) and session_id not in (".", ".."):
        roots.append(states / session_id / "images")
    if cwd:
        roots.append(cwd)

    def ok(p: Path) -> bool:
        return (p.suffix.lower() in _IMAGE_SUFFIXES and not p.name.startswith("vv-input") and p.is_file()
                and _within(p, roots))

    for rx in _SAVED_RE:
        for m in rx.finditer(stdout or ""):
            p = Path(os.path.expanduser(m.group(1).strip().rstrip(".,;)")))
            if ok(p):
                return p
    newest: tuple[float, Path] | None = None
    candidates = [p for root in roots if root.is_dir() for p in root.iterdir() if ok(p)]
    for p in candidates:
        try:
            mtime = p.stat().st_mtime
        except OSError:
            continue
        if mtime >= since - 1 and (newest is None or mtime > newest[0]):
            newest = (mtime, p)
    return newest[1] if newest else None


def build_instruction(prompt: str, size: str, quality: str, input_images: list[Path]) -> str:
    args: dict = {"prompt": prompt, "size": size, "quality": quality}
    if input_images:
        args["input_images"] = [{"path": str(p)} for p in input_images]
    return (
        "You are a non-interactive image renderer. Call the image_generation tool exactly once with exactly "
        "these arguments (do not rewrite, shorten or embellish the prompt):\n"
        f"{json.dumps(args, ensure_ascii=False, indent=2)}\n"
        "Do not call any other tool and do not ask questions. After the tool returns, print exactly one line:\n"
        "SAVED_TO: <the saved_to path returned by the tool>"
    )


class CopilotEngine:
    id = "copilot"
    label = "GitHub Copilot (image_generation)"
    binary = "copilot"

    def __init__(self, model: str | None = None):
        self.model = model

    def detect(self) -> EngineStatus:
        try:
            path = which(self.binary)
            if not path:
                return EngineStatus(available=False, detail="copilot not found on PATH")
            version, err = probe_version(path)
            return EngineStatus(available=True, logged_in=None, version=version, detail=err)
        except Exception as e:  # noqa: BLE001
            return EngineStatus(available=False, detail=f"detect failed: {e}")

    def capabilities(self) -> EngineCaps:
        return EngineCaps(can_generate=True, can_edit=True, photoreal=True, typical_seconds=30,
                          cost_note="Uses GitHub Copilot AI credits", max_refs=3, sizes=SIZES)

    def build_argv(self, path: str, instruction: str, session_id: str | None = None) -> list[str]:
        argv = [
            path,
            f"--prompt={instruction}",
            "-s",
            "--no-ask-user",
            "--no-custom-instructions",
            "--disable-builtin-mcps",
            "--no-color",
            "--available-tools=image_generation",
            "--allow-tool=custom-tool(image_generation)",
            "--deny-tool=shell",
            "--deny-tool=write",
        ]
        if session_id:
            argv.append(f"--session-id={session_id}")
        model = self.model or os.environ.get("VV_COPILOT_MODEL")
        if model:
            argv.append(f"--model={model}")
        return argv

    async def generate(self, req: GenerateRequest) -> ImageResult:
        size = req.size if req.size in SIZES else "1536x1024"
        return await self._run(req.prompt, size, req.quality, req.ref_images[:3], req.out_path, req.timeout_s)

    async def edit(self, req: EditRequest) -> ImageResult:
        with Image.open(req.input_image) as im:
            w, h = im.size
        size = req.size if req.size in SIZES else nearest_size(w, h)
        images = [Path(req.input_image), *[Path(r) for r in req.ref_images[:3]]]
        return await self._run(req.prompt, size, req.quality, images, req.out_path, req.timeout_s)

    async def _run(self, prompt: str, size: str, quality: str, images: list[Path], out_path: Path,
                   timeout_s: int) -> ImageResult:
        path = which(self.binary)
        if not path:
            raise EngineError("copilot CLI is not installed")
        start_wall, start = time.time(), time.monotonic()
        with tempfile.TemporaryDirectory(prefix="vv-copilot-img-") as tmp:
            cwd = Path(tmp).resolve()
            staged = [_stage(img, cwd, f"vv-input-{i}") for i, img in enumerate(images)]
            session_id = str(uuid.uuid4())
            argv = self.build_argv(path, build_instruction(prompt, size, quality, staged), session_id)
            try:
                res = await run_cli(argv, cwd=cwd, timeout_s=timeout_s)
            except ProcTimeout as e:
                raise EngineError(f"{e}\n{tail(e.stderr)}") from e
            found = locate_output(res.stdout, state_dir(), start_wall, cwd, session_id)
            log = res.log()
            if found is None:
                raise EngineError(f"copilot produced no image (exit {res.returncode}): "
                                  f"{tail(res.stdout + chr(10) + res.stderr)}")
            out_path = Path(out_path)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            save_image(found, out_path)
        with Image.open(out_path) as im:
            width, height = im.size
        return ImageResult(path=out_path, width=width, height=height, engine=self.id,
                           seconds=time.monotonic() - start, raw_log=log)


def _stage(src: Path, cwd: Path, stem: str) -> Path:
    """Copy an input into the temp cwd (Copilot only reads cwd/temp paths); convert odd formats to PNG."""
    src = Path(src)
    if src.suffix.lower() in _IMAGE_SUFFIXES:
        dst = cwd / f"{stem}{src.suffix.lower()}"
        shutil.copyfile(src, dst)
        return dst
    dst = cwd / f"{stem}.png"
    with Image.open(src) as im:
        im.convert("RGB").save(dst, "PNG")
    return dst


def save_image(src: Path, dst: Path) -> None:
    if src.suffix.lower() == dst.suffix.lower() or dst.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        shutil.copyfile(src, dst)
        return
    with Image.open(src) as im:
        (im.convert("RGB") if dst.suffix.lower() in (".jpg", ".jpeg") else im).save(dst)

