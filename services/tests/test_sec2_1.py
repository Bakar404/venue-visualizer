"""SEC2-1 (R2-1, HIGH): a proxied request is never trusted because of the socket it arrived on.

Next.js copies the browser's Host into X-Forwarded-Host, so a Wi-Fi device that reaches a Next server bound to
0.0.0.0 with `Host: localhost:3000` used to look exactly like the owner's browser. A request that came through a
proxy (any forwarded header, or a Host that isn't the API's own) is now local only with a valid X-VV-Client
attestation for a loopback client, signed with a key that the API and services/api/lan_proxy.cjs always share.
"""

import asyncio
import hmac
import json
import logging
import re
import shutil
import stat
import subprocess
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import lan
from api.main import create_app

from .sec_helpers import HOST, adapters

REPO = Path(__file__).resolve().parents[2]
SHIM = REPO / "services" / "api" / "lan_proxy.cjs"
WRAPPER = REPO / "scripts" / "next-with-shim.mjs"
KEY_FILE = ".vv-proxy-key"
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node is not installed")
OWNER_ONLY = ("/api/system/lan", "/api/system/lan/devices")
LOCAL_WEB = "pnpm --filter web dev --hostname 127.0.0.1"

# Load the shim, then ask a shimmed server what X-VV-Client it attests for this loopback client (sending a forged one).
ATTEST_JS = f"""
require({json.dumps(str(SHIM))});
const http = require("node:http");
const server = http.createServer((req, res) => res.end(String(req.headers["x-vv-client"] ?? "")));
server.listen(0, "127.0.0.1", () => {{
  http.get({{ host: "127.0.0.1", port: server.address().port, headers: {{ "x-vv-client": "127.0.0.1.forged" }} }},
    (res) => {{ let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => {{
      process.stdout.write(body); server.close(); }}); }});
}});
"""


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    data = tmp_path / "data"
    monkeypatch.setenv("VV_DATA_DIR", str(data))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    for key in ("VV_LAN", "VV_LAN_PROXY_KEY", "VV_ALLOWED_HOSTS", "VV_WEB_URL", "NODE_OPTIONS"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("VV_DEV", "1")
    monkeypatch.setenv("VV_DEFAULT_ENGINE", "mock")
    monkeypatch.setenv("VV_DEFAULT_BRAIN", "mock")
    monkeypatch.setattr(shutil, "which", lambda *_args, **_kwargs: None)
    adapters(monkeypatch, ("en0", HOST))
    return data


def api(base_url: str = "http://localhost:8000", client: str = "127.0.0.1") -> TestClient:
    return TestClient(create_app(), base_url=base_url, client=(client, 54321))


def sign(key: str, ip: str) -> str:
    return f"{ip}.{hmac.digest(key.encode(), ip.encode(), 'sha256').hex()}"


def via_next(app, forwarded_host: str = "localhost:3000", claim: str | None = None, **headers: str) -> TestClient:
    """What Next's rewrite proxy sends: loopback socket, Host rewritten to the API, the browser's Host forwarded."""
    sent = {"Host": "127.0.0.1:8000", "X-Forwarded-Host": forwarded_host, **headers}
    if claim is not None:
        sent["X-VV-Client"] = claim
    return TestClient(app, base_url="http://127.0.0.1:8000", client=("127.0.0.1", 54400), headers=sent)


def file_key(data: Path) -> str:
    return (data / KEY_FILE).read_text().strip()


def node(script: str, data: Path | None, cwd: Path | None = None, **env: str) -> str:
    environ = {"PATH": str(Path(NODE).parent), "HOME": str(data.parent if data else REPO), **env}
    if data is not None:
        environ["VV_DATA_DIR"] = str(data)
    result = subprocess.run([NODE, "-e", script], cwd=cwd or REPO, env=environ, capture_output=True, text=True, check=False,
                            timeout=30)
    assert result.returncode == 0, result.stderr
    return result.stdout


def mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


# --- (a) the exploit and the trust rule ------------------------------------------------------------------------------

@pytest.mark.parametrize("forwarded", ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])
def test_forged_loopback_forwarded_host_without_attestation_is_not_local(data_dir, forwarded):
    with api() as desktop:
        forged = via_next(desktop.app, forwarded)
        assert forged.get("/api/settings").status_code == 403
        for path in OWNER_ONLY:
            assert forged.get(path).status_code == 403, path
        assert forged.patch("/api/settings", json={"allow_web_research": False}).status_code == 403
        assert forged.delete("/api/system/lan/devices").status_code == 403
        assert desktop.get("/api/settings").json()["allow_web_research"] is True


