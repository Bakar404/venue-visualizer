"""R1: the phone QR code opens the pairing page, not a page that 403s."""

from api import lan

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import HOST, lan_env


def test_qr_encodes_the_pair_url(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    encoded = []
    real = lan.segno.make_qr

    def capture(content, *args, **kwargs):
        encoded.append(content)
        return real(content, *args, **kwargs)

    monkeypatch.setattr(lan.segno, "make_qr", capture)
    with desktop() as api:
        info = api.get("/api/system/lan").json()
    assert encoded == [f"http://{HOST}:3000/pair"]
    assert info["url"] == f"http://{HOST}:3000/pair"
