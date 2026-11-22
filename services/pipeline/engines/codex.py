"""Codex CLI image engine (built-in `$imagegen` skill / image_generation feature; uses ChatGPT plan quota).

Not installed on the dev machine; implemented from the Codex CLI docs:
  codex exec --skip-git-repo-check --sandbox workspace-write --ephemeral --color never -C <tmp>
             [-i <input image>...] [--enable <feature>...] -- "$imagegen <instruction>"
Codex saves generated images under $CODEX_HOME/generated_images (default ~/.codex). The instruction asks
Codex to copy the result into the temp cwd and print `SAVED_TO: <path>`; otherwise we take the newest image
written in the temp cwd, then under $CODEX_HOME/generated_images since the run started.
Extra feature flags can be passed with VV_CODEX_FEATURES (comma-separated, e.g. "image_generation").
"""
from __future__ import annotations

import os
import shutil
import tempfile
import time
from pathlib import Path

from PIL import Image

from .._proc import ProcTimeout, probe_version, run_cli, tail, which
from .base import EditRequest, EngineCaps, EngineError, EngineStatus, GenerateRequest, ImageResult
from .copilot import SIZES, locate_output, nearest_size, save_image

_IMAGE_GLOBS = ("*.png", "*.jpg", "*.jpeg", "*.webp")


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")


def newest_image(dirs: list[Path], since: float, exclude_prefix: str = "vv-input") -> Path | None:
    best: tuple[float, Path] | None = None
    for d in dirs:
        if not d.is_dir():
            continue
        for pattern in _IMAGE_GLOBS:
            for p in d.rglob(pattern):
                if p.name.startswith(exclude_prefix):
                    continue
                try:
                    mtime = p.stat().st_mtime
                except OSError:
                    continue
                if mtime >= since - 1 and (best is None or mtime > best[0]):
                    best = (mtime, p)
    return best[1] if best else None


def build_instruction(prompt: str, size: str, quality: str, inputs: list[str]) -> str:
    w, h = size.split("x")
    if inputs:
        head = (f"$imagegen Edit the attached image {inputs[0]} (keep its exact framing) according to the prompt "
                "below." + (f" Use {', '.join(inputs[1:])} only as style references." if inputs[1:] else ""))
    else:
        head = "$imagegen Generate one image from the prompt below."
    return (
        f"{head}\nSize: {w}x{h} ({'landscape' if int(w) > int(h) else 'portrait' if int(h) > int(w) else 'square'})."
        f" Quality: {quality}.\nPrompt:\n{prompt}\n\n"
        "Generate exactly one image. Then copy the generated file into the current working directory as "
        "vv-output.png and print exactly one final line: SAVED_TO: <absolute path of vv-output.png>. "
        "Do not modify any other files."
    )


class CodexEngine:
    id = "codex"
    label = "Codex CLI ($imagegen)"
    binary = "codex"

    def detect(self) -> EngineStatus:
        try:
            path = which(self.binary)
            if not path:
                return EngineStatus(available=False, detail="codex not found on PATH")
            version, err = probe_version(path)
            return EngineStatus(available=True, logged_in=None, version=version, detail=err)
        except Exception as e:  # noqa: BLE001
            return EngineStatus(available=False, detail=f"detect failed: {e}")

    def capabilities(self) -> EngineCaps:
        return EngineCaps(can_generate=True, can_edit=True, photoreal=True, typical_seconds=60,
                          cost_note="Uses ChatGPT plan quota", max_refs=3, sizes=SIZES)

    def build_argv(self, path: str, instruction: str, cwd: Path, images: list[Path]) -> list[str]:
        argv = [path, "exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "--ephemeral",
                "--color", "never", "-C", str(cwd)]
        for feature in filter(None, (f.strip() for f in os.environ.get("VV_CODEX_FEATURES", "").split(","))):
            argv += ["--enable", feature]
        model = os.environ.get("VV_CODEX_MODEL")
        if model:
            argv += ["-m", model]
        for img in images:
            argv += ["-i", str(img)]
        argv += ["--", instruction]
        return argv

    async def generate(self, req: GenerateRequest) -> ImageResult:
        size = req.size if req.size in SIZES else "1536x1024"
        return await self._run(req.prompt, size, req.quality, [], req.out_path, req.timeout_s)

    async def edit(self, req: EditRequest) -> ImageResult:
        with Image.open(req.input_image) as im:
            size = req.size if req.size in SIZES else nearest_size(*im.size)
        images = [Path(req.input_image), *[Path(r) for r in req.ref_images[:3]]]
        return await self._run(req.prompt, size, req.quality, images, req.out_path, req.timeout_s)

    async def _run(self, prompt: str, size: str, quality: str, images: list[Path], out_path: Path,
                   timeout_s: int) -> ImageResult:
        path = which(self.binary)
        if not path:
            raise EngineError("codex CLI is not installed")
        start_wall, start = time.time(), time.monotonic()
        with tempfile.TemporaryDirectory(prefix="vv-codex-img-") as tmp:
            cwd = Path(tmp).resolve()
            staged = []
            for i, img in enumerate(images):
                dst = cwd / f"vv-input-{i}{Path(img).suffix.lower() or '.png'}"
                shutil.copyfile(img, dst)
                staged.append(dst)
            argv = self.build_argv(path, build_instruction(prompt, size, quality, [p.name for p in staged]),
                                   cwd, staged)
            try:
                res = await run_cli(argv, cwd=cwd, timeout_s=timeout_s)
            except ProcTimeout as e:
                raise EngineError(f"{e}\n{tail(e.stderr)}") from e
            gen_dir = codex_home() / "generated_images"
            found = locate_output(res.stdout, gen_dir, start_wall, cwd)
            if found is None or found.name.startswith("vv-input"):
                found = newest_image([cwd, gen_dir], start_wall)
            if found is None:
                raise EngineError(f"codex produced no image (exit {res.returncode}): "
                                  f"{tail(res.stdout + chr(10) + res.stderr)}")
            out_path = Path(out_path)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            save_image(found, out_path)
        with Image.open(out_path) as im:
            width, height = im.size
        return ImageResult(path=out_path, width=width, height=height, engine=self.id,
                           seconds=time.monotonic() - start, raw_log=res.log())
