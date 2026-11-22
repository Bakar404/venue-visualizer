# Venue Visualizer

**See your event before it happens.** Give it your venue and describe the look you want in plain words. You get back
photoreal images of *your* room with the tables, linens, flowers and lighting in place. Compare Looks side by side
and export a PDF for your florist or planner.

There are three ways to bring a venue in:

1. **Name it.** "Grand Hotel, Riverside Ballroom, Springfield". An agent searches the web for the venue's own photos,
   spaces and published policies. Every fact links to its source and nothing is saved until you review it.
2. **Upload photos** you already have (5–30 per space).
3. **Upload a video walkthrough.** The app picks the sharpest, most varied frames, works out which room each frame shows,
   and turns them into base photos.

No photos at all? Describe the room and it generates an empty base view for you to approve first.

## Bring your own AI: no API keys

Venue Visualizer runs **on your computer** and uses the AI tools you're **already logged into**, through each vendor's
official CLI:

| Used for | Supported |
|---|---|
| Understanding your description, chat, venue research, video understanding | Claude Code, Codex CLI, GitHub Copilot CLI, Kimi Code CLI |
| Photoreal images | GitHub Copilot CLI image tool, Codex CLI `$imagegen`, local FLUX via [mflux](https://github.com/mflux-community/mflux) (Apple Silicon, free) |

Any one brain plus any one image engine is enough. Usage counts against your own subscription (Copilot AI credits,
ChatGPT plan quota, and so on). The app never reads your CLI credentials and never calls vendor APIs directly. Because
it uses your personal subscriptions, it is meant to run locally, not as a hosted service.

Results are always photographs of your room, never 3D renders. When an exact table count matters, the app quietly
renders a plain layout guide and hands it to the image model as a placement reference.

## Setup

Requirements: macOS or Linux, Node 22+, pnpm 10+, Python 3.11+, [uv](https://docs.astral.sh/uv/), ffmpeg (for video tours),
and at least one of the CLIs above, installed and logged in.

```bash
git clone <this repo> && cd venue-visualizer
cp .env.example .env            # optional overrides; no keys needed
make setup                      # uv sync + pnpm install
cd services && uv sync --extra scene3d && uv run playwright install chromium && cd ..   # optional: exact table layouts
make dev                        # API :8000, worker, web :3000
```

Open http://localhost:3000. The landing page shows which brains and image engines it detected.

To try the UI with no CLIs at all: `NEXT_PUBLIC_VV_MOCK=1 pnpm dev:web` (demo data, AI-generated sample photos).

## Run the sample

```bash
make sample                                         # mock engine, no credits
cd services && uv run python ../samples/run_sample.py --engine copilot   # real render with Copilot
```

## Tests

```bash
make test
```

## Layout

```
apps/web            Next.js app (studio, venue finder, video review, compare, export)
services/api        FastAPI + SQLite job queue + worker
services/pipeline   brains (CLI LLMs), engines (CLI image tools), rules, prompts, video, research, safe fetch
packages/schema     DesignSpec / VenueSpec / VenueResearch JSON Schemas (source of truth) + TS types
packages/scene      layout-guide renderer (internal)
docs/               architecture, API contract, decisions log
```

## Privacy and content

- Everything stays on your machine in `data/` (gitignored). Uploads have EXIF/GPS metadata stripped.
- Photos found on the web stay credited to their source and are for your personal planning. Exports print the credits.
- Venue rules (no open flame, no fog, …) are only what you enter or explicitly accept. The AI never invents or relaxes them.

## Credits

UI built with [shadcn/ui](https://ui.shadcn.com/) on [Base UI](https://base-ui.com/), [Sonner](https://sonner.emilkowal.ski/),
[cmdk](https://github.com/dip/cmdk) and [NumberFlow](https://number-flow.barvian.me/). Inspiration came from
[Aceternity UI](https://ui.aceternity.com/), [21st.dev](https://21st.dev), [Beautiful UI](https://www.beautifului.dev/),
[RareUI](https://rareui.in/) and [CUI](https://yappologistic.github.io/CUI/). Motion guidance comes from
[emilkowalski/skills](https://github.com/emilkowalski/skills) (MIT, vendored in `.claude/skills`).
