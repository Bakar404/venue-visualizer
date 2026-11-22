"""The one readiness rule shared by GET /api/system/setup, the doctor and (mirrored) the web.

ready:  available and (signed in, or its last test passed).
likely: available, sign-in unknown and no failed last test. It will probably work, but nobody has checked.
Anything else (missing, signed out, last test failed) is neither.
"""

from collections.abc import Iterable, Mapping
from typing import Any, Literal

State = Literal["ready", "likely", "failed", "signed_out", "missing"]
ROLES = ("brain", "engine")


def _last_ok(last_test: Any) -> bool | None:
    if last_test is None:
        return None
    ok = last_test.get("ok") if isinstance(last_test, Mapping) else getattr(last_test, "ok", None)
    return ok if isinstance(ok, bool) else None


def state(available: bool, logged_in: bool | None, last_test: Any = None) -> State:
    if not available:
        return "missing"
    if logged_in is False:
        return "signed_out"
    ok = _last_ok(last_test)
    if logged_in is True or ok is True:
        return "ready"
    return "failed" if ok is False else "likely"


def role(items: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """`{ready, likely, missing}` for one role; each item has id, available, logged_in and last_test."""
    states = [(item["id"], state(item["available"], item["logged_in"], item.get("last_test"))) for item in items]
    ready = [backend_id for backend_id, value in states if value == "ready"]
    likely = [backend_id for backend_id, value in states if value == "likely"]
    return {"ready": ready, "likely": likely, "missing": not ready}
