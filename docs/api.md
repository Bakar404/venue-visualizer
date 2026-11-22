# HTTP API contract (v1)

Base: `http://localhost:8000`. The web app proxies `/api/*` and `/files/*` to the API. IDs are UUID strings.
Timestamps are ISO-8601 UTC. Errors: `{"detail": "message"}` with a 4xx/5xx status.

The API accepts hosts `localhost`, `127.0.0.1`, and `[::1]`; add exact hosts (without ports) with the
comma-separated `VV_ALLOWED_HOSTS` setting. Methods other than GET, HEAD, and OPTIONS require
`Content-Type: application/json` (even for requests with no body) or `multipart/form-data`.
If such a request sends `Origin`, it must match `http://localhost:3000`, `http://127.0.0.1:3000`,
or an exact origin in the comma-separated `VV_ALLOWED_ORIGINS` setting.

`DesignSpec`, `VenueRules`, `VenueSpec`, `RuleWarning` → see `packages/schema/`.

## Types

```ts
type BackendStatus = { id: string; label: string; kind: "brain" | "engine"; available: boolean;
  logged_in: boolean | null; version: string | null; detail: string | null;
  install: { macos: string; linux: string; docs_url: string };
  login: { command: string; note: string | null } | null; image_setup: string | null;
  used_for: ("chat" | "web_research" | "vision" | "images")[]; cost_note: string;
  last_test: { ok: boolean; at: string; seconds: number; detail: string } | null;
  caps: { can_generate: boolean; can_edit: boolean; typical_seconds: number; cost_note: string; photoreal: boolean; max_refs: number } | null };
type Settings = {
  default_brain: "claude" | "codex" | "copilot" | "kimi" | "mock" | null;
  default_engine: "copilot" | "codex" | "mflux" | "mock" | null;
  allow_web_research: boolean; setup_completed_at: string | null;
  providers: { claude: { config_dir: string | null }; copilot: { model: string | null }; kimi: { bin: string | null } };
  lan: { enabled: boolean };
};
type RoleSetup = { ready: string[]; likely: string[]; missing: boolean };
type Setup = { complete: boolean; missing: ("brain" | "engine" | "defaults")[];
  steps: { tools: boolean; defaults: boolean; try_it: boolean };
  brain: RoleSetup; engine: RoleSetup; client: "owner" | "phone" };
type BackendTest = { ok: boolean; seconds: number; detail: string; sample_url: string | null };
type Lan = { enabled: boolean; url: string | null; qr_svg: string | null;
  pairing_code: string | null; pairing_required: true;
  pairing_expires_in: number | null; pairing_locked_for: number | null };
type Venue = { id: string; name: string; rules: VenueRules; created_at: string; spaces: Space[] };
type VenueImportResult = Venue & { skipped_photos: { url: string; reason: string }[] };
type Space = { id: string; venue_id: string; name: string; venue_spec: VenueSpec; photos: Photo[]; current_spec: DesignSpec | null;
  references: { url: string; source_page: string; caption: string | null; credit: string | null }[];
  capacity_seated: number | null; capacity_standing: number | null; source: string | null };
type Photo = { id: string; space_id: string | null; url: string; kind: "upload" | "generated_base" | "video_frame" | "web";
  approved: boolean; source_url: string | null; source_page: string | null; credit: string | null; width: number; height: number };
type Look = { id: string; space_id: string; name: string; spec: DesignSpec; parent_look_id: string | null; created_at: string; renders: Render[] };
type StructureReport = { score: number; method: "aligned" | "misaligned" | "unverifiable"; reason: string | null;
  aligned: boolean; inliers: number; brightness_delta: number | null; scale: number | null;
  rotation: number | null; coverage: number | null; edge_density?: number | null; flat?: boolean | null };
type Render = { id: string; look_id: string; photo_id: string; engine: string; status: JobStatus; url: string | null;
  prompt: string; structure_score: number | null; qa: { tables_seen?: number | null; notes?: string | null;
    structure?: StructureReport | null; structure_warning?: string | null;
    structure_message: { level: "ok" | "unverified" | "changed"; text: string } | null } | null;
  error: string | null; created_at: string };
type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
type Job = { id: string; kind: "render" | "generate_base"; status: JobStatus; progress: number; error: string | null; result: { render_id?: string; photo_id?: string } | null };
```

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ok: true}` |
| GET | `/api/system/backends` | | `{brains: BackendStatus[], engines: BackendStatus[], defaults: {brain, engine}, thresholds: {structure_ok: number}, internal: {layout_guide: BackendStatus}}` |
| POST | `/api/system/backends/refresh` | No body | Same as `GET /api/system/backends`, after clearing detection caches |
| POST | `/api/system/backends/{kind}/{id}/test` | `{confirm_credits?: boolean}` | `BackendTest` |
| GET | `/api/system/setup` | | `Setup` |
| GET | `/api/settings` | | `Settings` |
| PATCH | `/api/settings` | Partial `Settings`, including partial nested objects | Updated `Settings` |
| GET | `/api/system/lan` | | `Lan` (this computer only; shows the current pairing code, issuing one if none is active) |
| POST | `/api/system/lan/code` | No body | `Lan` with a fresh pairing code (this computer only) |
| POST | `/api/system/lan/pair` | `{code: string}` | `{ok: true}` and a device cookie (LAN only) |
| GET | `/api/system/lan/devices` | | `LanDevice[]` (this computer only) |
| DELETE | `/api/system/lan/devices/{id}` | | 204; forgets one paired device (404 if unknown) |
| DELETE | `/api/system/lan/devices` | | 204; forgets every paired device and rotates the cookie signing key |
| GET | `/api/venues` | | `Venue[]` |
| POST | `/api/venues` | `{name, rules?}` | `Venue` |
| GET/PATCH/DELETE | `/api/venues/{id}` | PATCH `{name?, rules?}` | `Venue` |
| POST | `/api/venues/{id}/spaces` | `{name, venue_spec?}` | `Space` |
| GET/PATCH | `/api/spaces/{id}` | PATCH `{name?, venue_spec?, current_spec?}` | `Space` |
| POST | `/api/spaces/{id}/photos` | multipart `files[]` (jpg/mpo/png/webp/heic, ≤ 20 MB each, ≤ 30 per space) | `Photo[]` |
| DELETE | `/api/photos/{id}` | | 204 |
| POST | `/api/spaces/{id}/generate-base` | `{engine?, angle_hint?, reference_url?}` | `Job` (kind generate_base) |
| POST | `/api/photos/{id}/approve` | | `Photo` |
| POST | `/api/spaces/{id}/chat` | `{message, spec: DesignSpec \| null, brain?}` | See [Chat response v2](#chat-response-v2-user-test-session-1-ut2-ut3-ut5) |
| GET | `/api/spaces/{id}/chat` | | `ChatMessage[]` (`{id, role, content, created_at, intent, look_name, ambiguities}`) |
| POST | `/api/spec/check` | `{spec, venue_id}` | `{spec, warnings}` |
| GET | `/api/spec/default` | | `DesignSpec` (sensible defaults) |
| GET | `/api/spaces/{id}/looks` | | `Look[]` |
| POST | `/api/spaces/{id}/looks` | `{name, spec, parent_look_id?}` | `Look` (spec is passed through rules first) |
| GET/DELETE | `/api/looks/{id}` | | `Look` |
| POST | `/api/looks/{id}/render` | `{photo_ids?: string[], engine?, brain_qa?: boolean}` | `{jobs: Job[], renders: Render[]}` |
| POST | `/api/renders/{id}/regenerate` | `{engine?}` | `Job` |
| GET | `/api/jobs/{id}` | | `Job` |
| GET | `/api/jobs?space_id=` | | `Job[]` (latest 100) |
| GET | `/api/looks/{id}/export.pdf` | | `application/pdf` |
| GET | `/files/{path}` | | image bytes from `data/` (path traversal blocked) |
| GET | `/files/tests/{sample_id}.png` | | Saved backend-test PNG |

Polling: the web app polls `/api/jobs/{id}` every 1.5 s while a job is queued or running (no websockets in v1).

## Setup and LAN

- **Settings:** Leave keys out to keep their saved values. A `null` default brain, engine, or provider option restores the
  existing env/automatic behavior. An explicit backend in an operation wins over the saved default, then the env default.
  `setup_completed_at` is an ISO-8601 timestamp with an offset; set it when the user finishes setup, or clear it with
  `null`. Web venue research defaults to enabled. Claude's `config_dir` must resolve to an existing directory under the
  user's home that contains a Claude config marker (`.claude.json` or `settings.json`). Kimi's `bin` must be an
  absolute path that resolves (following symlinks) to an existing executable named `kimi` or `kimi-*`. Neither may sit
  in a shared temp directory or the app's data directory. Otherwise PATCH returns 422. Saved values that no longer
  pass are ignored. `PATCH /api/settings` is accepted only from this computer (403 from paired phones and from
  proxied requests whose forwarded host isn't localhost). `lan.enabled` is read-only: it reports whether the API was
  started with `make dev-lan`, and a PATCH that tries to change it returns 422 "Restart with `make dev-lan` to open
  the app on your phone".
- **Detection:** `available` means installed (or locally available for internal tools). `logged_in: false` excludes a
  backend from automatic selection and setup readiness; `null` means the app cannot verify login without a test. Login
  detection is cached for up to 60 seconds. If no backend of a given kind is usable, its default is `null`.
  `login` is the sign-in step: `command` is what to type (the web makes only this copyable) and `note` is plain-text
  guidance for after it starts (for example Copilot: `copilot`, "then type /login"). `image_setup` is a one-time
  command that turns on images, if the tool needs one.
- **Readiness (one rule for setup, the web and `make doctor`; `services/api/readiness.py`):** a backend is *ready* when
  it is available and `logged_in` is `true` or its `last_test.ok` is `true`. It is *likely* when it is available,
  `logged_in` is `null` and it has no failed last test: it will probably work, but only a passing Test makes it ready.
  Not installed, signed out (`logged_in: false`) or a failed last test is neither. `Setup.brain` and `Setup.engine`
  list the `ready` and `likely` ids per role; `missing` is true when the role has no ready backend. Setup is
  `complete` only with a ready brain, a ready engine and `setup_completed_at` set. `steps.tools` means both roles have
  a ready backend, `steps.defaults` reflects the completion timestamp, and `steps.try_it` equals `complete`. The web
  offers only ready backends as defaults; likely ones are shown disabled with "Run Test first". `client` is `owner`
  for this computer and `phone` for a paired phone.
- **Tests:** A brain gets one JSON completion with a 60-second timeout. An engine generates a low-quality 1024×1024 sample.
  Engine tests other than mock and mflux require `confirm_credits: true` (422 otherwise); from a paired phone every
  engine test does. Only one test per backend runs at a time (409). A backend's brain test can start at most every
  10 s and its image test every 60 s (429 with `Retry-After`). Only the 5 newest sample images are kept.
  A completed test request returns
  200 with `ok: false` and a user-facing detail on provider failure. Results are persisted separately for each brain and
  engine; only a successful image test returns a `sample_url`. `make doctor` lists install and sign-in instructions
  without generating anything and always exits 0 after printing its verdict; `make doctor-ci` (`--strict`) exits
  non-zero unless setup is ready. `uv run python -m api.doctor --json` emits the same checklist as JSON.
- **LAN:** Off by default and only on while `make dev-lan` (alias `make lan`) runs (`VV_LAN=1` plus a per-run
  `VV_LAN_PROXY_KEY`); there is no settings toggle. It serves a production build (`next start`) on the LAN address
  while the API stays on 127.0.0.1. `make dev`, `make web`, `make api`, `pnpm dev:web` and the `apps/web`
  `dev`/`start` scripts bind to 127.0.0.1. LAN mode adds
  this machine's private IPv4 addresses (the default-route interface first; Docker, bridge, VPN and tunnel interfaces
  skipped) to allowed API hosts and permits HTTP origins on those addresses on ports 3000 and 8000.
  Use the returned web URL or QR code on a trusted Wi-Fi network: LAN mode uses plain HTTP by default.
  The six-digit pairing code is returned only by `GET /api/system/lan` on this computer (the console only says where to
  find it). Each `GET` keeps the current code (issuing one if none is active) and restarts its 10 minutes
  (`pairing_expires_in`, seconds); `POST /api/system/lan/code` replaces it. A code works once; pair another device by
  reopening the panel or choosing New code. The QR code and URL point at `/pair`. The web app turns any API 403 "Pair
  this device…" into a redirect to `/pair?next=<current path>` and returns there after pairing. Ten wrong codes from any addresses retire the code and
  lock pairing for 5 minutes (`pairing_locked_for`, seconds, with `pairing_code: null`; pairing returns 429 with
  `Retry-After`).
  A phone must pair before any API or file request except `GET /api/health` and `POST /api/system/lan/pair`.
  Five incorrect codes per client IP in ten minutes block further attempts with 429 and `Retry-After`. Successful pairing
  sets a signed, HttpOnly, SameSite=Strict cookie that lasts 30 days and survives restarts, but is honoured only in LAN
  mode. `LanDevice` is `{id, label, paired_at, last_seen, expires_at}`; the label comes from the User-Agent and
  `last_seen` updates at most once a minute. Forgetting all devices rotates the signing key so old cookies stop working.
  A request is proxied if it has any `X-Forwarded-*`, `Forwarded` or `X-Real-IP` header, or a Host other than the
  API's own loopback address and port. A proxied request is local only with a valid `X-VV-Client` attestation (set by
  `lan_proxy.cjs`, HMAC-SHA256 under `VV_LAN_PROXY_KEY` or else `<data_dir>/.vv-proxy-key`) naming a loopback client;
  otherwise it gets 403 (or must pair, in LAN mode). The bind address and forwarded host never make a request local.
  WebSocket upgrades follow the same rules and are refused unless local. Start the web with the `apps/web` scripts or
  Make targets: they preload the shim on every rewrite, and the Make targets disable Uvicorn's forwarded-header trust.
  `PATCH /api/settings` checks ownership before reading the body, so non-owners always get the same 403.
  If no private IPv4 address is found, the LAN URL and QR are `null`.

## Venue research, import, and video

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/venues/research` | `{query, brain?}` | 202 `Job` (`kind: "venue_research"`); `result: {research: VenueResearch}` when done |
| POST | `/api/venues/import` | `{research_job_id, match_index, space_names: string[], accepted_rules?: string[], accepted_provided_items?: string[], photos?: {url, mode?: "reference" \| "import", rights_confirmed?: boolean}[]}` | 201 `VenueImportResult` (venue fields at top level) |
| POST | `/api/venues/{id}/video` | Multipart `file`, optional `brain`; MP4, MOV, WebM or M4V (HEVC inside MOV/MP4 is fine), up to 1 GB and five minutes | 202 `Job` (`kind: "video_ingest"`) |
| POST | `/api/venues/{id}/video/apply` | `{job_id, spaces: {name, photo_ids: string[], venue_spec?: VenueSpec}[]}` | Updated `Venue` |
| POST | `/api/jobs/{id}/cancel` | No body | Updated `Job` |

