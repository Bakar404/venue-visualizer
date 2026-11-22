"""Run Venue Visualizer against the sample photos without starting an HTTP server."""

import argparse
from contextlib import ExitStack
from pathlib import Path
from tempfile import mkdtemp

from fastapi.testclient import TestClient

from api.config import Settings
from api.main import create_app

DESCRIPTION = (
    "12 round tables of 8, ivory linens, gold chiavari chairs, "
    "low ivory and blush centerpieces with greenery, warm amber uplighting, live candles"
)
FORMATS = {".jpeg", ".jpg", ".png", ".webp", ".heic", ".heif"}


def json_result(response):
    if not response.is_success:
        raise SystemExit(f"{response.request.url.path}: {response.status_code} {response.text}")
    return response.json()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", default="mock", help="Image engine (default: mock, no CLI or credits)")
    parser.add_argument("--space", default="ballroom", help="Folder under samples/ (default: ballroom)")
    parser.add_argument("--data-dir", type=Path, help="Keep results here instead of a fresh temp directory")
    args = parser.parse_args()
    samples = Path(__file__).resolve().parent
    space_dir = (samples / args.space).resolve()
    if space_dir.parent != samples:
        parser.error("--space must name a folder directly under samples/")
    photos = [p for p in sorted(space_dir.glob("*")) if p.is_file() and p.suffix.lower() in FORMATS]
    if not photos:
        parser.error(f"No sample photos found in {space_dir}")
    root = args.data_dir.expanduser().resolve() if args.data_dir else Path(mkdtemp(prefix="vv-sample-"))
    env = Settings.from_env()
    settings = Settings(
        root, dev=True, web_url=env.web_url, inline_jobs=True, engine_limits=env.engine_limits
    )
    with TestClient(create_app(settings)) as client:
        venue = json_result(
            client.post(
                "/api/venues",
                json={
                    "name": "Sample venue",
                    "rules": {"live_candles": False},
                },
            )
        )
        space = json_result(
            client.post(
                f"/api/venues/{venue['id']}/spaces",
                json={"name": space_dir.name.replace("-", " ").title()},
            )
        )
        studio = f"/api/spaces/{space['id']}"
        with ExitStack() as stack:
            files = [("files[]", (p.name, stack.enter_context(p.open("rb")))) for p in photos]
            json_result(client.post(f"{studio}/photos", files=files))
        chat = json_result(
            client.post(f"{studio}/chat", json={"message": DESCRIPTION, "spec": None, "brain": "mock"})
        )
        for warning in chat["warnings"]:
            print(f"Warning: {warning['message']}. {warning.get('fix') or ''}".strip(), flush=True)
        look = json_result(
            client.post(
                f"{studio}/looks",
                json={"name": "Ivory and blush reception", "spec": chat["spec"]},
            )
        )
        batch = json_result(client.post(f"/api/looks/{look['id']}/render", json={"engine": args.engine}))
        failed = False
        for render in batch["renders"]:
            if render["status"] != "done":
                print(f"Render {render['id']} {render['status']}: {render['error']}")
                failed = True
                continue
            path = root / render["url"].removeprefix("/files/")
            print(f"{path}  structure_score={render['structure_score']:.3f}")
        if failed:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
