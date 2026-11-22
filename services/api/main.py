import asyncio
import re
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi import status as status_codes
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlmodel import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException
from starlette.requests import HTTPConnection
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.websockets import WebSocketClose

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
_PAIRING_EXEMPT = {("GET", "/api/health"), ("POST", "/api/system/lan/pair")}
_UNVERIFIED_PROXY = (
    "This request came through a proxy that didn't identify the browser. Start the web with `make dev` or "
    "`pnpm --filter web dev`, which load services/api/lan_proxy.cjs, and open http://localhost:3000."
)


def _lan_policy(runtime: Runtime, cookie: str) -> tuple[tuple[str, ...], bool, bool]:
    if not lan.enabled(runtime.settings):
        # Paired devices are kept, but their cookies only count while `make dev-lan` is running.
        return (), False, False
    device = None
    if cookie:
        with Session(runtime.engine) as session:
            device = lan.valid_device(session, user_settings.row(session), cookie)
        if device is not None:
            lan.touch(runtime.engine, device)
    return lan.addresses(), True, device is not None


def _host(value: str) -> str:
    return re.sub(r":[0-9]+$", "", value.strip().lower())


def _port(value: str) -> int:
    match = re.search(r":([0-9]{1,5})$", value.strip())
    return int(match.group(1)) if match else 80


def _proxied(scope: Scope, headers: Headers, host: str) -> bool:
    """Did this request come through a proxy (Next.js rewrites, or anything else that relays)?

    Any forwarding header counts, and so does a Host that isn't this API's own loopback address and port: a
    direct request from this computer names the socket it connects to. Names from VV_ALLOWED_HOSTS don't
    count, because a reverse proxy that keeps Host and strips forwarding headers would otherwise look local.
    """
    if any(name.startswith("x-forwarded-") or name in ("forwarded", "x-real-ip") for name in headers):
        return True
    server = scope.get("server")
    return not (server and _host(host) in lan.LOOPBACK_HOSTS and _port(host) == server[1])


class RequestPolicy:
    """Host, origin, locality and pairing checks for every HTTP request and WebSocket upgrade.

    The bind address proves nothing about a proxied request: Next.js copies the browser's Host into
    X-Forwarded-Host, and the web may have been started on 0.0.0.0. A request on a loopback socket that came
    through a proxy (see `_proxied`) is local only with a valid X-VV-Client attestation for a loopback client.
    services/api/lan_proxy.cjs adds it in every Next.js process started by the package scripts, signed with
    VV_LAN_PROXY_KEY (per run, `make dev-lan`) or the shared `<data_dir>/.vv-proxy-key`.
    """

    def __init__(self, app: ASGIApp, hosts: list[str], origins: list[str]):
        self.app = app
        self.hosts = frozenset(host.lower() for host in hosts)
        self.origins = frozenset(origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        websocket = scope["type"] == "websocket"

        async def reject(status: int, detail: str) -> None:
            if websocket:
                await WebSocketClose(code=status_codes.WS_1008_POLICY_VIOLATION, reason=detail)(scope, receive, send)
            else:
                await JSONResponse({"detail": detail}, status)(scope, receive, send)

        connection = HTTPConnection(scope)
        runtime: Runtime = connection.app.state.runtime
        method = scope.get("method", "GET")
        socket_peer = lan.normalize_ip(connection.client.host) if connection.client else None
        headers = connection.headers
        hosts = headers.getlist("host")
        forwarded = headers.getlist("x-forwarded-host")
        if len(hosts) != 1 or len(forwarded) > 1:
            await reject(400, "Invalid host")
            return
        host, *forwarded_hosts = (_host(value) for value in hosts + forwarded)

        addrs, active, valid_cookie = await run_in_threadpool(
            _lan_policy, runtime, connection.cookies.get(lan.COOKIE, ""),
        )
        allowed_hosts = self.hosts.union(addrs)
        if host not in allowed_hosts or any(value not in allowed_hosts for value in forwarded_hosts):
            await reject(400, "Invalid host")
            return

        peer = socket_peer
        unverified_proxy = False
        if socket_peer is not None and socket_peer.is_loopback and _proxied(scope, headers, hosts[0]):
            key = connection.app.state.proxy_key
            claims = headers.getlist("x-vv-client")
            peer = lan.proxy_client(key, claims[0]) if key and len(claims) == 1 else None
            unverified_proxy = peer is None
        local = (
            peer is not None and peer.is_loopback and host not in addrs
            and not any(value in addrs for value in forwarded_hosts)
        )
        connection.state.lan_remote = not local
        connection.state.client_ip = peer
        # Settings, pairing info and device management also refuse a local browser that reached the
        # proxy under a non-loopback name.
        connection.state.owner = local and all(value in lan.LOOPBACK_HOSTS for value in forwarded_hosts)
        if not local:
            if websocket:
                await reject(403, "WebSockets are only available on this computer.")
                return
            if not active and unverified_proxy:
                await reject(403, _UNVERIFIED_PROXY)
                return
            if not active or ((method, scope["path"]) not in _PAIRING_EXEMPT and not valid_cookie):
                await reject(403, "Pair this device before using Venue Visualizer over the LAN.")
                return
        origins = self.origins.union(f"http://{addr}:{port}" for addr in addrs for port in (3000, 8000))
        origins_sent = headers.getlist("origin")
        origin_ok = not origins_sent or (len(origins_sent) == 1 and origins_sent[0] in origins)
        if websocket:
            if not origin_ok:
                await reject(403, "Origin is not allowed")
                return
            await self.app(scope, receive, send)
            return
        app = self.app
        if method not in ("GET", "HEAD", "OPTIONS"):
            types = headers.getlist("content-type")
            if len(types) != 1 or types[0].partition(";")[0].strip().lower() not in (
                "application/json", "multipart/form-data",
            ):
                app = JSONResponse({"detail": "Expected JSON or multipart form data"}, 415)
            elif not origin_ok:
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
        worker = watcher = None
        try:
            await run_in_threadpool(initialize, engine)
            app.state.runtime = Runtime(config, engine)
            app.state.proxy_key = await run_in_threadpool(lan.proxy_key, config)
            app.state.pairing = lan.Pairing()
            app.state.backend_tests = system.BackendTests()
            if lan.enabled(config):
                app.state.pairing.announce()
            else:
                watcher = asyncio.create_task(lan.watch_web_exposure(config.web_port))
            await run_in_threadpool(backend_report, app.state.runtime)
            if config.inline_jobs:
                worker = asyncio.create_task(serve(app.state.runtime, stop))
            yield
        finally:
            try:
                if watcher is not None:
                    watcher.cancel()
                    with suppress(asyncio.CancelledError):
                        await watcher
                if worker is not None:
                    stop.set()
                    await worker
            finally:
                engine.dispose()

    hosts = [*lan.LOOPBACK_HOSTS, *config.allowed_hosts]
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
