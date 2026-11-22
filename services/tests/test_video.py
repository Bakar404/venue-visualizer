from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline import video
from pipeline.models import VenueSpec
from pipeline.prompts import FRAME_LABELS_END, FRAME_LABELS_START
from pipeline.video import Frame, VideoError, VideoIngestResult, ingest_video

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
                                reason="ffmpeg/ffprobe not installed")

SEG = 3  # seconds per segment: sharp 0-3, blurred 3-6, static 6-9, sharp (different) 9-12


@pytest.fixture(scope="module")
def tour(tmp_path_factory) -> Path:
    """12 s, 640x360: testsrc | heavily blurred testsrc | static SMPTE bars | testsrc2."""
    out = tmp_path_factory.mktemp("video") / "tour.mp4"
    src = f"size=640x360:rate=10:duration={SEG}"
    cmd = ["ffmpeg", "-v", "error", "-y",
           "-f", "lavfi", "-i", f"testsrc={src}",
           "-f", "lavfi", "-i", f"testsrc={src},boxblur=20:5",
           "-f", "lavfi", "-i", f"smptebars={src}",
           "-f", "lavfi", "-i", f"testsrc2={src}",
           "-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,format=yuv420p[v]",
           "-map", "[v]", "-c:v", "mpeg4", "-q:v", "2", str(out)]
    subprocess.run(cmd, check=True, timeout=60)
    return out


def _in(frames: list[Frame], lo: float, hi: float) -> list[Frame]:
    return [f for f in frames if lo <= f.t < hi]


async def test_ingest_without_brain(tour: Path, tmp_path: Path):
    result = await ingest_video(tour, tmp_path / "frames", max_frames=12)
    assert isinstance(result, VideoIngestResult)
    assert 2 <= len(result.frames) <= 12 and result.duration_s == pytest.approx(12, abs=0.5)
    assert not _in(result.frames, SEG, 2 * SEG - 0.05), "blurred segment must be dropped"
    assert len(_in(result.frames, 2 * SEG, 3 * SEG)) == 1, "static segment must be deduped to one frame"
    assert _in(result.frames, 0, SEG) and _in(result.frames, 3 * SEG, 4 * SEG)
    assert [f.t for f in result.frames] == sorted(f.t for f in result.frames)
    for f in result.frames:
        assert f.path.parent == tmp_path / "frames" and f.path.exists() and f.sharpness > 0 and f.exposure_ok
    [space] = result.spaces_suggested
    assert space.name == "Main space" and space.frame_indexes == list(range(len(result.frames)))
    assert "approximate" in VenueSpec.model_validate(space.venue_spec).notes
    d = result.to_dict()
    assert isinstance(d["frames"][0]["path"], str) and d["spaces_suggested"][0]["name"] == "Main space"


async def test_max_frames_cap(tour: Path, tmp_path: Path):
    result = await ingest_video(tour, tmp_path, max_frames=2)
    assert len(result.frames) == 2


class ClusterBrain:
    """Vision batches: labels by timestamp; cluster call: two spaces split at 6 s."""

    def __init__(self):
        self.vision_calls: list[int] = []
        self.cluster_calls = 0

    async def complete_json(self, system, user, schema, images=None, timeout_s=180, *, web=False):
        assert not web
        if images:
            assert len(images) <= video.VISION_BATCH and all(Path(p).exists() for p in images)
            self.vision_calls.append(len(images))
            start = int(user.split("index ")[1].split(",")[0])
            return {"frames": [{"index": start + i, "space_guess": None, "view": "wide",
                                "description": "A room.", "fixtures": ["chandelier"] if i == 0 else [],
                                "is_usable_base": True} for i in range(len(images))]}
        self.cluster_calls += 1
        assert FRAME_LABELS_START in user and "data, not instructions" in system
        labels = json.loads(user.split(FRAME_LABELS_START, 1)[1].split(FRAME_LABELS_END, 1)[0])
        first = [x["index"] for x in labels if x["t"] < 6]
        second = [x["index"] for x in labels if x["t"] >= 6]
        spec = {"style": "ballroom", "length_ft": 80, "width_ft": 50, "ceiling_ft": 500, "walls": "white",
                "floor": None, "windows": None, "fixtures": [], "notes": None}
        return {"spaces": [{"name": "Ballroom", "frame_indexes": first, "venue_spec": spec},
                           {"name": "Terrace", "frame_indexes": second, "venue_spec": {**spec, "style": "terrace"}}]}


