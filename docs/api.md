# HTTP API contract (v1)

Base: `http://localhost:8000`. All JSON. The web app proxies `/api/*` and `/files/*` to the API. IDs are UUID strings.
Timestamps are ISO-8601 UTC. Errors: `{"detail": "message"}` with a 4xx/5xx status.

`DesignSpec`, `VenueRules`, `VenueSpec`, `RuleWarning` → see `packages/schema/`.

## Types

```ts
type BackendStatus = { id: string; label: string; kind: "brain" | "engine"; available: boolean;
  logged_in: boolean | null; version: string | null; detail: string | null;
  caps?: { can_generate: boolean; can_edit: boolean; typical_seconds: number; cost_note: string; photoreal: boolean } };
type Venue = { id: string; name: string; rules: VenueRules; created_at: string; spaces: Space[] };
type Space = { id: string; venue_id: string; name: string; venue_spec: VenueSpec; photos: Photo[]; current_spec: DesignSpec | null };
type Photo = { id: string; space_id: string; url: string; kind: "upload" | "generated_base"; approved: boolean; width: number; height: number };
type Look = { id: string; space_id: string; name: string; spec: DesignSpec; parent_look_id: string | null; created_at: string; renders: Render[] };
type Render = { id: string; look_id: string; photo_id: string; engine: string; status: JobStatus; url: string | null;
  prompt: string; structure_score: number | null; qa: { tables_seen?: number; notes?: string } | null; error: string | null; created_at: string };
type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
type Job = { id: string; kind: "render" | "generate_base"; status: JobStatus; progress: number; error: string | null; result: { render_id?: string; photo_id?: string } | null };
```

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ok: true}` |
| GET | `/api/system/backends` | | `{brains: BackendStatus[], engines: BackendStatus[], defaults: {brain, engine}}` |
| GET | `/api/venues` | | `Venue[]` |
| POST | `/api/venues` | `{name, rules?}` | `Venue` |
| GET/PATCH/DELETE | `/api/venues/{id}` | PATCH `{name?, rules?}` | `Venue` |
| POST | `/api/venues/{id}/spaces` | `{name, venue_spec?}` | `Space` |
| GET/PATCH | `/api/spaces/{id}` | PATCH `{name?, venue_spec?, current_spec?}` | `Space` |
| POST | `/api/spaces/{id}/photos` | multipart `files[]` (jpg/png/webp/heic, ≤ 20 MB each, ≤ 30 per space) | `Photo[]` |
| DELETE | `/api/photos/{id}` | | 204 |
| POST | `/api/spaces/{id}/generate-base` | `{engine, angle_hint?}` | `Job` (kind generate_base) |
| POST | `/api/photos/{id}/approve` | | `Photo` |
| POST | `/api/spaces/{id}/chat` | `{message, spec: DesignSpec \| null, brain?}` | `{reply, spec: DesignSpec, warnings: RuleWarning[], ambiguities: string[], brain}` |
| GET | `/api/spaces/{id}/chat` | | `ChatMessage[]` (`{id, role, content, created_at}`) |
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

Polling: the web app polls `/api/jobs/{id}` every 1.5 s while a job is queued or running (no websockets in v1).

## Venue research, import, and video

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/venues/research` | `{query, brain?}` | 202 `Job` (`kind: "venue_research"`); `result: {research: VenueResearch}` when done |
| POST | `/api/venues/import` | `{research_job_id, match_index, space_names: string[], accepted_rules?: string[], photos?: {url, mode?: "reference" \| "import", rights_confirmed?: boolean}[]}` | 201 `Venue` |
| POST | `/api/venues/{id}/video` | Multipart `file`, optional `brain`; MP4, MOV, WebM, M4V, or HEVC, up to 1 GB and five minutes | 202 `Job` (`kind: "video_ingest"`) |
| POST | `/api/venues/{id}/video/apply` | `{job_id, spaces: {name, photo_ids: string[], venue_spec?: VenueSpec}[]}` | Updated `Venue` |
| POST | `/api/jobs/{id}/cancel` | No body | Updated `Job` |

- **Research and import:** The search result follows `venue-research.schema.json`. Imports use a completed job and a zero-based `match_index`. Only the named suggested spaces, explicitly selected rules, and listed photos are imported. A selected rule must have a single unambiguous supported value. Provided items are informational. Reference mode (the default) stores the URL, source page, and caption/credit on `Space.references`; it does not fetch at import time or create a `Photo`. Explicit base generation may fetch these temporarily through the pipeline downloader. Import mode requires `rights_confirmed: true`; downloaded photos are sanitized, approved, and stored as `kind: "web"` with `source_url`, `source_page`, and `credit`. At most 12 web photos/references can be selected per space.
- **Video review:** A completed job has `result: {frames, spaces_suggested, duration_s, warnings, applied}`. Each frame has `{photo_id, url, t, sharpness, exposure_ok, space_guess, view, description, fixtures, usable}`. Suggestions contain `{name, venue_spec, photo_ids}`. Frames are saved as unassigned, unapproved `Photo` records (`kind: "video_frame"`) until apply. Each kept frame can be assigned only once, to a new space or an existing space with the same name. Applying approves the selected frames and deletes the rest; a video job can be applied only once.
- **Jobs:** `progress` is in `[0, 1]`; `error_status` is nullable and can carry an HTTP-style code for an asynchronous failure. If a parallel pipeline function is not yet installed, the corresponding endpoint returns 501 before enqueuing when possible. A queued job cancels immediately; running jobs stop at the next cancellation checkpoint and won't publish new outputs. The worker recovers expired running leases and retries execution failures once. Engine concurrency defaults to one per engine across workers sharing the database; override it with `VV_ENGINE_CONCURRENCY_<ENGINE_ID>` (e.g. `VV_ENGINE_CONCURRENCY_MOCK=2`) consistently for all workers. With `VV_INLINE_JOBS=1`, job-creating requests wait for their jobs to finish in the API process.

Uploads accept `files[]` (or `files`) and are re-encoded to strip metadata; HEIC is stored as JPEG. An upload or video assignment that would take a space past 30 photos is rejected. Venue and look deletes return the deleted resource snapshot; deleting a photo removes its dependent renders. Deletions that would remove active jobs are rejected until those jobs are finished or cancelled.

Rendering defaults to all approved photos in the look's space. `brain_qa: true` enables optional vision QA; `brain` may select the QA brain. Layout guides are internal and never served. The mock image engine is enabled only with `VV_DEV=1`; `defaults.engine` is `null` if no public engine is available. Look responses include `warnings` from rule and capacity checks. PDF export reads saved renders and their original photos, includes warnings and web credits, and never starts a render.

State-changing requests that create records or enqueue work do not deduplicate retries. Use job polling instead of re-submitting an accepted render, generation, research, or video request.
