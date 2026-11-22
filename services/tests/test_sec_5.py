"""SEC5: backend tests can't be used to burn the owner's quota."""

import asyncio
import os
import threading
import time
from types import SimpleNamespace

from api import system
from pipeline.brains.mock import MockBrain

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import lan_env, pair_phone, phone

BRAIN = "/api/system/backends/brain/mock/test"
IMAGE = "/api/system/backends/engine/mock/test"


class Clock:
    def __init__(self, monkeypatch) -> None:
        self.now = 5_000.0
        monkeypatch.setattr(system, "time", SimpleNamespace(monotonic=lambda: self.now, time=time.time))


def test_brain_tests_are_limited_to_one_every_ten_seconds(client, monkeypatch):
    clock = Clock(monkeypatch)
    assert client.post(BRAIN, json={}).json()["ok"] is True
    clock.now += 3
    limited = client.post(BRAIN, json={})
    assert limited.status_code == 429, limited.text
    assert int(limited.headers["Retry-After"]) == 7
    assert client.post("/api/system/backends/engine/mock/test", json={}).status_code == 200  # Other backend.
    clock.now += 7
    assert client.post(BRAIN, json={}).status_code == 200


def test_image_tests_are_limited_to_one_a_minute(client, monkeypatch):
    clock = Clock(monkeypatch)
    assert client.post(IMAGE, json={}).json()["ok"] is True
    clock.now += 59
    limited = client.post(IMAGE, json={})
    assert limited.status_code == 429 and int(limited.headers["Retry-After"]) == 1
    clock.now += 1
    assert client.post(IMAGE, json={}).status_code == 200


def test_one_concurrent_test_per_backend(client, monkeypatch):
    started = threading.Event()

    async def slow(self, *_args, **_kwargs):
        started.set()
        await asyncio.sleep(0.5)
        return {"ok": True}

    monkeypatch.setattr(MockBrain, "complete_json", slow)
    results = []
    first = threading.Thread(target=lambda: results.append(client.post(BRAIN, json={})))
    first.start()
    assert started.wait(5)
    second = client.post(BRAIN, json={})
    first.join()
    assert results[0].status_code == 200
    assert second.status_code == 409, second.text


def test_only_the_last_five_test_images_are_kept(client, tmp_path):
    directory = tmp_path / "data" / "tests"
    directory.mkdir(parents=True, exist_ok=True)
    old = []
    for n in range(6):
        path = directory / f"00000000-0000-4000-8000-00000000000{n}.png"
        path.write_bytes(b"old")
        os.utime(path, (1_000_000 + n, 1_000_000 + n))
        old.append(path)
    result = client.post(IMAGE, json={}).json()
    assert result["ok"] is True
    kept = sorted(p.name for p in directory.glob("*.png"))
    assert len(kept) == 5
    assert result["sample_url"].rsplit("/", 1)[1] in kept
    assert not old[0].exists() and not old[1].exists()
    assert client.get(result["sample_url"]).status_code == 200


def test_paired_devices_must_confirm_credits_for_any_image_test(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    monkeypatch.setenv("VV_DEV", "1")
    with desktop() as api:
        assert phone(api.app, "192.168.10.7").post(IMAGE, json={"confirm_credits": True}).status_code == 403
        device = pair_phone(api)
        response = device.post(IMAGE, json={})
        assert response.status_code == 422, response.text
        assert device.post(IMAGE, json={"confirm_credits": True}).status_code == 200
        assert device.post(BRAIN, json={}).status_code == 200
