# Venue Visualizer: web

The Next.js frontend for Venue Visualizer. It talks to the local API described in [`docs/api.md`](../../docs/api.md) and imports its data types from the `@vv/schema` workspace package.

## Run it

```sh
pnpm install
pnpm --filter web dev          # http://127.0.0.1:3000, expects the API on :8000
pnpm --filter web dev --port 3123   # extra Next options are passed through
```

`dev` and `start` run `next dev` / `next start` through [`scripts/next-with-shim.mjs`](../../scripts/next-with-shim.mjs), which binds to `127.0.0.1` and preloads `services/api/lan_proxy.cjs`. The shim signs each proxied request's client address (`X-VV-Client`) with the key in `VV_LAN_PROXY_KEY` or `<data dir>/.vv-proxy-key` (created by whichever of the web and API starts first). The API treats a proxied request as coming from this computer only with that attestation, so starting `next` directly gets 403 from the API. If you set `VV_DATA_DIR`, give the web and the API the same absolute path. The wrapper refuses a non-loopback `--hostname`: to open the app on a phone, use `make dev-lan` (or `make lan`) from the repo root, which builds the app and serves it with `next start` (never the dev server) on your Wi-Fi address, with a pairing code.

Requests to `/api/*` and `/files/*` are proxied to `VV_API_URL`, which defaults to `http://localhost:8000`. The rewrite is in `next.config.ts`:

```sh
VV_API_URL=http://127.0.0.1:9000 pnpm --filter web dev
```

### Demo mode (no backend)

```sh
NEXT_PUBLIC_VV_MOCK=1 pnpm --filter web dev
```

- The app is served by an in-memory API (`src/lib/mock-api.ts`). The seed data is a fictional venue, Larkspur House: a ballroom with two photos and two Looks (one a variation of the other) and a garden terrace, plus a barn at Hollow Creek Farm.
- Renders return the matching decorated photo for the photo and Look. Uploaded photos come back lightly tinted.
- Render jobs finish about 2 seconds after they start. Venue research and video tours finish after about 3 seconds: research always finds "Larkspur House", and a video tour always yields 8 frames across two spaces.
- To simulate a failed render, put the word "fail" in a Look's notes.
- Data resets when you reload the page.
- Demo images are AI-generated photographs in `public/samples/photoreal/` (see its `CREDITS.md`). The catalog is `src/lib/samples.ts`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm --filter web dev` | Dev server on 127.0.0.1:3000, with the attestation shim |
| `pnpm --filter web build` | Production build with type checking |
| `pnpm --filter web start` | Serve the production build on 127.0.0.1:3000, with the attestation shim |
| `pnpm --filter web lint` | ESLint, including the React Compiler hook rules |
| `pnpm --filter @vv/schema generate` | Regenerate `packages/schema/index.ts` from the JSON schemas |

## Map

| Route | Screen |
| --- | --- |
| `/` | Landing page, with live engine and brain detection from `GET /api/system/backends` |
| `/venues` | Venue list |
| `/venues/new` | New venue: find it on the web, upload photos, a video tour, or describe it. `?tab=find\|upload\|video\|describe` |
| `/venues/[id]` | Venue rules and rooms |
| `/spaces/[id]` | Studio: photos, render canvas with before and after slider, chat and plan details. `?look=` selects a Look |
| `/spaces/[id]/looks` | Looks gallery. Select two to compare |
| `/compare?a=&b=` | Side-by-side or slider comparison for each photo, plus the plan differences |
| `/render/scene?spec=&venue=&camera=` | Internal, not linked: the layout guide the backend screenshots (contract in `packages/scene/README.md`). No app chrome, `noindex` |

Press ⌘K (or Ctrl+K) anywhere for the command palette: new venue, jump to a venue or room, render all, save Look, make a variation, compare, export, switch engine and toggle theme.

Source layout:

- `src/lib/api.ts`: typed client. `src/lib/types.ts` holds the API types and `src/lib/errors.ts` the `ApiError` class.
- `src/lib/queries.ts`: React Query hooks.
- `src/lib/jobs.ts`: job polling and the toasts that report progress.
- `src/lib/spec.ts`: helpers for working with a DesignSpec (rules, diffs, palette colours).
- `src/components/studio/*`: the studio.
- `src/components/new-venue/*`: the new-venue flow, including the research import review and the video frame review.
- `src/components/ui/*`: shadcn/ui components built on Base UI.

## Design notes

- Type is Instrument Serif for display and Geist for the interface. The base is ivory and stone, with one bottle-green accent (`--brand`). Light and dark themes come from next-themes.
- Motion lasts 150–250 ms and eases out on enter. Nothing animates on typing. `prefers-reduced-motion` is respected, including by the dithered canvas on the landing page, which also pauses when the tab is hidden or the canvas is off screen.
