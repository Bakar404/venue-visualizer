# First-run setup and phone support: spec and acceptance tests

Goal: someone who just cloned the repo gets from `git clone` to a first photoreal render without reading code,
knows which AI subscription does what, and can use the app comfortably on a phone.

## 1. The new-installer journey

1. `make setup`, then **`make doctor`**, which prints a checklist:
   - Prerequisites: Node, pnpm, Python, uv, ffmpeg (needed for video tours), Playwright Chromium (needed for exact table layouts).
   - One plain line per AI CLI, then its commands indented underneath:
     - "✓ Claude Code: ready (signed in)", "✗ Codex: not installed", or
       "? GitHub Copilot: installed, sign-in unknown, run Test in Setup";
     - what it unlocks: chat, web research, vision, images;
     - the exact install command, the sign-in command (plus what to do once it starts) and any one-time image setup.
   - It ends with "You're ready", or "Do this next: …" naming the full path, e.g. "Start the app with `make dev`, open
     http://localhost:3000/setup and click Test images on GitHub Copilot".
   - It uses the same readiness rule as `/setup` (see §3): *ready* means signed in or a passing Test; *likely* means
     installed with sign-in unknown and no failed Test, which the doctor reports as "will probably work, run Test to
     be sure" and never as ready.
   - `make doctor` always exits 0 after printing the verdict, so `make setup && make doctor` reads cleanly.
     `make doctor-ci` (`--strict`) exits 1 unless a brain and an image engine are ready.
2. `make dev` → open http://localhost:3000.
3. **The first visit goes to `/setup`** when setup isn't complete (no ready brain, no ready image engine, or the user
   never finished setup).
