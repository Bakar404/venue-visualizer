from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest
from PIL import Image

from pipeline.engines.base import EditRequest, GenerateRequest
from pipeline.engines.copilot import CopilotEngine, build_instruction, locate_output, nearest_size
from pipeline.engines.mflux import MfluxEngine, build_argv, dims_for
from pipeline.engines.mock import MockEngine


async def test_mock_engine_generate(tmp_path: Path):
    res = await MockEngine().generate(GenerateRequest(prompt="empty ballroom", out_path=tmp_path / "o" / "g.png"))
    assert res.path.is_file() and (res.width, res.height) == (1536, 1024) and res.engine == "mock"
    with Image.open(res.path) as im:
        assert im.size == (1536, 1024)


async def test_mock_engine_edit_keeps_size(room: Path, tmp_path: Path):
    res = await MockEngine().edit(EditRequest(prompt="add tables", input_image=room, out_path=tmp_path / "e.png"))
    with Image.open(room) as a, Image.open(res.path) as b:
        assert a.size == b.size == (res.width, res.height)
        assert a.tobytes() != b.tobytes()


def test_nearest_size():
    assert nearest_size(4032, 3024) == "1536x1024"
    assert nearest_size(3024, 4032) == "1024x1536"
    assert nearest_size(1000, 1000) == "1024x1024"


def test_copilot_instruction_carries_exact_args(tmp_path: Path):
    text = build_instruction("Add 12 tables", "1536x1024", "high", [tmp_path / "in.png"])
    args = json.loads(text[text.index("{"): text.rindex("}") + 1])
    assert args == {"prompt": "Add 12 tables", "size": "1536x1024", "quality": "high",
                    "input_images": [{"path": str(tmp_path / "in.png")}]}
    assert "SAVED_TO:" in text and "exactly once" in text


def test_copilot_argv_restricts_tools():
    argv = CopilotEngine().build_argv("/bin/copilot", "do it", "sid-1")
    assert "--available-tools=image_generation" in argv
    assert "--allow-tool=custom-tool(image_generation)" in argv and "--session-id=sid-1" in argv
    assert not any(a.startswith("--allow-all") for a in argv)
    assert "--deny-tool=shell" in argv and "--deny-tool=write" in argv
    assert "--no-ask-user" in argv and "-s" in argv


def _png(path: Path, mtime: float | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8)).save(path)
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def test_locate_output_parses_saved_to(tmp_path: Path):
    states = tmp_path / "session-state"
    target = _png(states / "abc" / "images" / "image-1.png")
    _png(states / "zzz" / "images" / "image-newer.png")
    assert locate_output(f"Done!\nSAVED_TO: {target}\n", states, time.time() - 60) == target
    assert locate_output(f'tool result {{"saved_to": "{target}"}}', states, time.time() - 60) == target


def test_locate_output_ignores_paths_outside_allowed_roots(tmp_path: Path):
    states = tmp_path / "session-state"
    outside = _png(tmp_path / "elsewhere" / "secret.png")
    assert locate_output(f"SAVED_TO: {outside}", states, time.time() - 60) is None


def test_locate_output_falls_back_to_newest_new_png(tmp_path: Path):
    states = tmp_path / "session-state"
    now = time.time()
    _png(states / "old" / "images" / "image-old.png", mtime=now - 3600)
    newest = _png(states / "s2" / "images" / "image-b.png", mtime=now + 2)
    _png(states / "s1" / "images" / "image-a.png", mtime=now + 1)
    _png(states / "s3" / "files" / "not-an-image-output.png", mtime=now + 5)
    assert locate_output("I generated the image.", states, now) == newest
    assert locate_output("SAVED_TO: /does/not/exist.png", states, now) == newest
    assert locate_output("nothing", states, now + 100) is None
    assert locate_output("nothing", tmp_path / "missing", now) is None
    # with a session id, only that session's images folder is considered
    assert locate_output("nothing", states, now, session_id="s1").name == "image-a.png"
    assert locate_output("nothing", states, now, session_id="nope") is None


async def test_copilot_engine_copies_located_output(tmp_path: Path, room: Path, monkeypatch: pytest.MonkeyPatch):
    """Full edit() flow with run_cli faked: the 'CLI' writes into session-state and prints SAVED_TO."""
    from pipeline.engines import copilot as mod

    states = tmp_path / "session-state"
    monkeypatch.setenv("VV_COPILOT_STATE_DIR", str(states))
    monkeypatch.setattr(mod, "which", lambda name: "/usr/local/bin/copilot")
    seen = {}

    async def fake_run_cli(argv, *, cwd, timeout_s, stdin_text=None, env=None):
        from pipeline._proc import ProcResult

        seen["argv"], seen["cwd"] = argv, cwd
        assert any(p.name.startswith("vv-input-0") for p in cwd.iterdir())
        sid = next(a for a in argv if a.startswith("--session-id=")).split("=", 1)[1]
        out = states / sid / "images" / "image-x.png"
        out.parent.mkdir(parents=True)
        Image.new("RGB", (1536, 1024), (200, 150, 100)).save(out)
        return ProcResult(argv, 0, f"SAVED_TO: {out}\n", "", 1.0)

    monkeypatch.setattr(mod, "run_cli", fake_run_cli)
    res = await CopilotEngine().edit(EditRequest(prompt="add tables", input_image=room,
                                                 out_path=tmp_path / "out" / "r.png"))
    assert res.path.is_file() and (res.width, res.height) == (1536, 1024) and res.engine == "copilot"
    assert '"size": "1536x1024"' in seen["argv"][1]
    assert not seen["cwd"].exists()  # temp cwd cleaned up


def test_mflux_argv_and_dims(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    assert dims_for(4032, 3024) == (1024, 768)
    assert all(d % 32 == 0 for d in dims_for(1000, 667))
    gen = build_argv("/x/mflux-generate-flux2", "flux2-klein-4b", "p", tmp_path / "o.png", 1024, 672, [])
    assert gen[:3] == ["/x/mflux-generate-flux2", "--model", "flux2-klein-4b"]
    assert "--width" in gen and "-q" in gen and gen[gen.index("--steps") + 1] == "4"
    edit = build_argv("/x/mflux-generate-qwen-2.1-edit", "qwen-image-2.1", "p", tmp_path / "o.png", 1024, 672,
                      [tmp_path / "in.png"])
    assert edit[1] == "--image-paths" and "--quantize" in edit and "--model" not in edit


def test_mflux_detect_requires_apple_silicon(monkeypatch: pytest.MonkeyPatch):
    from pipeline.engines import mflux as mod

    monkeypatch.setattr(mod, "which", lambda name: f"/opt/bin/{name}")
    monkeypatch.setattr(mod.platform, "system", lambda: "Linux")
    assert not MfluxEngine().detect().available
    monkeypatch.setattr(mod.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(mod.platform, "machine", lambda: "arm64")
    assert MfluxEngine().detect().available