- **Research and import:** The search result follows `venue-research.schema.json`. Research deduplicates photo URLs within each space and checks response headers without downloading image bodies; removed links and reasons are listed in `notes`. Imports use a completed job and a zero-based `match_index`. Only the named suggested spaces, explicitly selected rules and provided items, and listed photos are imported. Imported spaces retain their published capacities and source. A selected rule must have a single unambiguous supported value. `accepted_provided_items` defaults to an empty list; every entry must exactly match a suggested item for that venue match. Reference mode (the default) stores the URL, source page, and caption/credit on `Space.references`; it does not fetch at import time or create a `Photo`. Explicit base generation may fetch these temporarily through the pipeline downloader. Import mode requires `rights_confirmed: true`; downloaded photos are sanitized, approved, and stored as `kind: "web"` with `source_url`, `source_page`, and `credit`. Unavailable or unusable photos are skipped without failing the import; `skipped_photos` lists the affected URLs and reasons and is empty if none were skipped. At most 12 web photos/references can be selected per space.
- **Video review:** Uploads must have a readable duration of at most 300 seconds; longer or unmeasurable files return 422 before a job is queued. A completed job has `result: {frames, spaces_suggested, duration_s, warnings, applied}`. Each frame has `{photo_id, url, t, sharpness, exposure_ok, space_guess, view, description, fixtures, usable}`. Suggestions contain `{name, venue_spec, photo_ids}`. Frames are saved as unassigned, unapproved `Photo` records (`kind: "video_frame"`) until apply. Each kept frame can be assigned only once, to a new space or an existing space with the same name. Applying approves the selected frames and deletes the rest; a video job can be applied only once.
- **Jobs:** `progress` is in `[0, 1]`; `error_status` is nullable and can carry an HTTP-style code for an asynchronous failure. If a parallel pipeline function is not yet installed, the corresponding endpoint returns 501 before enqueuing when possible. A queued job cancels immediately. A running job stops processing when the worker observes cancellation and keeps its slot until processing exits. Worker crashes and retryable execution failures both count toward the two-attempt limit. Engine concurrency defaults to one per engine across workers sharing the database; override it with `VV_ENGINE_CONCURRENCY_<ENGINE_ID>` (e.g. `VV_ENGINE_CONCURRENCY_MOCK=2`) consistently for all workers. With `VV_INLINE_JOBS=1`, job-creating requests wait for their jobs to finish in the API process.

