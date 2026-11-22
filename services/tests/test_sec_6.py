"""SEC6: the request policy also guards WebSocket upgrades."""

import pytest
from fastapi import WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from api.main import create_app

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import lan_env, pair_phone, phone, proxied

PATH = "/api/ws-probe"


def _app():
    app = create_app()

    @app.websocket(PATH)
    async def probe(websocket: WebSocket) -> None:
        await websocket.accept()
        await websocket.send_text("ok")
        await websocket.close()

    return app


def _accepted(client: TestClient, **headers: str) -> bool:
    try:
        url = str(client.base_url.join(PATH)).replace("http", "ws", 1)
        with client.websocket_connect(url, headers=headers) as ws:
            return ws.receive_text() == "ok"
    except WebSocketDisconnect:
        return False


def test_local_websocket_is_accepted(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch, lan=False, key=False)
    with desktop(_app()) as api:
        assert _accepted(api)
        assert _accepted(api, Origin="http://localhost:3000")


@pytest.mark.parametrize("lan", [False, True])
def test_non_local_websocket_upgrades_are_rejected(setup_machine, monkeypatch, lan):  # noqa: F811
    lan_env(monkeypatch, lan=lan, key=lan)
    with desktop(_app()) as api:
        assert not _accepted(phone(api.app, "192.168.10.4", Host="localhost:8000"))
        assert not _accepted(proxied(api.app, "localhost:3000", **{"X-Forwarded-For": "192.168.10.4"}))
        assert not _accepted(api, Host="evil.example")
        assert not _accepted(api, Origin="https://evil.example")
        if lan:
            assert not _accepted(proxied(api.app, "localhost:3000", "192.168.10.4"))
            assert not _accepted(pair_phone(api))