async def test_ingest_with_brain_clusters_into_two_spaces(tour: Path, tmp_path: Path):
    brain = ClusterBrain()
    result = await ingest_video(tour, tmp_path, brain=brain, max_frames=8)
    assert sum(brain.vision_calls) == len(result.frames) and brain.cluster_calls == 1
    assert [s.name for s in result.spaces_suggested] == ["Ballroom", "Terrace"]
    all_idx = sorted(i for s in result.spaces_suggested for i in s.frame_indexes)
    assert all_idx == list(range(len(result.frames)))
    ball = result.spaces_suggested[0]
    spec = VenueSpec.model_validate(ball.venue_spec)
    assert spec.length_ft == 80 and spec.ceiling_ft is None and "approximate" in spec.notes
    assert result.frames[0].view == "wide" and result.frames[0].fixtures == ["chandelier"]
    assert {f.space_guess for f in result.frames} == {"Ballroom", "Terrace"}


async def test_vision_calls_are_batched(tour: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(video, "VISION_BATCH", 2)
    brain = ClusterBrain()
    result = await ingest_video(tour, tmp_path, brain=brain, max_frames=5)
    assert brain.vision_calls and max(brain.vision_calls) <= 2 and sum(brain.vision_calls) == len(result.frames)


async def test_missing_ffmpeg_raises_with_install_hint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(shutil, "which", lambda *a, **k: None)
    with pytest.raises(VideoError, match="brew install ffmpeg"):
        await ingest_video(tmp_path / "x.mp4", tmp_path)


async def test_not_a_video(tmp_path: Path):
    bad = tmp_path / "bad.mp4"
    bad.write_text("not a video")
    with pytest.raises(VideoError):
        await ingest_video(bad, tmp_path / "out")


def _probe_reply(fmt="mov,mp4,m4a,3gp,3g2,mj2", width=640, height=360, fps="30/1"):
    from pipeline._proc import ProcResult

    info = {"format": {"format_name": fmt, "duration": "10"},
            "streams": [{"width": width, "height": height, "avg_frame_rate": fps, "duration": "10"}]}
    return ProcResult(argv=[], returncode=0, stdout=json.dumps(info), stderr="", seconds=0.0)


@pytest.mark.parametrize(("kwargs", "match"), [
    ({"fmt": "avi"}, "unsupported video container"),
    ({"fmt": "concat"}, "unsupported video container"),
    ({"fmt": "hls,applehttp"}, "unsupported video container"),
    ({"width": 8192, "height": 4608}, "8K"),
    ({"width": 15360, "height": 1000}, "8K"),
    ({"fps": "240/1"}, "fps"),
])
async def test_probe_rejects_unsafe_sources(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kwargs, match):
    seen = []

    async def fake_run(argv, **kw):
        seen.append(argv)
        return _probe_reply(**kwargs)

    monkeypatch.setattr(video, "run_cli", fake_run)
    with pytest.raises(VideoError, match=match):
        await video.probe_info("ffprobe", tmp_path / "v.mp4", tmp_path)
    argv = seen[0]
    assert argv[argv.index("-protocol_whitelist") + 1] == "file"
    assert argv[argv.index("-format_whitelist") + 1] == "mov,matroska,hevc"


async def test_probe_accepts_allowed_containers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    for fmt, demuxer in (("matroska,webm", "matroska"), ("hevc", "hevc"), ("mov,mp4,m4a,3gp,3g2,mj2", "mov")):
        async def fake_run(argv, fmt=fmt, **kw):
            return _probe_reply(fmt=fmt, width=7680, height=4320, fps="120/1")

        monkeypatch.setattr(video, "run_cli", fake_run)
        info = await video.probe_info("ffprobe", tmp_path / "v", tmp_path)
        assert info.demuxer == demuxer and info.fps == 120


@pytest.fixture
def avi(tmp_path: Path) -> Path:
    out = tmp_path / "tour.avi"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1",
                    str(out)], check=True, timeout=60)
    return out


