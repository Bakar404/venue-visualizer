import json

from PIL import Image

from .conftest_setup import desktop, setup_machine  # noqa: F401 - pytest fixture


def test_brain_test_makes_one_tiny_cli_call_and_persists_result(setup_machine):  # noqa: F811
    setup_machine.installed.add("claude")
    setup_machine.logged_in["claude"] = True
    with desktop() as api:
        response = api.post("/api/system/backends/brain/claude/test", json={})
        assert response.status_code == 200, response.text
        assert response.json()["ok"] is True
        [(argv, _, stdin)] = setup_machine.calls
        assert stdin == b'Reply with {"ok": true}'
        schema = json.loads(argv[argv.index("--json-schema") + 1])
        assert schema["properties"] == {"ok": {"type": "boolean"}}
    with desktop() as api:
        last = api.get("/api/system/backends").json()["brains"][0]["last_test"]
        assert last["ok"] is True and last["at"]
        assert last["seconds"] == response.json()["seconds"]
        assert last["detail"] == response.json()["detail"]


def test_credit_confirmation_and_image_sample(setup_machine):  # noqa: F811
    setup_machine.installed.add("copilot")

    def generate(argv, cwd):
        assert "a small vase of white flowers on a wooden table, photo" in argv[1]
        assert "1024x1024" in argv[1] and "low" in argv[1]
        path = cwd / "sample.png"
        Image.new("RGB", (1024, 1024), "white").save(path)
        return 0, json.dumps({"saved_to": str(path)}), ""

    setup_machine.reply = generate
    with desktop() as api:
        url = "/api/system/backends/engine/copilot/test"
        assert api.post(url, json={}).status_code == 422
        assert setup_machine.calls == []
        result = api.post(url, json={"confirm_credits": True}).json()
        assert result["ok"] is True
        assert result["sample_url"].startswith("/files/tests/")
        assert api.get(result["sample_url"]).headers["content-type"] == "image/png"


def test_provider_error_is_friendly_and_remembered(setup_machine):  # noqa: F811
    setup_machine.installed.add("copilot")
    setup_machine.reply = lambda *_: (1, "", "Authentication required. Please run /login.")
    with desktop() as api:
        result = api.post("/api/system/backends/brain/copilot/test", json={}).json()
        assert result["ok"] is False
        assert "not signed in" in result["detail"].lower()
        status = next(b for b in api.get("/api/system/backends").json()["brains"] if b["id"] == "copilot")
        assert status["last_test"]["detail"] == result["detail"]
