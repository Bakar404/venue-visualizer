"""SEC2-3 (R2-3): PATCH /api/settings refuses non-owners before it reads the request body.

Validating `providers.claude.config_dir` touches the filesystem, so when the owner check ran after validation a
paired phone could tell an existing directory (403) from a missing one (422). Non-owners now get the same 403
whatever they send. Saved provider paths are re-validated on every read, and that re-validation drops paths
inside the data folder just like a PATCH does.
"""

import json
import os
import stat

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from api.db import database, write_session
from api.settings import preferences, row

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import lan_env, pair_phone, phone, proxied

FORBIDDEN = {"detail": "Change settings on this computer, not from a paired device."}
JSON = {"Content-Type": "application/json"}


def claude_dir(path):
    path.mkdir(parents=True)
    (path / "settings.json").write_text("{}")
    return path


def kimi(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


@pytest.fixture
def lan_api(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    monkeypatch.setenv("VV_ALLOWED_HOSTS", "studio.test")
    with desktop() as api:
        yield api


def non_owners(api: TestClient) -> dict[str, TestClient]:
    return {
        "paired phone": pair_phone(api),
        # This computer's own browser, reached through a non-loopback name: local, but not the owner.
        "named host": proxied(api.app, "studio.test:3000", "127.0.0.1"),
    }


def probe(client: TestClient, body) -> tuple[int, object]:
    content = body if isinstance(body, str) else json.dumps(body)
    response = client.patch("/api/settings", content=content, headers=JSON)
    return response.status_code, response.json()


def test_a_paired_phone_cannot_tell_existing_paths_from_missing_ones(lan_api, setup_machine):  # noqa: F811
    home = setup_machine.home
    existing = claude_dir(home / "work-claude")
    for name, client in non_owners(lan_api).items():
        seen = {
            label: probe(client, {"providers": {"claude": {"config_dir": str(path)}}})
            for label, path in (("existing", existing), ("missing", home / "no-such-dir"),
                                ("outside home", "/etc"), ("relative", "~/../../etc"))
        }
        assert all(result == (403, FORBIDDEN) for result in seen.values()), (name, seen)


def test_a_paired_phone_cannot_probe_executables_either(lan_api, setup_machine):  # noqa: F811
    home = setup_machine.home
    real = kimi(home / "bin" / "kimi")
    for client in non_owners(lan_api).values():
        for path in (real, home / "bin" / "kimi-missing", home / "bin"):
            assert probe(client, {"providers": {"kimi": {"bin": str(path)}}}) == (403, FORBIDDEN)


@pytest.mark.parametrize("body", [
    '{"allow_web_research": "yes"}', '{"zzz": 1}', "{bad", "", "[]", "null",
    '{"lan": {"enabled": true}}', '{"providers": {"claude": {"config_dir": "/"}}}',
])
def test_non_owners_get_the_same_403_for_any_body(lan_api, body):
    for client in non_owners(lan_api).values():
        assert probe(client, body) == (403, FORBIDDEN)


def test_the_body_is_never_read_for_non_owners(lan_api, monkeypatch):
    clients = non_owners(lan_api)

    async def explode(*_args, **_kwargs):
        raise AssertionError("read a non-owner's request body")

    for method in ("body", "json", "form", "stream"):
        monkeypatch.setattr(Request, method, explode)
    for client in clients.values():
        assert probe(client, '{"allow_web_research": false}') == (403, FORBIDDEN)


def test_unpaired_devices_are_still_refused(lan_api):
    stranger = phone(lan_api.app, "192.168.10.9")
    assert stranger.patch("/api/settings", json={"allow_web_research": False}).status_code == 403


def test_the_owner_still_gets_precise_validation_errors(lan_api, setup_machine):  # noqa: F811
    home = setup_machine.home
    expected = {
        '{"providers":{"claude":{"config_dir":"/nope"}}}': "body.providers.claude.config_dir: Value error, Claude "
        "config_dir must be an existing Claude configuration directory under your home folder (containing "
        ".claude.json or settings.json)",
        "{bad": "body.1: JSON decode error",
        "": "body: Field required",
        "[]": "body: Input should be a valid dictionary or object to extract fields from",
        "null": "body: Input should be a valid dictionary or object to extract fields from",
        '{"allow_web_research":"yes"}': "body.allow_web_research: Input should be a valid boolean",
        '{"zzz":1}': "body.zzz: Extra inputs are not permitted",
    }
    for body, detail in expected.items():
        assert probe(lan_api, body) == (422, {"detail": detail}), body
    valid = claude_dir(home / "work-claude")
    status, saved = probe(lan_api, {"providers": {"claude": {"config_dir": str(valid)}},
                                    "setup_completed_at": "2026-01-02T03:04:05+01:00"})
    assert status == 200, saved
    assert saved["providers"]["claude"]["config_dir"] == str(valid.resolve())
    assert saved["setup_completed_at"] == "2026-01-02T02:04:05Z"
    assert lan_api.get("/api/settings").json() == saved


def test_the_openapi_contract_still_documents_the_body():
    from api.main import create_app

    operation = create_app().openapi()["paths"]["/api/settings"]["patch"]
    schema = operation["requestBody"]["content"]["application/json"]["schema"]
    assert schema == {"$ref": "#/components/schemas/SettingsPatch"}
    assert "422" in operation["responses"]


# --- re-validation of saved paths drops anything inside the data folder ----------------------------------------

def test_saved_paths_inside_the_data_folder_are_dropped_on_read(setup_machine, monkeypatch):  # noqa: F811
    home = setup_machine.home
    data = home / "vv-data"
    monkeypatch.setenv("VV_DATA_DIR", str(data))
    planted_dir = claude_dir(data / "claude")
    planted_bin = kimi(data / "bin" / "kimi")
    outside_dir = claude_dir(home / "work-claude")
    outside_bin = kimi(home / "bin" / "kimi")
    with desktop() as api:
        engine = database(data)
        try:
            def save(config_dir, bin_path):
                # As if written by an older version that didn't refuse these paths.
                with write_session(engine) as session:
                    saved = row(session)
                    saved.values_json = {**saved.values_json, "preferences": {"providers": {
                        "claude": {"config_dir": str(config_dir)}, "kimi": {"bin": str(bin_path)},
                    }}}
                    session.add(saved)
                with write_session(engine) as session:
                    return preferences(row(session)).providers

            providers = save(planted_dir, planted_bin)
            assert providers.claude.config_dir is None and providers.kimi.bin is None
            got = api.get("/api/settings").json()["providers"]
            assert got["claude"]["config_dir"] is None and got["kimi"]["bin"] is None

            providers = save(outside_dir, outside_bin)
            assert providers.claude.config_dir == str(outside_dir.resolve())
            assert providers.kimi.bin == str(outside_bin.resolve())

            # A symlink outside the data folder that resolves into it is dropped too.
            link = home / "claude-link"
            link.symlink_to(planted_dir)
            providers = save(link, outside_bin)
            assert providers.claude.config_dir is None and providers.kimi.bin == str(outside_bin.resolve())

            # An explicit data folder wins over the environment.
            with write_session(engine) as session:
                kept = preferences(row(session), data_dir=home / "elsewhere").providers.claude.config_dir
            assert kept == str(planted_dir.resolve())
        finally:
            engine.dispose()


def test_a_patch_still_refuses_paths_inside_the_data_folder(setup_machine, monkeypatch):  # noqa: F811
    home = setup_machine.home
    data = home / "vv-data"
    monkeypatch.setenv("VV_DATA_DIR", str(data))
    planted = claude_dir(data / "claude")
    with desktop() as api:
        status, body = probe(api, {"providers": {"claude": {"config_dir": str(planted)}}})
        assert status == 422 and "data folder" in body["detail"]
    assert os.path.isdir(planted)
