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
  caps?: { can_generate: boolean; can_edit: boolean; typical_seconds: number; cost_note: string; photoreal: boolean } };
type Venue = { id: string; name: string; rules: VenueRules; created_at: string; spaces: Space[] };
type VenueImportResult = Venue & { skipped_photos: { url: string; reason: string }[] };
type Space = { id: string; venue_id: string; name: string; venue_spec: VenueSpec; photos: Photo[]; current_spec: DesignSpec | null;
  capacity_seated: number | null; capacity_standing: number | null; source: string | null };
type Photo = { id: string; space_id: string; url: string; kind: "upload" | "generated_base"; approved: boolean; width: number; height: number };
type Look = { id: string; space_id: string; name: string; spec: DesignSpec; parent_look_id: string | null; created_at: string; renders: Render[] };
type StructureReport = { score: number; method: string; aligned: boolean; inliers: number;
  scale: number | null; rotation: number | null; coverage: number | null; edge_density?: number | null; flat?: boolean | null };
type Render = { id: string; look_id: string; photo_id: string; engine: string; status: JobStatus; url: string | null;
  prompt: string; structure_score: number | null; qa: { tables_seen?: number | null; notes?: string | null;
    structure?: StructureReport | null; structure_warning?: string | null } | null; error: string | null; created_at: string };
type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
type Job = { id: string; kind: "render" | "generate_base"; status: JobStatus; progress: number; error: string | null; result: { render_id?: string; photo_id?: string } | null };
```

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ok: true}` |
| GET | `/api/system/backends` | | `{brains: BackendStatus[], engines: BackendStatus[], defaults: {brain, engine}, thresholds: {structure_ok: number}}` |
| GET | `/api/venues` | | `Venue[]` |
| POST | `/api/venues` | `{name, rules?}` | `Venue` |
| GET/PATCH/DELETE | `/api/venues/{id}` | PATCH `{name?, rules?}` | `Venue` |
| POST | `/api/venues/{id}/spaces` | `{name, venue_spec?}` | `Space` |
| GET/PATCH | `/api/spaces/{id}` | PATCH `{name?, venue_spec?, current_spec?}` | `Space` |
| POST | `/api/spaces/{id}/photos` | multipart `files[]` (jpg/mpo/png/webp/heic, ≤ 20 MB each, ≤ 30 per space) | `Photo[]` |
| DELETE | `/api/photos/{id}` | | 204 |
| POST | `/api/spaces/{id}/generate-base` | `{engine, angle_hint?}` | `Job` (kind generate_base) |
| POST | `/api/photos/{id}/approve` | | `Photo` |
| POST | `/api/spaces/{id}/chat` | `{message, spec: DesignSpec \| null, brain?}` | `{reply, spec: DesignSpec, warnings: RuleWarning[], rule_notes: string[], ambiguities: string[], brain}` |
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
`ambiguities` items used to be plain strings. Clients must send an **option**, never the question.

## Reference photos → base photo (UT6)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/spaces/{id}` | | `Space` now includes `references: {url, source_page, caption, credit}[]` |
| POST | `/api/spaces/{id}/references/import` | `{url, rights_confirmed: true}` (url must be one of the space's references) | `Photo` (kind `web`, approved, with credit). 422 without `rights_confirmed` or if the url isn't a reference. Download failures return 502 with a reason. |
| POST | `/api/spaces/{id}/generate-base` | `{engine, reference_url?}` | `Job`: when `reference_url` is given, the reference image is passed to the engine as a reference to generate an empty base view of that room |

## Render QA reason (UT7)
`Render.qa.structure` includes `method` (`aligned` / `misaligned` / `unverifiable`) and `reason`.