def test_the_live_check_request_is_refused(data_dir):
    with TestClient(create_app(), base_url="http://127.0.0.1:8123", client=("127.0.0.1", 54402),
                    headers={"Host": "localhost:3123", "X-Forwarded-Host": "localhost:3123"}) as forged:
        assert forged.get("/api/settings").status_code == 403


@pytest.mark.parametrize("headers", [
    {"Host": "localhost:3000"},  # a relayed request whose Host names the web, not the API
    {"X-Forwarded-For": "127.0.0.1"},
    {"X-Forwarded-Proto": "http"},
    {"Forwarded": "for=127.0.0.1;host=localhost:3000"},
])
def test_any_sign_of_a_proxy_needs_an_attestation(data_dir, headers):
    with api() as desktop:
        relayed = TestClient(desktop.app, base_url="http://localhost:8000", client=("127.0.0.1", 54403),
                             headers=headers)
        assert relayed.get("/api/settings").status_code == 403


@pytest.mark.parametrize("base_url", ["http://127.0.0.1:8000", "http://localhost:8000", "http://[::1]:8000"])
def test_a_direct_loopback_request_is_still_local_and_owner(data_dir, base_url):
    with api(base_url, "::1" if "[" in base_url else "127.0.0.1") as desktop:
        assert desktop.get("/api/settings").status_code == 200
        for path in OWNER_ONLY:
            assert desktop.get(path).status_code == 200, path
        assert desktop.patch("/api/settings", json={"allow_web_research": False}).status_code == 200


@pytest.mark.parametrize("client_ip", ["127.0.0.1", "::1"])
def test_a_valid_attestation_for_a_loopback_client_is_local_and_owner(data_dir, client_ip):
    with api() as desktop:
        attested = via_next(desktop.app, "localhost:3000", sign(file_key(data_dir), client_ip))
        assert attested.get("/api/settings").status_code == 200
        for path in OWNER_ONLY:
            assert attested.get(path).status_code == 200, path
        assert attested.patch("/api/settings", json={"allow_web_research": False}).status_code == 200
        wrong_key = via_next(desktop.app, "localhost:3000", sign("0" * 64, client_ip))
        assert wrong_key.get("/api/settings").status_code == 403


def test_an_attestation_for_a_lan_ip_is_not_local_unless_paired(data_dir, monkeypatch):
    with api() as desktop:
        # LAN mode is off: a Wi-Fi client is never local, whatever Host it sent.
        lan_off = via_next(desktop.app, "localhost:3000", sign(file_key(data_dir), "192.168.10.4"))
        assert lan_off.get("/api/venues").status_code == 403

    monkeypatch.setenv("VV_LAN", "1")
    monkeypatch.setenv("VV_LAN_PROXY_KEY", "per-run-key")
    with api() as desktop:
        phone = via_next(desktop.app, f"{HOST}:3000", sign("per-run-key", "192.168.10.4"))
        assert phone.get("/api/venues").status_code == 403
        code = desktop.get("/api/system/lan").json()["pairing_code"]
        assert phone.post("/api/system/lan/pair", json={"code": code}).status_code == 200
        assert phone.get("/api/venues").status_code == 200
        assert phone.get("/api/settings").status_code == 200
        assert phone.patch("/api/settings", json={"allow_web_research": False}).status_code == 403
        for path in OWNER_ONLY:
            assert phone.get(path).status_code == 403, path
        # The phone's Host can't make it the owner either.
        spoof = via_next(desktop.app, "localhost:3000", sign("per-run-key", "192.168.10.4"),
                         Cookie=f"{lan.COOKIE}={phone.cookies[lan.COOKIE]}")
        assert spoof.get("/api/system/lan").status_code == 403


# --- (b) the shared attestation key ----------------------------------------------------------------------------------

def test_the_api_creates_a_private_key_file_and_keeps_it(data_dir):
    with api():
        pass
    key_file = data_dir / KEY_FILE
    assert re.fullmatch(r"[0-9a-f]{64}", file_key(data_dir))
    assert mode(key_file) == 0o600
    assert sorted(p.name for p in data_dir.iterdir() if p.name.startswith(KEY_FILE)) == [KEY_FILE]
    first = file_key(data_dir)
    with api():
        pass
    assert file_key(data_dir) == first


