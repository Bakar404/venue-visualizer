# Venue Visualizer: Architecture (Phase 1)

Visualize event decor in a venue. Upload photos of your venue (or just describe it), chat with an agent about the look you want, and get renders you can compare and export.

## The core constraint: bring your own subscription

There are **no image or LLM API keys**. The app runs **locally** on the user's machine and drives
whatever AI coding CLIs the user is already logged into, through each vendor's official CLI or SDK:

| Capability | Backends (any subset may be present) |
|---|---|
| **Brain** (text → DesignSpec, chat, vision QA) | Claude Code (`claude -p`), Codex (`codex exec`), Copilot CLI (`copilot -p`), Kimi Code CLI (`kimi`) |
| **Image engine** (generate / edit) | Copilot CLI image tool, Codex `$imagegen`, local mflux (Apple Silicon), 3D scene render (three.js, no image AI), Mock (tests) |

Because subscriptions are per-person, the app is **never hosted as a multi-user service**. It is a
clone-and-run tool. We never read CLI auth tokens or call vendor backends directly: we only spawn the
official CLIs.

## Layout

```
apps/web            Next.js (App Router) + TS + Tailwind v4 + shadcn/ui (Base UI) + Sonner + cmdk + NumberFlow + R3F
services/api        FastAPI app: venues, spaces, photos, looks, jobs, chat; SQLite; worker process
services/pipeline   Python package `pipeline`: brains/, engines/, rules.py, prompts.py, verify.py, layout.py
packages/schema     JSON Schema (source of truth) for DesignSpec + VenueSpec; generated TS types + Pydantic models
assets/models       (Phase 2) low-poly GLB models
samples/            sample venue photos (free-licensed) + run_sample.py
docs/               architecture.md, decisions.md, api.md
data/               (gitignored) sqlite db + uploaded/rendered images
```

## Data model (SQLite via SQLModel)

- `Venue(id, name, rules_json, created_at)`: venue rules are user-entered and authoritative.
- `Space(id, venue_id, name, venue_spec_json, dimensions_json)`: "Ballroom", "Cocktail lounge".
- `Photo(id, space_id, path, kind: "upload" | "generated_base", approved: bool, width, height)`.
  A generated base (no-photo path) must be approved by the user before it is used, and is frozen afterwards.
- `Look(id, space_id, name, design_spec_json, parent_look_id, created_at)`: immutable once saved; a variation is a new Look.
- `Render(id, look_id, photo_id, engine, brain, status, path, prompt, qa_json, error, created_at)`.
- `Job(id, kind, payload_json, status: queued|running|done|failed|cancelled, attempts, error, created_at, started_at, finished_at)`.
- `ChatMessage(id, space_id, role, content, spec_patch_json, created_at)`.

## Pipeline (fixed, with a chat front end)

This is not an open-ended agent loop: every step is bounded, and renders only happen on an explicit user click.

1. **Chat → spec patch.** The user message + current DesignSpec + VenueSpec go to the selected *brain*, which
   must return `{reply, spec_patch (RFC 7396 merge patch), ambiguities[]}`, validated against the JSON schema
   (one retry with the validation error on failure). Form edits produce the same merge patch.
2. **Rules (deterministic, Python).** `pipeline.rules.check(spec, venue_rules) -> (fixed_spec, warnings[])`.
   E.g. live candles + `live_candles: false` → `candles: "flameless"` and a warning. The LLM never invents or enforces rules.
3. **Prompt build (deterministic).** `pipeline.prompts.build_edit_prompt(spec, venue_spec)` → one
   plain-English instruction that lists what to add and an explicit "keep unchanged" list (walls, windows,
   ceiling, floor, chandeliers, camera angle).
4. **Render job** per photo. It always starts from the **original/base photo + full spec**, never by
   editing a previous render (this avoids drift).
5. **Verify.** `pipeline.verify.structure_score(original, render)`: edge-map SSIM on the upper 40% of the frame
   (ceiling, windows, upper walls), plus whether the image dimensions match. If the score falls below a threshold, it auto-retries once,
   then shows the render with a "may have altered the room" badge. Optional vision QA through the brain: "count tables, list colors".
6. **Save** the render on the Look. Compare views and PDF export only read saved renders and never regenerate.

### Find a real venue (venue-finder agent)

The user types a venue name, e.g. "Spring Mill Manor, North Wing, Ivyland PA". A brain **with web search/fetch
tools enabled** (claude: `--allowed-tools WebSearch,WebFetch`; copilot: its web fetch + `--allow-all-urls`;
codex: `--search`; kimi: its search tool) researches the public web and returns `VenueResearch`
(`packages/schema/venue-research.schema.json`): candidate matches with address, website, spaces (capacity,
dimensions, finishes, fixtures), publicly posted photos (image URL + source page + credit), published policies
(`rules_found`), and provided items. **Every field carries a source URL.**

The user picks the right match and reviews it in an import screen:
- Spaces → `Space` + `VenueSpec` (editable).
- `rules_found` → shown as *suggested* rules; they become `VenueRules` only when the user ticks them. This keeps the
  "the LLM never invents rules" guarantee.
- Photos → two options per photo: **Use as reference** (default; the photo URL/thumbnail is only passed as a reference image
  to generate an approved base view, like the no-photo path but grounded in the real room) or **Import as base photo**
  (the server downloads it after the user confirms they have the right to use it for personal planning; the credit and source are stored).
  Exports always print photo credits.
- Download safety: http(s) only, public IPs only (SSRF guard; re-check after redirects), image content-types only,
  ≤ 20 MB, ≤ 12 photos per space, EXIF stripped.

