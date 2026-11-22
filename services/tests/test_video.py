from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline import video
from pipeline.models import VenueSpec
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
        labels = json.loads(user.split("\n", 1)[1])
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
