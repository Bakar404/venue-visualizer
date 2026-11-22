"""Writes the API's OpenAPI document to packages/schema/openapi.json (the web's contract tests read it).

Run from services/: `uv run python -m api.export_openapi`.
"""

import json
from pathlib import Path

from .main import create_app

OPENAPI_PATH = Path(__file__).resolve().parents[2] / "packages" / "schema" / "openapi.json"


def openapi_json() -> str:
    return json.dumps(create_app().openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> None:
    OPENAPI_PATH.write_text(openapi_json(), encoding="utf-8")
    print(f"wrote {OPENAPI_PATH}")


if __name__ == "__main__":
    main()
