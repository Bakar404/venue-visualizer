"""Local Apple Silicon diffusion via the mflux CLI (https://github.com/mflux-community/mflux). Free but slow.

Model from VV_MFLUX_MODEL (default "flux2-klein-4b"):
  * FLUX.2 Klein (flux2-klein-4b | flux2-klein-9b | flux2-klein-9b-kv):
      mflux-generate-flux2      --model M --prompt=P --width W --height H --steps 4 --seed S -q 4 --output OUT
      mflux-generate-flux2-edit --model M --image-paths IN [REF...] --prompt=P --steps 4 --seed S -q 4 --output OUT
  * Qwen-Image 2.1 edit (qwen-image-2.1 | qwen-2.1 | qwen-image-21 | qwen*):
      mflux-generate-qwen-2.1-edit [--image-paths IN [REF...]] --prompt=P --width W --height H --seed S
                                   --quantize 4 --output OUT        (no --image-paths = text-to-image)
VV_MFLUX_STEPS overrides the step count; VV_MFLUX_SEED the seed (default 7). The first run downloads weights.
detect() only checks platform + PATH (importing MLX for `--version` would take several seconds).
"""
from __future__ import annotations

import os
import platform
import shutil
import tempfile
import time
from pathlib import Path

from PIL import Image

from .._proc import ProcTimeout, run_cli, tail, which
from .base import EditRequest, EngineCaps, EngineError, EngineStatus, GenerateRequest, ImageResult

DEFAULT_MODEL = "flux2-klein-4b"
LONG_SIDE = 1024


def model_name() -> str:
    return (os.environ.get("VV_MFLUX_MODEL") or DEFAULT_MODEL).strip()


def is_qwen(model: str) -> bool:
    return model.lower().startswith("qwen")


def commands(model: str) -> tuple[str, str]:
    """(generate command, edit command) for a model."""
    if is_qwen(model):
        return "mflux-generate-qwen-2.1-edit", "mflux-generate-qwen-2.1-edit"
    return "mflux-generate-flux2", "mflux-generate-flux2-edit"


def dims_for(width: int, height: int, long_side: int = LONG_SIDE) -> tuple[int, int]:
    """Scale so the long side is `long_side`, both sides multiples of 32 (keeps the aspect ratio)."""
    scale = long_side / max(width, height)
    return (max(32, round(width * scale / 32) * 32), max(32, round(height * scale / 32) * 32))


def _size_dims(size: str) -> tuple[int, int]:
    if size in ("1024x1024", "1536x1024", "1024x1536"):
        w, h = (int(x) for x in size.split("x"))
        return dims_for(w, h)
    return dims_for(1536, 1024)


def build_argv(cmd_path: str, model: str, prompt: str, out: Path, width: int, height: int,
               images: list[Path]) -> list[str]:
    seed = os.environ.get("VV_MFLUX_SEED", "7")
    steps = os.environ.get("VV_MFLUX_STEPS")
    if is_qwen(model):
        argv = [cmd_path]
        if images:
            argv += ["--image-paths", *[str(p) for p in images]]
        argv += [f"--prompt={prompt}", "--width", str(width), "--height", str(height), "--seed", seed,
                 "--quantize", "4", "--output", str(out)]
        if steps:
            argv += ["--steps", steps]
        return argv
    argv = [cmd_path, "--model", model]
    if images:
        argv += ["--image-paths", *[str(p) for p in images]]
    else:
        argv += ["--width", str(width), "--height", str(height)]
    argv += [f"--prompt={prompt}", "--steps", steps or "4", "--seed", seed, "-q", "4", "--output", str(out)]
    return argv


class MfluxEngine:
    id = "mflux"
    label = "mflux (local FLUX.2 / Qwen-Image)"

    def detect(self) -> EngineStatus:
        try:
            if platform.system() != "Darwin" or platform.machine() != "arm64":
                return EngineStatus(available=False, detail="mflux needs an Apple Silicon Mac")
            model = model_name()
            missing = [c for c in dict.fromkeys(commands(model)) if not which(c)]
            if missing:
                return EngineStatus(available=False, detail=f"{', '.join(missing)} not found on PATH "
                                                           "(uv tool install mflux)")
            return EngineStatus(available=True, logged_in=None, version=None, detail=f"model {model}")
        except Exception as e:  # noqa: BLE001
            return EngineStatus(available=False, detail=f"detect failed: {e}")

    def capabilities(self) -> EngineCaps:
        return EngineCaps(can_generate=True, can_edit=True, photoreal=True, typical_seconds=180,
                          cost_note="Free (runs locally on this Mac)", max_refs=2,
                          sizes=("1024x1024", "1536x1024", "1024x1536"))

    async def generate(self, req: GenerateRequest) -> ImageResult:
        w, h = _size_dims(req.size)
        refs = req.ref_images[:2]
        return await self._run(1 if refs else 0, req.prompt, w, h, refs, req.out_path, req.timeout_s)

    async def edit(self, req: EditRequest) -> ImageResult:
        if req.size in ("1024x1024", "1536x1024", "1024x1536"):
            w, h = _size_dims(req.size)
        else:
            with Image.open(req.input_image) as im:
                w, h = dims_for(*im.size)
        images = [Path(req.input_image), *[Path(r) for r in req.ref_images[:2]]]
        return await self._run(1, req.prompt, w, h, images, req.out_path, req.timeout_s)

    async def _run(self, which_cmd: int, prompt: str, width: int, height: int, images: list[Path],
                   out_path: Path, timeout_s: int) -> ImageResult:
        model = model_name()
        cmd = commands(model)[which_cmd]
        cmd_path = which(cmd)
        if not cmd_path:
            raise EngineError(f"{cmd} is not installed")
        start = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="vv-mflux-") as tmp:
            cwd = Path(tmp)
            staged = []
            for i, img in enumerate(images):
                dst = cwd / f"input-{i}.png"
                with Image.open(img) as im:
                    im.convert("RGB").save(dst)
                staged.append(dst)
            out = cwd / "output.png"
            argv = build_argv(cmd_path, model, prompt, out, width, height, staged)
            try:
                res = await run_cli(argv, cwd=cwd, timeout_s=timeout_s)
            except ProcTimeout as e:
                raise EngineError(f"{e}\n{tail(e.stderr)}") from e
            if res.returncode != 0 or not out.is_file():
                raise EngineError(f"{cmd} failed (exit {res.returncode}): {tail(res.stderr or res.stdout)}")
            out_path = Path(out_path)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(out, out_path)
        with Image.open(out_path) as im:
            w, h = im.size
        return ImageResult(path=out_path, width=w, height=h, engine=self.id, seconds=time.monotonic() - start,
                           raw_log=res.log())
