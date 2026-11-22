from api.export_openapi import OPENAPI_PATH, openapi_json


def test_committed_openapi_is_current():
    """The web's mock API is validated against this file; regenerate it with `uv run python -m api.export_openapi`."""
    assert OPENAPI_PATH.is_file(), f"{OPENAPI_PATH} is missing; run `uv run python -m api.export_openapi`"
    assert OPENAPI_PATH.read_text(encoding="utf-8") == openapi_json(), (
        "packages/schema/openapi.json is stale; run `cd services && uv run python -m api.export_openapi`"
    )