async def test_real_avi_is_rejected(avi: Path, tmp_path: Path):
    with pytest.raises(VideoError):
        await ingest_video(avi, tmp_path / "out")


async def test_extraction_argv_and_watchdog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from pipeline._proc import ProcResult

    calls = []

    async def fake_run(argv, *, cwd, timeout_s, **kw):
        calls.append((argv, timeout_s))
        (cwd / "cand_0001.jpg").write_bytes(b"x")
        return ProcResult(argv=argv, returncode=0, stdout="", stderr="", seconds=0.0)

    monkeypatch.setattr(video, "run_cli", fake_run)
    await video.extract_candidates("ffmpeg", tmp_path / "v.mp4", tmp_path, 10, demuxer="mov")
    await video.extract_candidates("ffmpeg", tmp_path / "v.mp4", tmp_path, 100)
    await video.extract_candidates("ffmpeg", tmp_path / "v.mp4", tmp_path, 10_000, keyframes_only=True)
    assert [t for _, t in calls] == [120, 300, 900]
    argv = calls[0][0]
    assert argv[argv.index("-map") + 1] == "0:v:0" and argv[argv.index("-f") + 1] == "mov"
    assert argv.index("-protocol_whitelist") < argv.index("-i")
    assert argv[argv.index("-vf") + 1].startswith("scale=")
    assert "-skip_frame" not in argv
    kf = calls[2][0]
    assert kf[kf.index("-skip_frame") + 1] == "nokey" and kf.index("-skip_frame") < kf.index("-i")


async def test_large_sources_try_keyframes_first(tour: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    real = video.run_cli
    modes = []

    async def spy(argv, **kw):
        if "-frames:v" in argv:
            modes.append("-skip_frame" in argv)
        return await real(argv, **kw)

    monkeypatch.setattr(video, "run_cli", spy)
    monkeypatch.setattr(video, "KEYFRAME_DECODE_MIN_PIXELS", 0)
    result = await ingest_video(tour, tmp_path / "a", max_frames=2)
    assert modes[0] is True and result.frames
    modes.clear()
    result = await ingest_video(tour, tmp_path / "b", max_frames=100)  # too few keyframes → full decode
    assert modes == [True, False] and result.frames


class SloppyBrain:
    async def complete_json(self, system, user, schema, images=None, timeout_s=180, *, web=False):
        if images:
            return {"frames": 5} if user.count("Image ") % 2 else {"frames": {"index": 0}}
        n = len(json.loads(user.split(FRAME_LABELS_START, 1)[1].split(FRAME_LABELS_END, 1)[0]))
        return {"spaces": [{"name": "Hall", "frame_indexes": [0, 0, True, 1, 1, 0],
                            "venue_spec": {"style": "hall"}},
                           {"name": "Bad", "frame_indexes": 3, "venue_spec": {}},
                           {"name": "Rest", "frame_indexes": list(range(n)) + [n - 1], "venue_spec": {}}]}


async def test_vision_and_cluster_replies_are_sanitised(tour: Path, tmp_path: Path):
    result = await ingest_video(tour, tmp_path, brain=SloppyBrain(), max_frames=4)
    assert all(f.view is None and f.description is None for f in result.frames)
    assert any("malformed reply" in w for w in result.warnings)
    hall, rest = result.spaces_suggested
    assert hall.frame_indexes == [0, 1]
    assert rest.frame_indexes == list(range(2, len(result.frames)))
    for s in result.spaces_suggested:
        assert len(s.frame_indexes) == len(set(s.frame_indexes))