### No-photo path

`VenueSpec` (style, dimensions, ceiling, windows, floor, fixtures, notes) → engine `generate()` → one
hero "empty room" base image → the user approves it → stored as `Photo(kind="generated_base")` → from then on it works
exactly like an uploaded photo. Extra angles are offered but labelled *approximate*.

## Engine interface (`services/pipeline/pipeline/engines/base.py`)

```python
class ImageEngine(Protocol):
    id: str                       # "copilot" | "codex" | "mflux" | "scene3d" | "mock"
    label: str
    def detect(self) -> EngineStatus: ...   # installed? logged in? version; never raises
    def capabilities(self) -> EngineCaps: ...  # can_edit, can_generate, max_refs, sizes, typical_seconds, cost_note
    async def generate(self, req: GenerateRequest) -> ImageResult: ...
    async def edit(self, req: EditRequest) -> ImageResult: ...
```

`EditRequest(prompt, input_image: Path, ref_images: list[Path], size, quality, out_path: Path, timeout_s)`.
`ImageResult(path, width, height, engine, raw_log, seconds)`.

Engine notes (verified Nov 2026):
- **copilot**: `copilot -p "<instruction>" -s --model <m> --available-tools image_generation ...` in an
  isolated temp cwd. The built-in tool is `image_generation(prompt, input_images[{path}], size, quality)`. It
  saves to `~/.copilot/session-state/<id>/images/*.png` and reports `saved_to`. The engine asks the model to report
  `saved_to`, parses it from the output, and also falls back to the newest PNG in that dir created after the start time.
  Sizes: 1024x1024, 1536x1024, 1024x1536. About 30 s per image. Spends Copilot AI credits.
- **codex**: `codex exec --skip-git-repo-check -C <tmp> "$imagegen ..."` (needs the `image_generation` feature
  enabled and a ChatGPT login). Find the produced image in the cwd/output dir. Uses ChatGPT plan quota.
- **mflux**: subprocess `mflux-generate-*` (FLUX.2 Klein edit / Qwen-Image 2.1 edit, 4-bit). Free, slow on 16 GB Macs.
- **scene3d**: renders the DesignSpec as a three.js scene (parametric room + low-poly decor) via the web app's
  `/render/scene` route in headless Chromium (Playwright). It needs no AI and is stylized, not photoreal.
- **mock**: tints the input and stamps the prompt; used in tests and CI.

## Brain interface (`services/pipeline/pipeline/brains/base.py`)

```python
class Brain(Protocol):
    id: str   # "claude" | "codex" | "copilot" | "kimi" | "mock"
    def detect(self) -> BrainStatus: ...
    async def complete_json(self, system: str, user: str, schema: dict, images: list[Path] = []) -> dict: ...
```
- claude: `claude -p --output-format json --json-schema <schema> --tools ""` (no tool use).
- codex: `codex exec --output-schema <file> --sandbox read-only`.
- copilot: `copilot -p ... -s --available-tools ""`, then extract the JSON from the output.
- kimi: `kimi` CLI print mode, then extract the JSON.
- mock: a deterministic keyword parser (used for tests and as an offline fallback).

All subprocesses: no shell, explicit argv, timeout, temp cwd, stdout/stderr captured to the Render/Job log.
Each brain and engine is detected at startup; `GET /api/system/backends` reports what is available.

## API (summary; full contract in `docs/api.md`)

```
GET  /api/system/backends
POST /api/venues                 GET /api/venues              GET/PATCH /api/venues/{id}
POST /api/venues/{id}/spaces     GET/PATCH /api/spaces/{id}
POST /api/spaces/{id}/photos (multipart)   DELETE /api/photos/{id}
POST /api/spaces/{id}/generate-base  -> job   POST /api/photos/{id}/approve
POST /api/venues/research        {query, brain?} -> Job (kind venue_research; result.research: VenueResearch)
POST /api/venues/import          {research_job_id, match_index, space_names[], accepted_rules[], photos:[{url, mode: reference|import, rights_confirmed}]} -> Venue
POST /api/spaces/{id}/chat       {message, spec, brain} -> {reply, spec, warnings, ambiguities}
POST /api/spec/check             {spec, venue_id} -> {spec, warnings}
POST /api/spaces/{id}/looks      {name, spec, parent_look_id?}    GET /api/looks/{id}
POST /api/looks/{id}/render      {photo_ids?, engine, brain?} -> job ids
POST /api/renders/{id}/regenerate
GET  /api/jobs/{id}              GET /api/jobs?space_id=
GET  /api/looks/{id}/export.pdf
GET  /files/{path}               (serves data/ images)
```

## Jobs

A `jobs` table in SQLite (WAL mode). A separate worker process (`python -m api.worker`) claims jobs atomically
(`UPDATE ... WHERE status='queued' ... RETURNING`), and on startup resets jobs stuck in `running` back to queued.
Concurrency is set per engine (default 1 for copilot, codex and mflux). No Redis. `make dev` runs web + api + worker.

## Frontend

Next.js App Router; shadcn/ui on Base UI primitives; Tailwind v4 tokens with light and dark themes; Sonner toasts;
cmdk ⌘K palette (new venue, switch space, render, compare, export, switch engine); NumberFlow for counts
(tables, guests, render progress); an Aceternity-style spotlight hero and a dithered background (CUI-inspired)
on the landing page; motion follows emilkowalski/skills guidance (short, purposeful, respects reduced motion).

Screens: Landing → Venue (spaces, rules) → Space studio (photo strip | canvas | chat + spec form) →
Looks gallery → Compare (side by side, synced, with a slider) → Export.
