import asyncio
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlmodel import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException
from starlette.types import ASGIApp, Receive, Scope, Send

from . import lan, looks, studio, system, venues
from . import settings as user_settings
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
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]"})
_PAIRING_EXEMPT = {("GET", "/api/health"), ("POST", "/api/system/lan/pair")}


def _lan_policy(runtime: Runtime, cookie: str) -> tuple[tuple[str, ...], bool, bool]:
    with Session(runtime.engine) as session:
        settings = user_settings.row(session)
        if not lan.enabled(runtime.settings, settings):
            return (), False, False
        return lan.addresses(), True, bool(cookie and lan.valid_device(session, settings, cookie))


class RequestPolicy:
    def __init__(self, app: ASGIApp, hosts: list[str], origins: list[str]):
        self.app = app
        self.hosts = frozenset(host.lower() for host in hosts)
        self.origins = frozenset(origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def reject(status: int, detail: str) -> None:
            await JSONResponse({"detail": detail}, status)(scope, receive, send)

        request = Request(scope)
        runtime: Runtime = request.app.state.runtime
        socket_peer = lan.normalize_ip(request.client.host) if request.client else None
        headers = request.headers
        hosts = headers.getlist("host")
        forwarded = headers.getlist("x-forwarded-host")
        if len(hosts) != 1 or len(forwarded) > 1:
            await reject(400, "Invalid host")
            return
        host, *forwarded_hosts = (re.sub(r":[0-9]+$", "", value.lower()) for value in hosts + forwarded)

        peer = socket_peer
        proxied = bool(forwarded and socket_peer and socket_peer.is_loopback)
        if proxied and runtime.settings.lan_proxy_key:
            peers = headers.getlist("x-vv-client")
            peer = lan.proxy_client(runtime.settings.lan_proxy_key, peers[0]) if len(peers) == 1 else None
        addrs, active, valid_cookie = await run_in_threadpool(
            _lan_policy, runtime, request.cookies.get(lan.COOKIE, ""),
        )
        allowed_hosts = self.hosts.union(addrs)
        if host not in allowed_hosts or any(value not in allowed_hosts for value in forwarded_hosts):
            await reject(400, "Invalid host")
            return
        if proxied and active and not runtime.settings.lan_proxy_key:
            # A request arriving from Next's loopback socket is not proof of a local browser.
            peer = None
        local = (
            peer is not None and peer.is_loopback and host not in addrs
            and not any(value in addrs for value in forwarded_hosts)
        )
        request.state.lan_remote = not local
        request.state.client_ip = peer
        exempt = (request.method, scope["path"]) in _PAIRING_EXEMPT
        if not local and (not active or (not exempt and not valid_cookie)):
            await reject(403, "Pair this device before using Venue Visualizer over the LAN.")
            return
        origins = self.origins.union(f"http://{addr}:{port}" for addr in addrs for port in (3000, 8000))
        origins_sent = headers.getlist("origin")
        app = self.app
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            types = headers.getlist("content-type")
            if len(types) != 1 or types[0].partition(";")[0].strip().lower() not in (
                "application/json", "multipart/form-data",
            ):
                app = JSONResponse({"detail": "Expected JSON or multipart form data"}, 415)
            elif origins_sent and (len(origins_sent) != 1 or origins_sent[0] not in origins):
                app = JSONResponse({"detail": "Origin is not allowed"}, 403)
        if origins_sent:
            app = CORSMiddleware(app, allow_origins=sorted(origins), allow_methods=["GET", "POST", "PATCH", "DELETE"],
                                 allow_headers=["Content-Type", "Range"], allow_credentials=active)
        await app(scope, receive, send)


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
            app.state.runtime = Runtime(config, engine)
            app.state.pairing = lan.Pairing()
            if lan.enabled(config, await run_in_threadpool(user_settings.load, engine)):
                app.state.pairing.announce()
            await run_in_threadpool(backend_report, app.state.runtime)
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

    hosts = [*_LOCAL_HOSTS, *config.allowed_hosts]
    origins = [LOCAL_WEB_URL, "http://127.0.0.1:3000", *config.allowed_origins]
    app = FastAPI(
        title="Venue Visualizer",
        version="1",
        lifespan=lifespan,
        openapi_tags=[
            {"name": name}
            for name in ("system", "settings", "venues", "spaces", "photos", "spec", "looks", "jobs", "export", "files")
        ],
    )
    app.add_middleware(UploadLimit)
    app.add_middleware(RequestPolicy, hosts=hosts, origins=origins)

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
        lan.router,
        user_settings.router,
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
