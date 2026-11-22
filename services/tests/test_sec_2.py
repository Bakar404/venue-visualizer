"""SEC2: only `make dev-lan` opens LAN mode; the Setup toggle can no longer lock the owner out."""

import os
import subprocess
import sys
from pathlib import Path

from sqlmodel import Session

from api.db import database
from api.models import Settings

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import HOST, lan_env, phone

RESTART = "Restart with `make dev-lan` to open the app on your phone"
SERVICES = Path(__file__).resolve().parents[1]


_POPEN = subprocess.Popen


def _store_legacy_toggle(data_dir: Path) -> None:
    engine = database(data_dir)
    try:
        with Session(engine) as session:
            saved = session.get(Settings, 1)
            prefs = saved.values_json.get("preferences", {})
            saved.values_json = {**saved.values_json, "preferences": {**prefs, "lan": {"enabled": True}}}
            session.add(saved)
            session.commit()
    finally:
        engine.dispose()


def _bind_address(data_dir: Path, **env: str) -> str:
    clean = {k: v for k, v in os.environ.items() if k not in ("VV_LAN", "VV_LAN_PROXY_KEY")}
    # setup_machine replaces subprocess.Popen, so use the real one captured at import.
    with _POPEN([sys.executable, "-m", "api.lan"], cwd=SERVICES, stdout=subprocess.PIPE, text=True,
                env={**clean, "VV_DATA_DIR": str(data_dir), **env}) as process:
        output, _ = process.communicate(timeout=60)
    assert process.returncode == 0
    return output.strip()


def test_settings_cannot_turn_lan_mode_on(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch, lan=False, key=False)
    with desktop() as api:
        response = api.patch("/api/settings", json={"lan": {"enabled": True}})
        assert response.status_code == 422, response.text
        assert RESTART in response.json()["detail"]
        assert api.get("/api/settings").json()["lan"] == {"enabled": False}
        assert api.get("/api/system/lan").json()["enabled"] is False
        assert api.get("/api/venues").status_code == 200
        # Unchanged values are not a change.
        assert api.patch("/api/settings", json={"lan": {"enabled": False}}).status_code == 200


def test_saved_toggle_from_older_versions_is_ignored(setup_machine, tmp_path, monkeypatch):  # noqa: F811
    lan_env(monkeypatch, lan=False, key=False)
    with desktop() as api:
        assert api.get("/api/health").status_code == 200
    _store_legacy_toggle(tmp_path / "data")
    with desktop() as api:
        assert api.get("/api/settings").json()["lan"] == {"enabled": False}
        assert api.get("/api/system/lan").json()["enabled"] is False
        assert phone(api.app).get("/api/health").status_code == 400
        assert api.get("/api/venues").status_code == 200
    assert _bind_address(tmp_path / "data") == "127.0.0.1"


def test_lan_mode_needs_the_make_dev_lan_environment(setup_machine, tmp_path, monkeypatch):  # noqa: F811
    lan_env(monkeypatch, lan=True, key=False)
    with desktop() as api:
        assert api.get("/api/settings").json()["lan"] == {"enabled": False}
        assert api.get("/api/system/lan").json()["enabled"] is False
    assert _bind_address(tmp_path / "data", VV_LAN="1") == "127.0.0.1"

    lan_env(monkeypatch)
    with desktop() as api:
        assert api.get("/api/settings").json()["lan"] == {"enabled": True}
        assert api.get("/api/system/lan").json()["url"] == f"http://{HOST}:3000/pair"
        response = api.patch("/api/settings", json={"lan": {"enabled": False}})
        assert response.status_code == 422 and RESTART in response.json()["detail"]
        assert api.get("/api/settings").json()["lan"] == {"enabled": True}
    assert _bind_address(tmp_path / "data", VV_LAN="1", VV_LAN_PROXY_KEY="k") == "0.0.0.0"
