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