4. `/setup` is a short guided page with 3 steps:
   - **Step 1: Your AI tools.** One card per provider: Claude Code, Codex, GitHub Copilot, Kimi Code, Local FLUX (mflux).
     - Status pill: Not installed / Installed, not signed in / Ready / Unknown (can't tell; run a test). If chat and
       images differ, the pill shows each role's status separately.
     - "Used for" chips.
     - Install and sign-in commands with copy buttons. Only the command is copied; follow-up guidance such as
       "then type /login" is plain text next to it. Without `navigator.clipboard` (plain-HTTP LAN pages) the button
       falls back to `document.execCommand('copy')`, and it says "Copied" or "Couldn't copy" either way.
     - A plain cost note ("uses your Copilot AI credits", "free, runs on this Mac").
     - **Check again** re-detects without restarting.
     - A **Test** button runs a tiny real call (brain: a 1-line JSON answer; image engine: a small test image) and
       shows pass/fail, time taken and the CLI's message. Image tests warn first that they use credits. From a
       paired phone every image test asks first, including the free local engine (it busies the computer).
     - The summary under the heading uses the readiness rule: "You have a ready brain and a ready image engine", or
       for a tool that is only likely, "Copilot will probably work. Run Test to be sure." It never says ready for a
       likely tool.
     - An "Advanced" field holds per-provider options, e.g. Claude's config folder
       (`CLAUDE_CONFIG_DIR`, for people with several Claude logins) and the Copilot chat model.
   - **Step 2: Defaults.** Pick a default brain and a default image engine from the ready ones (the recommended one is
     preselected), and choose whether web research is allowed. Likely tools are listed but disabled with "Run Test
     first"; signed-out tools and tools whose last Test failed aren't offered.
   - **Step 3: Try it.** Open the demo venue, or "Add my venue", which goes to `/venues/new`. Finish setup marks
     setup complete in the cache straight away, so the links work at once; while the setup gate doesn't yet know
     where to go it shows a neutral loading screen instead of flashing the page.
5. After setup, the header shows an **AI status chip** (green "Claude Code + Copilot", or amber "Set up AI"). It opens
   `/setup` at any time. Studio pickers offer only ready backends; likely ones show disabled with "Run Test first". If a chosen backend becomes unavailable, the
   UI explains why and links to setup instead of failing with a raw error.

## 2. Phone support

- **Every page works at 390×844:**
  - no horizontal scrolling;
  - touch targets ≥ 44×44 px;
  - text ≥ 14 px for body;
  - safe-area insets respected (the header pads the top inset; the Studio's height subtracts the top and bottom
    insets);
  - dialogs become bottom sheets.
- **Studio on a phone:**
  - a bottom tab bar (Photos · Preview · Chat · Plan);
  - Studio tabs are `role="tab"` with `aria-controls` pointing at labelled `role="tabpanel"` panels;
  - the chat composer stays above the on-screen keyboard (`visualViewport`). The keyboard inset only applies while a
    text field is focused and the page isn't pinch-zoomed (`visualViewport.scale` ≈ 1);
  - the before/after slider works with touch;
  - Render is reachable from every tab.
- **Use the phone's camera:**
  - "Take photos" uses `<input accept="image/*" capture="environment" multiple>`;
  - "Record a walkthrough" uses `accept="video/*" capture="environment"`;
  - both are shown only on touch devices, next to the normal file pickers.
- **Open on your phone (opt-in LAN mode):**
  - only `make dev-lan` (alias `make lan`) turns LAN mode on (`VV_LAN=1` plus a per-run proxy key). There is no
    Setup toggle: `settings.lan.enabled` is read-only and reflects how the app was started, and trying to change it
    returns 422 "Restart with `make dev-lan` to open the app on your phone". `make dev`, `make web`,
    `pnpm dev:web` and `pnpm --filter web dev|start` always bind to 127.0.0.1;
  - LAN mode serves a **production build**: `make dev-lan` runs `pnpm --filter web build` (a minute or two), then
    `next start` on the LAN address. The Next dev server (its `/_next/mcp` endpoint, hot reload and error overlays)
    never listens beyond 127.0.0.1, so code edits need a restart of `make dev-lan` to show on the phone; use
    `make dev` while developing;
  - only the web binds to the local network; the API stays on 127.0.0.1 behind Next.js, which attests each phone's
    address. LAN mode adds the address of the default-route interface to the allowed hosts and origins (Docker,
    bridge, VPN and tunnel interfaces are skipped);
  - Setup shows a QR code and URL for the phone. Both point at `/pair`. If an unpaired phone opens any other page,
    the API's 403 "Pair this device…" sends it to `/pair?next=<that page>`; after pairing it goes back there and
    reloads all data;
  - `/pair` keeps only digits (a pasted "12 34 56" works), and after too many attempts it counts down the
    `Retry-After` seconds with Pair disabled. Once paired, later edits are ignored;
  - it's off by default. A warning explains that anyone on the same Wi-Fi could open the app, and offers a one-time
    **pairing code**: the phone must enter a 6-digit code shown on the computer before any LAN request is accepted,
    and the paired device gets a cookie;
  - the code is shown only on this computer (never in the log). The panel shows the current code (issuing
    one if none is active) without extending its ten-minute lifetime; **New code** (`POST /api/system/lan/code`)
    replaces it. The panel polls for changes, counts down to expiry ("Expires in 9:41"), and fetches a fresh code
    when it runs out or after a successful pairing. Ten wrong codes from any address retire it and lock pairing for 5 minutes, on
    top of the per-device limit; meanwhile the panel says "Pairing is paused for N s after too many wrong codes" and
    counts down;
  - Setup lists paired devices (browser and OS, paired and last seen) and can forget one or all. Forgetting all
    also invalidates every outstanding device cookie. Device cookies last 30 days and only work while
    `make dev-lan` is running; starting with `make dev` keeps the list but ignores the cookies;
  - known limitation (availability only): anyone on the Wi-Fi can keep pairing locked by sending wrong codes every
    5 minutes. They still can't pair or see anything, and already-paired phones keep working; stop `make dev-lan`
    or switch to a trusted network.

## 3. API contract (additions)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/settings` | | `Settings` |
| PATCH | `/api/settings` | partial `Settings` | `Settings` (persisted in SQLite, wins over env). This computer only: 403 from paired phones or proxied non-localhost names, before the body is read (the same 403 whatever they send); 422 when changing `lan` |
| POST | `/api/system/backends/refresh` | | same as `GET /api/system/backends`, re-detected now |
| POST | `/api/system/backends/{kind}/{id}/test` | `{confirm_credits?: boolean}` | `{ok, seconds, detail, sample_url?}`. Image tests need `confirm_credits: true` (except mock and mflux on this computer; a paired phone always confirms). One test per backend at a time (409); brain tests at most every 10 s and image tests every 60 s per backend (429 + `Retry-After`). The last 5 sample images are kept |
| GET | `/api/system/setup` | | `{complete: boolean, missing: ("brain"\|"engine"\|"defaults")[], steps: {...}, brain: {ready: string[], likely: string[], missing: boolean}, engine: {…same}, client: "owner"\|"phone"}` |
| GET | `/api/system/lan` | | `{enabled, url, qr_svg, pairing_code, pairing_required: true, pairing_expires_in, pairing_locked_for}` (this computer only; shows the current code without extending its expiry, issuing one if none is active) |
| POST | `/api/system/lan/code` | | same as `GET /api/system/lan`, with a fresh code (this computer only) |
| POST | `/api/system/lan/pair` | `{code}` | sets the device cookie (LAN only); the code is then retired |
| GET | `/api/system/lan/devices` | | `{id, label, paired_at, last_seen, expires_at}[]` (this computer only) |
| DELETE | `/api/system/lan/devices/{id}` | | 204; forgets one device (404 if unknown) |
| DELETE | `/api/system/lan/devices` | | 204; forgets all devices and rotates the cookie signing key |

```ts
type Settings = {
  default_brain: string | null; default_engine: string | null; allow_web_research: boolean;
  setup_completed_at: string | null;
  providers: { claude?: { config_dir?: string | null }, copilot?: { model?: string | null }, kimi?: { bin?: string | null } };
  lan: { enabled: boolean }; // read-only: true only under `make dev-lan`
};
```

`BackendStatus` gains:
- `logged_in: true | false | null`. Claude uses `claude auth status` (JSON `loggedIn`). Codex uses `codex login status`.
  Copilot and Kimi report null ("Unknown, run a test"). mflux reports true when installed.
- `install: {macos: string, linux: string, docs_url: string}`
- `login: {command: string, note: string | null} | null`: the sign-in command (copyable) and what to do once it
  starts (plain text), e.g. `{command: "claude", note: "then follow the sign-in prompt"}`,
  `{command: "copilot", note: "then type /login"}`
- `image_setup: string | null`, a one-time command that turns on images (Codex)
- `used_for: ("chat"|"web_research"|"vision"|"images")[]`
- `cost_note: string`
- `last_test: {ok, at, seconds, detail} | null`

**Readiness** (`services/api/readiness.py`, mirrored in `apps/web/src/lib/backends.ts`; used by `/api/system/setup`,
`make doctor` and the web): *ready* = available and (`logged_in: true` or `last_test.ok`); *likely* = available,
`logged_in: null` and no failed last test; otherwise missing, signed out or failed. Setup is complete only with a
ready brain, a ready engine and saved defaults.

## 4. Acceptance tests (written first, proof in `docs/proof/S*-red.txt` → `S*-green.txt`)

| ID | Test |
|---|---|
| S1 | pytest: `doctor` reports each prerequisite and CLI with the install and login commands. With `--strict` (`make doctor-ci`): exit 1 with nothing installed (monkeypatched PATH), exit 0 with a ready brain and engine; without it, always exit 0 after the verdict (FX-FI2) |
| S2 | pytest: settings persist across restarts and override env defaults; `providers.claude.config_dir` is passed as `CLAUDE_CONFIG_DIR` to the claude subprocess |
| S3 | pytest: login detection parses `claude auth status` JSON (logged in or out); unknown is null |
| S4 | pytest: a brain test calls the CLI once with a tiny prompt; an image test needs `confirm_credits` (422 without it); results are stored in `last_test` |
| S5 | e2e: a fresh install (mock "nothing ready") is redirected from `/` to `/setup`, sees "Not installed" with copyable commands, and Check again reflects a newly installed tool |
| S6 | e2e: completing setup (choose defaults) sets `setup_completed_at`; `/` then shows the landing; the header chip says ready; Studio pickers default to the chosen backends |
| S7 | e2e @mobile: on every route (`/`, `/setup`, `/venues`, `/venues/new` with all tabs, a Studio with all tabs, Looks, Compare) there is no horizontal overflow, all buttons and links are ≥ 44 px tall or wide, and screenshots are saved |
| S8 | e2e @mobile: in the Studio, with the keyboard simulated (visualViewport resized), the composer stays visible; the slider drags by touch; Render is reachable from each tab |
| S9 | e2e @mobile: "Take photos" and "Record a walkthrough" inputs have the right `accept` and `capture` |
| S10 | pytest: LAN mode is off by default. When enabled, a LAN Host is rejected until it pairs with the right code; a wrong code is rate-limited; localhost is unaffected |

Security follow-ups (proof in `docs/proof/SEC*-red.txt` → `SEC*-green.txt`, tests in `services/tests/test_sec_*.py` and `test_sec2_*.py`; the end-to-end check is `docs/proof/SEC2-live.txt`):

| ID | Test |
|---|---|
| SEC1 | pytest: every non-LAN start command binds the web to 127.0.0.1 and `dev-lan` passes exactly one `--hostname`; `Host: localhost:3000` relayed for a Wi-Fi peer is rejected; the API warns if the web is reachable from the network outside LAN mode; `kimi.bin` and `claude.config_dir` are strictly validated; settings writes come only from this computer (the proxied-request rule is superseded by SEC2-1) |
| SEC2 | pytest: settings can't turn LAN mode on (422 with the `make dev-lan` hint); a saved toggle from older versions is ignored; `python -m api.lan` binds to 0.0.0.0 only with `VV_LAN=1` and the proxy key |
| SEC3 | pytest: the pairing code is one-time, expires 10 minutes after issuance even when `GET /api/system/lan` polls it (`POST /api/system/lan/code` replaces it), and 10 failures across all IPs retire it and lock pairing for 5 minutes; the code isn't logged |
| SEC4 | pytest: paired devices are listed, forgotten one by one or all at once (old cookies stop working); cookies are ignored outside LAN mode and expire after 30 days; `last_seen` updates |
| SEC5 | pytest: one running test per backend; brain/image cooldowns return 429 with `Retry-After`; phones must confirm credits for image tests; only the last 5 sample images are kept |
| SEC6 | pytest: WebSocket upgrades go through the same policy; non-local ones are refused |
| SEC7 | pytest: the LAN address is the default-route interface's, skipping Docker/bridge/utun/VPN interfaces |
| SEC2-1 | pytest: a loopback socket with `X-Forwarded-Host: localhost:3000` and no attestation is not local (403 on `/api/settings` and owner-only endpoints); any forwarding header or a Host other than the API's own counts as proxied; an attestation for 127.0.0.1/::1 is local and owner, one for a LAN IP must pair and is never owner; a direct loopback request is still local; the key file is 0600, 64 hex chars, created atomically and shared by the API and the shim whichever starts first; every web start goes through `scripts/next-with-shim.mjs` on 127.0.0.1 |
| SEC2-2 | pytest: `make dev-lan`/`make lan` builds and runs `next start` on the LAN address (never `next dev`), with the API on 127.0.0.1 and the worker; the wrapper refuses `next dev` on a non-loopback hostname even with `VV_LAN=1`; Next's loaded config has `experimental.mcpServer: false` under `VV_LAN=1` |
| SEC2-3 | pytest: non-owners get the identical 403 for an existing vs missing `config_dir` (and for any body, which is never read); the owner still gets the same 422 messages; saved paths inside the data folder are dropped on read |

Fresh-install and review fixes (proof in `docs/proof/FX-*-red.txt` → `FX-*-green.txt`, plus `FX-*.png` for UI items;
pytest in `services/tests/test_fx_*.py`, Playwright in `apps/web/e2e/fx-*.spec.ts`):

| ID | Test |
|---|---|
| FI1–FI4 | pytest: esbuild is in `pnpm.ignoredBuiltDependencies`; `make doctor` exits 0 with a verdict and `make doctor-ci` keeps the exit code; one plain line per tool; the next step names `make dev`, the `/setup` URL and the button |
| FI5 | pytest + vitest + e2e: `GET /api/system/setup` returns `ready`/`likely`/`missing` per role from the shared readiness rule; a likely-only engine isn't complete; the doctor and the web summary say "will probably work. Run Test to be sure" |
| R1, R10 | pytest + vitest + e2e: the QR code and URL point at `/pair`; an unpaired phone is sent to `/pair?next=…`, pairs, and lands back with every query refetched; an outside `next` goes home |
| R2 | vitest + e2e: defaults and Studio pickers offer only ready backends; likely ones are disabled with "Run Test first"; failed ones aren't offered |
| R3 | pytest + vitest + e2e: `POST /api/system/lan/code` rotates (owner only); `GET` doesn't; the panel counts down, refreshes at expiry and shows the lockout countdown |
| R4 | pytest + vitest + e2e: `client` is reported; a paired phone confirms every image test, mflux included, and sends `confirm_credits` |
| R5, R11 | e2e: `/pair` counts down `Retry-After` with Pair disabled, keeps a success, and normalises pasted codes to six digits |
| R6, R7 | e2e + vitest: the Studio fits between the safe-area insets; the keyboard inset needs a focused text field and no pinch zoom |
| R8 | pytest + vitest + e2e: copy falls back to `execCommand` and reports success or failure; sign-in is a copyable command plus a plain-text note |
| R9 | e2e: Try it works right after Finish setup; the setup gate shows a neutral loading state |
| R12 | vitest: the mock matches the regenerated OpenAPI for setup, lan, settings errors, owner/phone 403s and test cooldowns |
| R13 | e2e: Studio tabs control labelled tab panels; S7 requires buttons and tabs to be ≥ 44 × 44 px |