Uploads accept `files[]` (or `files`) and are re-encoded to strip metadata; HEIC and the first frame of an MPO are stored as JPEG. An upload or video assignment that would take a space past 30 photos is rejected. Venue and look deletes return the deleted resource snapshot; deleting a photo removes its dependent renders. Deletions that would remove active jobs are rejected until those jobs are finished or cancelled.

Chat history stores the final assistant reply, including any venue-rule adjustment text. `rule_notes` contains
the pipeline's adjustment notes or an empty list when the pipeline does not provide notes.

Rendering defaults to all approved photos in the look's space. `brain_qa: true` enables optional vision QA; `brain` may select the QA brain. Layout guides are internal and never served. The mock image engine is enabled only with `VV_DEV=1`; `defaults.engine` is `null` if no public engine is available. Look responses include `warnings` from rule and capacity checks. PDF export reads saved renders and their original photos, includes warnings and web credits, and never starts a render.

Render QA stores the alignment-based comparison in `qa.structure` and its score in `structure_score`.
Scores below `thresholds.structure_ok` (currently `0.70`) trigger one retry; if the retry still scores below it, `qa.structure_warning` is set.
An aspect-ratio change on its own does not trigger a retry or warning.

State-changing requests that create records or enqueue work do not deduplicate retries. Use job polling instead of re-submitting an accepted render, generation, research, or video request.

