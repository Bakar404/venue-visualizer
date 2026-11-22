"""SEC7: the LAN URL uses the address of the default route, never a Docker/VPN/bridge interface."""

import socket

from api import lan

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import adapters, lan_env, phone

INTERFACES = (
    ("docker0", "172.17.0.1"),
    ("utun4", "10.8.0.2"),
    ("bridge100", "192.168.64.1"),
    ("en5", "10.0.0.5"),
    ("en0", "192.168.1.20"),
    ("vboxnet0", "192.168.56.1"),
    ("wg0", "10.66.0.2"),
)


def _route(monkeypatch, address):
    monkeypatch.setattr(lan, "_default_route_address", lambda: address, raising=False)


def test_default_route_address_comes_first_and_virtual_interfaces_are_skipped(monkeypatch):
    adapters(monkeypatch, *INTERFACES)
    _route(monkeypatch, "192.168.1.20")
    assert lan.addresses() == ("192.168.1.20", "10.0.0.5")


def test_without_a_usable_route_the_first_physical_address_wins(monkeypatch):
    adapters(monkeypatch, *INTERFACES)
    _route(monkeypatch, None)
    assert lan.addresses() == ("10.0.0.5", "192.168.1.20")
    _route(monkeypatch, "10.8.0.2")  # Default route through a VPN tunnel.
    assert lan.addresses() == ("10.0.0.5", "192.168.1.20")


def test_route_probe_uses_udp_connect_without_sending(monkeypatch):
    calls = []

    class FakeSocket:
        def __init__(self, family, kind):
            calls.append(("socket", family, kind))

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def connect(self, address):
            calls.append(("connect", address))

        def getsockname(self):
            return ("192.168.1.20", 50000)

        def send(self, *_):
            raise AssertionError("the route probe must not send packets")

        sendto = send

    monkeypatch.setattr(lan.socket, "socket", FakeSocket)
    assert lan._default_route_address() == "192.168.1.20"
    assert calls[0] == ("socket", socket.AF_INET, socket.SOCK_DGRAM)
    assert calls[1][0] == "connect" and not lan.normalize_ip(calls[1][1][0]).is_private


def test_lan_url_and_allowed_hosts_follow_the_route(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    adapters(monkeypatch, *INTERFACES)
    _route(monkeypatch, "192.168.1.20")
    with desktop() as api:
        assert api.get("/api/system/lan").json()["url"] == "http://192.168.1.20:3000"
        assert phone(api.app).get("/api/health", headers={"Host": "192.168.1.20:8000"}).status_code == 200
        assert phone(api.app).get("/api/health", headers={"Host": "172.17.0.1:8000"}).status_code == 400