def test_a_loose_key_file_is_tightened(data_dir):
    data_dir.mkdir(parents=True)
    (data_dir / KEY_FILE).write_text("ab" * 32 + "\n")
    (data_dir / KEY_FILE).chmod(0o644)
    with api() as desktop:
        assert mode(data_dir / KEY_FILE) == 0o600
        assert via_next(desktop.app, claim=sign("ab" * 32, "127.0.0.1")).get("/api/settings").status_code == 200


def test_the_environment_key_wins(data_dir, monkeypatch):
    monkeypatch.setenv("VV_LAN_PROXY_KEY", "env-key")
    with api() as desktop:
        assert via_next(desktop.app, claim=sign("env-key", "127.0.0.1")).get("/api/settings").status_code == 200


def test_concurrent_creation_yields_one_key(tmp_path):
    data = tmp_path / "race"
    keys: list[str] = []
    threads = [threading.Thread(target=lambda: keys.append(lan.shared_proxy_key(data))) for _ in range(16)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(keys) == 16 and len(set(keys)) == 1
    assert mode(data / KEY_FILE) == 0o600
    assert [p.name for p in data.iterdir()] == [KEY_FILE]


@needs_node
def test_the_shim_creates_the_key_when_the_web_starts_first(data_dir):
    claim = node(ATTEST_JS, data_dir)
    assert mode(data_dir / KEY_FILE) == 0o600
    assert claim == sign(file_key(data_dir), "127.0.0.1")  # the forged header was replaced
    with api() as desktop:
        assert via_next(desktop.app, claim=claim).get("/api/settings").status_code == 200


@needs_node
def test_the_shim_reads_the_key_when_the_api_starts_first(data_dir):
    with api() as desktop:
        claim = node(ATTEST_JS, data_dir)
        assert via_next(desktop.app, claim=claim).get("/api/settings").status_code == 200


@needs_node
def test_the_shim_and_the_api_agree_when_they_race(tmp_path):
    data = tmp_path / "race"
    environ = {"PATH": str(Path(NODE).parent), "VV_DATA_DIR": str(data), "HOME": str(tmp_path)}
    shims = [subprocess.Popen([NODE, "-e", ATTEST_JS], env=environ, stdout=subprocess.PIPE, text=True)
             for _ in range(4)]
    keys = [lan.shared_proxy_key(data) for _ in range(4)]
    claims = {shim.communicate(timeout=30)[0] for shim in shims}
    assert len(set(keys)) == 1
    assert claims == {sign(keys[0], "127.0.0.1")}
    assert [p.name for p in data.iterdir()] == [KEY_FILE]


@needs_node
def test_the_shim_finds_the_same_key_file_as_the_api(tmp_path):
    def key_file(**env: str) -> str:
        return node(f"process.stdout.write(require({json.dumps(str(SHIM))}).keyFile(process.env))", None,
                    cwd=tmp_path, VV_LAN_PROXY_KEY="unused", **env)

    assert key_file() == str(REPO / "data" / KEY_FILE)
    assert key_file(VV_DATA_DIR=str(tmp_path / "elsewhere")) == str(tmp_path / "elsewhere" / KEY_FILE)
    assert key_file(VV_DATA_DIR="~/vv-data", HOME=str(tmp_path)) == str(tmp_path / "vv-data" / KEY_FILE)


@needs_node
def test_the_shim_attests_with_the_environment_key_first(tmp_path):
    claim = node(ATTEST_JS, tmp_path / "data", VV_LAN_PROXY_KEY="env-key")
    assert claim == sign("env-key", "127.0.0.1")
    assert not (tmp_path / "data" / KEY_FILE).exists()


# --- (b)/(c) every web start loads the shim and binds 127.0.0.1 ----------------------------------------------------

def _scripts(path: Path) -> dict[str, str]:
    return json.loads(path.read_text(encoding="utf-8"))["scripts"]


@pytest.mark.parametrize("name", ["dev", "start"])
def test_web_scripts_go_through_the_shim_on_loopback(name):
    script = _scripts(REPO / "apps" / "web" / "package.json")[name]
    assert script == f"node ../../scripts/next-with-shim.mjs {name} --hostname 127.0.0.1"
    assert (REPO / "apps" / "web" / "../../scripts/next-with-shim.mjs").resolve() == WRAPPER


def test_root_and_make_and_playwright_starts_bind_loopback():
    from .test_sec_1 import make_recipes

    assert _scripts(REPO / "package.json")["dev:web"] == LOCAL_WEB
    recipes = make_recipes()
    for target in ("dev", "web"):
        assert LOCAL_WEB in recipes[target], target
    playwright = (REPO / "apps" / "web" / "playwright.config.ts").read_text(encoding="utf-8")
    command = re.search(r"command:\s*`([^`]*)`", playwright).group(1)
    assert "pnpm dev --hostname 127.0.0.1" in command


@pytest.fixture
def fake_next(tmp_path):
    """A web package whose `next` binary reports its arguments and what the shim attests."""
    web = tmp_path / "web"
    (web / "node_modules" / "next" / "dist" / "bin").mkdir(parents=True)
    (web / "package.json").write_text('{"name": "web"}')
    (web / "node_modules" / "next" / "package.json").write_text('{"name": "next", "version": "0.0.0"}')
    (web / "node_modules" / "next" / "dist" / "bin" / "next").write_text(
        "const argv = process.argv.slice(2);\n"
        f"const shim = Object.keys(require.cache).includes({json.dumps(str(SHIM))});\n"
        + ATTEST_JS.replace(f"require({json.dumps(str(SHIM))});", "").replace(
            "process.stdout.write(body);",
            "process.stdout.write(JSON.stringify({argv, shim, claim: body, options: process.env.NODE_OPTIONS}));",
        )
    )
    return web


def run_wrapper(web: Path, *args: str, **env: str) -> subprocess.CompletedProcess:
    environ = {"PATH": str(Path(NODE).parent), "HOME": str(web.parent), "VV_DATA_DIR": str(web.parent / "data"),
               **env}
    return subprocess.run([NODE, str(WRAPPER), *args], cwd=web, env=environ, capture_output=True, text=True, check=False,
                          timeout=30)


@needs_node
def test_the_wrapper_preloads_the_shim_into_next(fake_next):
    result = run_wrapper(fake_next, "dev", "--hostname", "127.0.0.1", "--port", "3999",
                         NODE_OPTIONS="--max-old-space-size=4096")
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["argv"] == ["dev", "--hostname", "127.0.0.1", "--port", "3999"]
    assert report["shim"] is True
    assert report["claim"] == sign(file_key(fake_next.parent / "data"), "127.0.0.1")
    assert "--max-old-space-size=4096" in report["options"]


@needs_node
@pytest.mark.parametrize("args", [
    ("dev",),
    ("dev", "--hostname", "127.0.0.1", "--hostname", "0.0.0.0"),
    ("dev", "--hostname", "127.0.0.1", "-H", "192.168.1.5"),
    ("start", "--hostname=0.0.0.0"),
])
def test_the_wrapper_refuses_to_bind_beyond_loopback_outside_lan_mode(fake_next, args):
    result = run_wrapper(fake_next, *args)
    assert result.returncode != 0
    assert "hostname" in result.stderr.lower() or "make dev-lan" in result.stderr


@needs_node
def test_the_wrapper_accepts_a_repeated_identical_hostname(fake_next):
    result = run_wrapper(fake_next, "dev", "--hostname", "127.0.0.1", "--hostname", "127.0.0.1")
    assert result.returncode == 0, result.stderr


# --- (c) the exposure warning covers any Next server -----------------------------------------------------------------

LSOF = "p100\nf20\nn*:3123\np200\nf21\nn127.0.0.1:3000\np300\nf22\nn192.168.1.5:4000\np400\nf8\nn*:7000\n" \
       "p500\nf9\nn[::1]:3500\n"
PS = "  100 next-server (v16.4.6)\n  300 node /repo/node_modules/next/dist/bin/next start --hostname 0.0.0.0\n" \
     "  400 /usr/libexec/ControlCenter\n"


def fake_output(argv: list[str]) -> str:
    return LSOF if argv[0] == "lsof" else PS


def test_exposed_next_lists_any_next_server_listening_beyond_loopback(monkeypatch):
    monkeypatch.setattr(lan, "_output", fake_output)
    assert lan.exposed_next() == ["*:3123", "192.168.1.5:4000"]


def test_exposed_next_is_best_effort(monkeypatch):
    def broken(_argv):
        raise FileNotFoundError("lsof")

    monkeypatch.setattr(lan, "_output", broken)
    assert lan.exposed_next() == []


def test_the_watcher_warns_about_next_servers_on_any_port(monkeypatch, caplog):
    monkeypatch.setattr(lan, "_output", fake_output)
    monkeypatch.setattr(lan, "exposed_web", lambda _port: [])
    monkeypatch.setattr(lan, "_WEB_CHECKS", (0,))
    caplog.set_level(logging.WARNING)
    asyncio.run(lan.watch_web_exposure(3000))
    assert "*:3123" in caplog.text and "192.168.1.5:4000" in caplog.text