## Chat response v2 (user-test session 1: UT2, UT3, UT5)

`POST /api/spaces/{id}/chat` now returns:

```ts
{
  reply: string;
  spec: DesignSpec;
  warnings: RuleWarning[];
  rule_notes: string[];
  intent: "edit" | "render" | "question" | "none";   // "render" = the user wants to see it (UI offers Render now)
  spec_changed: boolean;                              // server-computed: spec differs from the request's spec
  look_name: string | null;                           // short human name for the current plan, e.g. "Moody night, blue uplighting"
  ambiguities: { question: string; options: string[] }[];  // options are what quick-reply chips send
  brain: string;
}
```
Clients must send an ambiguity **option**, never the question. Chat history returns legacy string ambiguities as
`{question, options: []}`. User messages and older messages with no saved intent or name return `null` for those fields.

## Reference photos → base photo (UT6)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/spaces/{id}` | | `Space` now includes `references: {url, source_page, caption, credit}[]` |
| POST | `/api/spaces/{id}/references/import` | `{url, rights_confirmed: true}` (url must be one of the space's references) | 201 `Photo` (kind `web`, approved, with credit). 422 without `rights_confirmed: true` or if the URL isn't a reference, 409 if the space has 30 photos, and 502 with a reason if the download fails. The reference is retained. |
| POST | `/api/spaces/{id}/generate-base` | `{engine?, angle_hint?, reference_url?}` | 202 `Job`: when `reference_url` is given, only that stored reference is passed to the engine, and its viewpoint takes precedence over `angle_hint`. A URL not stored as a reference returns 422. The generated base still needs approval. |

## Render QA reason (UT7)
`Render.qa.structure` includes `method` (`aligned` / `misaligned` / `unverifiable`) and `reason`.
`Render.qa.structure_message` summarizes the check as `{level: "ok" | "unverified" | "changed", text}`.
If alignment fails after a large change in brightness, the message suggests comparing the images with the slider
rather than implying that the room's architecture changed.
