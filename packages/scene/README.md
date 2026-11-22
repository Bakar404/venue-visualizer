# @vv/scene

Deterministic, stylized venue scenes built entirely from Three.js primitives.
No AI, API keys, model downloads, or external environment assets. Requires React
19 and a browser with WebGL. R3F, drei, and three are runtime dependencies.

```tsx
import { VenueScene, layoutTables, colorFor } from "@vv/scene";
import type { DesignSpec, VenueSpec } from "@vv/scene";

// spec and venue are validated against packages/schema's JSON schemas.
// The parent MUST have an explicit height.
<div style={{ width: "100%", height: 600 }}>
  <VenueScene spec={spec} venueSpec={venue} mode="orbit" camera="wide" />
</div>
```

`mode` is `orbit` (default), `walk`, or `still`. Walk mode locks the pointer on
canvas click, supports WASD, and releases on Esc; movement is bounded by the
room, but does not simulate furniture collisions. `camera` is `wide` (default),
`top`, or `corner`; walk mode starts at eye level instead. `onReady` runs after
a completed draw. Still mode uses a single explicit draw, a preserved drawing
buffer, and pixel ratio 1; it sets `window.__VV_SCENE_READY = true` after rendering
and resets it when the scene changes or unmounts. Resizing triggers a new draw.
Walls and ceiling are inward-facing so outside cameras see a cutaway.

`layoutTables(spec, venue?)` returns feet, with x across the width, z along the
length, and the far wall at negative z. The room defaults to approximately
12 sq ft per guest (explicit guest count, otherwise table count times seats),
at least 40 by 30 ft, with a 12 ft ceiling. Tables default to 60 in (banquet/oval:
96 by 36 in), eight seats (cocktail: two). Mixed tables alternate round/banquet;
square and oval geometry is supported. Seats are exact, including odd counts.
The optional head/sweetheart table is additional to `tables.count`.

The grid reserves chair-inclusive footprints and attempts 5 ft walkways, then
4, 3, 2, 1, and 0 ft with explicit warnings. A dance floor is centered and sized
at 1.5 sq ft per guest, at least 12 by 12 ft. A head/sweetheart table goes at
the far wall. If even zero walkways cannot fit, exact counts are preserved using
non-overlapping overflow positions **outside** the supplied room, with a warning.
Reserved decor that cannot fit or overlaps is also reported. Impossible layouts
are not silently presented as feasible. Warnings appear in interactive views;
consumers can inspect the pure layout separately. This is a decor preview, not
a code-compliant seating plan.

`colorFor(text)` recognizes common decor names, multiword colors, lighting
descriptions, and six-digit hex. Unknown words hash deterministically to muted
hex colors. The TypeScript spec types mirror the JSON schemas locally until a
generated `@vv/schema` type package exists.

Linens support floor/lap/none and runners. All chair styles are currently
represented by the same stylized Chiavari primitive, not a photoreal catalog.
Centerpieces support low/medium/tall/mixed/none. Both live and flameless candle
requests use safe emissive candle primitives; absent/none candles draw nothing.
Ambient presets are daylight/evening_warm/dim/colored; uplighting, pin spots,
and string lights are optional. Window descriptions add light wall-panel
suggestions rather than reconstructing actual architectural openings. Effects,
installation details, flowers by species, and unrecognized extras are not modeled.

## Web render route contract (route implemented separately)

The Python `Scene3DEngine` opens:

```text
${VV_WEB_URL:-http://localhost:3000}/render/scene?spec=<encoded>&venue=<encoded>&camera=wide
```

- `spec`: UTF-8 JSON DesignSpec, base64url encoded without `=` padding.
- `venue`: UTF-8 JSON VenueSpec, same encoding; `{}` when unspecified.
- `camera`: `wide`, `top`, or `corner` (the engine currently requests `wide`).

Decode by restoring base64 padding and parsing UTF-8 JSON; validate against the
schemas before rendering. Mount `<VenueScene mode="still" ... />` in a viewport
with zero body margin, full width/height, and **exactly one canvas**. Do not put
controls, page chrome, warning banners, or loading indicators inside that canvas.
The engine captures only the canvas, not the surrounding DOM, at 1024x1024,
1536x1024, or 1024x1536; `auto` selects 1536x1024 for both generate and edit.
The route must not claim readiness before the scene's completed draw. It waits
for `window.__VV_SCENE_READY === true` under the request timeout, then screenshots
the canvas to PNG. Missing routes, incorrect dimensions, and timeout failures
are errors, not fallback images.

Install the optional Python runtime and browser from `services/`:

```sh
uv sync --extra scene3d
uv run --extra scene3d playwright install chromium
```

Detection checks Playwright importability, its installed Chromium executable,
and a one-second HTTP GET to `VV_WEB_URL`; failures return an unavailable status.
The route must be added before actual renders will work. `generate` and `edit`
both require `design_spec`; edit ignores input/reference images and reconstructs
the complete scene. Prompts and quality do not change the deterministic scene.

## Development

```sh
pnpm install
pnpm --filter @vv/scene build
pnpm --filter @vv/scene test
cd services && uv sync && uv run pytest -q tests/test_scene3d_layout.py
```

Build emits ESM and declarations with tsup; the `exports` map targets `dist`,
and `source` points to `src/index.ts`. TypeScript 6 is used because tsup's
declaration build requires the compiler API removed in TypeScript 7.
Tests never launch a real browser.
