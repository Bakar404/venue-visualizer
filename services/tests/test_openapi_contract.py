import json

from api.export_openapi import OPENAPI_PATH, openapi_json


def test_committed_openapi_is_current():
    """The web's mock API is validated against this file; regenerate it with `uv run python -m api.export_openapi`."""
    assert OPENAPI_PATH.is_file(), f"{OPENAPI_PATH} is missing; run `uv run python -m api.export_openapi`"
    assert OPENAPI_PATH.read_text(encoding="utf-8") == openapi_json(), (
        "packages/schema/openapi.json is stale; run `cd services && uv run python -m api.export_openapi`"
    )


def test_setup_operations_are_in_the_exported_contract():
    spec = json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))
    expected = {
        "/api/settings": {"get", "patch"},
        "/api/system/backends/refresh": {"post"},
        "/api/system/backends/{kind}/{id}/test": {"post"},
        "/api/system/setup": {"get"},
        "/api/system/lan": {"get"},
        "/api/system/lan/pair": {"post"},
    }
    for path, methods in expected.items():
        assert methods <= spec["paths"][path].keys()
    status = spec["components"]["schemas"]["BackendStatus"]
    assert {"install", "login", "used_for", "cost_note", "last_test"} <= set(status["required"])
