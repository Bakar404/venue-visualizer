"""R4: the API tells the web whether it is talking to the owner's computer or a paired phone."""

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture
from .sec_helpers import lan_env, pair_phone


def test_setup_reports_the_client(setup_machine, monkeypatch):  # noqa: F811
    lan_env(monkeypatch)
    with desktop() as api:
        assert api.get("/api/system/setup").json()["client"] == "owner"
        device = pair_phone(api)
        assert device.get("/api/system/setup").json()["client"] == "phone"
