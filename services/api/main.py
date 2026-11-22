import asyncio
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from . import looks, studio, system, venues
from .config import LOCAL_WEB_URL, Settings
from .db import database, initialize
from .deps import Runtime
from .integrations import IntegrationError, backend_report
from .storage import MAX_IMAGE_BYTES, MAX_PHOTOS, MAX_VIDEO_BYTES, InvalidMedia, MediaTooLarge
from .worker import serve

_UPLOAD_ERROR = "Multipart upload exceeds the request size limit"
_UPLOAD_LIMITS = (
    (re.compile(r"/api/spaces/[^/]+/photos/?"), MAX_PHOTOS * MAX_IMAGE_BYTES),
    (re.compile(r"/api/venues/[^/]+/video/?"), MAX_VIDEO_BYTES),
)


class RequestPolicy:
    def __init__(self, app: ASGIApp, hosts: list[str], origins: list[str]):
        self.app = app
        self.hosts = {host.lower() for host in hosts}
        self.origins = set(origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = Headers(scope=scope)
            # Next's rewrite sends the upstream Host and preserves the browser Host separately.
            forwarded = headers.getlist("x-forwarded-host")
            if forwarded and (
                len(forwarded) != 1 or re.sub(r":[0-9]+$", "", forwarded[0].lower()) not in self.hosts
            ):
                await JSONResponse({"detail": "Invalid forwarded host"}, 400)(scope, receive, send)
                return
            if scope["method"] not in ("GET", "HEAD", "OPTIONS"):
                types = headers.getlist("content-type")
                if len(types) != 1 or types[0].partition(";")[0].strip().lower() not in (
                    "application/json",
                    "multipart/form-data",
                ):
                    await JSONResponse({"detail": "Expected JSON or multipart form data"}, 415)(
                        scope, receive, send
                    )
                    return
                origins = headers.getlist("origin")
                if origins and (len(origins) != 1 or origins[0] not in self.origins):
                    await JSONResponse({"detail": "Origin is not allowed"}, 403)(scope, receive, send)
                    return
        await self.app(scope, receive, send)


class UploadLimit:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        limit = next((size for route, size in _UPLOAD_LIMITS if route.fullmatch(scope["path"])), None)
        if limit is None:
            await self.app(scope, receive, send)
            return
        limit += 1024 * 1024  # Multipart framing; the storage layer checks actual file sizes.
        length = Headers(scope=scope).get("content-length", "")
        if length.isascii() and length.isdecimal() and (len(length) > 18 or int(length) > limit):
            await JSONResponse({"detail": _UPLOAD_ERROR}, status_code=413)(scope, receive, send)
            return
        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # The multipart parser catches this and closes partially spooled files.
                    raise MultiPartException(_UPLOAD_ERROR)
            return message

        await self.app(scope, bounded_receive, send)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = database(config.data_dir)
        stop = asyncio.Event()
        worker = None
        try:
            await run_in_threadpool(initialize, engine)
            await run_in_threadpool(backend_report, config)
            app.state.runtime = Runtime(config, engine)
            if config.inline_jobs:
                worker = asyncio.create_task(serve(app.state.runtime, stop))
            yield
        finally:
            try:
                if worker is not None:
                    stop.set()
                    await worker
            finally:
                engine.dispose()

    hosts = ["localhost", "127.0.0.1", "[::1]", *config.allowed_hosts]
    origins = [LOCAL_WEB_URL, "http://127.0.0.1:3000", *config.allowed_origins]
    app = FastAPI(
        title="Venue Visualizer",
        version="1",
        lifespan=lifespan,
        openapi_tags=[
            {"name": name}
            for name in ("system", "venues", "spaces", "photos", "spec", "looks", "jobs", "export", "files")
        ],
    )
    app.add_middleware(UploadLimit)
    app.add_middleware(RequestPolicy, hosts=hosts, origins=origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Range"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts, www_redirect=False)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            {"detail": str(exc.detail)},
            status_code=413 if exc.detail == _UPLOAD_ERROR else exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()[:10]]
        return JSONResponse({"detail": "; ".join(errors)}, status_code=422)

    @app.exception_handler(InvalidMedia)
    async def media_error(_request: Request, exc: InvalidMedia) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=413 if isinstance(exc, MediaTooLarge) else 422)

    @app.exception_handler(IntegrationError)
    async def integration_error(_request: Request, exc: IntegrationError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=exc.status_code)

    for router in (
        system.system,
        venues.router,
        studio.spaces,
        studio.photos,
        studio.specs,
        looks.router,
        system.jobs,
        system.files,
    ):
        app.include_router(router)
    return app


app = create_app()
