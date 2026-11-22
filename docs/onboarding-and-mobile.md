# First-run setup and phone support: spec and acceptance tests

Goal: someone who just cloned the repo gets from `git clone` to a first photoreal render without reading code,
knows which AI subscription does what, and can use the app comfortably on a phone.

## 1. The new-installer journey

1. `make setup`, then **`make doctor`**, which prints a checklist:
   - Prerequisites: Node, pnpm, Python, uv, ffmpeg (needed for video tours), Playwright Chromium (needed for exact table layouts).
   - Each AI CLI:
     - installed?
     - logged in?
     - what it unlocks: chat, web research, vision, images
     - the exact install and login commands for this OS
   - It ends with "You're ready", or "Do this next: …". Exit code 0 when at least one brain and one image engine are
     ready, else 1.
2. `make dev` → open http://localhost:3000.
3. **The first visit goes to `/setup`** when setup isn't complete (no ready brain, no ready image engine, or the user
   never finished setup).
4. `/setup` is a short guided page with 3 steps:
   - **Step 1: Your AI tools.** One card per provider: Claude Code, Codex, GitHub Copilot, Kimi Code, Local FLUX (mflux).
     - Status pill: Not installed / Installed, not signed in / Ready / Unknown (can't tell; run a test).
     - "Used for" chips.
     - Install and sign-in commands with copy buttons.
     - A plain cost note ("uses your Copilot AI credits", "free, runs on this Mac").
     - **Check again** re-detects without restarting.
     - A **Test** button runs a tiny real call (brain: a 1-line JSON answer; image engine: a small test image) and
       shows pass/fail, time taken and the CLI's message. Image tests warn first that they use credits.
     - An "Advanced" field holds per-provider options, e.g. Claude's config folder
       (`CLAUDE_CONFIG_DIR`, for people with several Claude logins) and the Copilot chat model.
   - **Step 2: Defaults.** Pick a default brain and a default image engine from the ready ones (the recommended one is
     preselected), and choose whether web research is allowed.
   - **Step 3: Try it.** Open the demo venue, or "Add my venue", which goes to `/venues/new`.
5. After setup, the header shows an **AI status chip** (green "Claude Code + Copilot", or amber "Set up AI"). It opens
   `/setup` at any time. Studio pickers show only ready backends. If a chosen backend becomes unavailable, the
   UI explains why and links to setup instead of failing with a raw error.

## 2. Phone support

- **Every page works at 390×844:**
  - no horizontal scrolling;
  - touch targets ≥ 44×44 px;
  - text ≥ 14 px for body;
  - safe-area insets respected;
  - dialogs become bottom sheets.
- **Studio on a phone:**
  - a bottom tab bar (Photos · Preview · Chat · Plan);
  - the chat composer stays above the on-screen keyboard (`visualViewport`);
  - the before/after slider works with touch;
  - Render is reachable from every tab.
- **Use the phone's camera:**
  - "Take photos" uses `<input accept="image/*" capture="environment" multiple>`;
  - "Record a walkthrough" uses `accept="video/*" capture="environment"`;
  - both are shown only on touch devices, next to the normal file pickers.
- **Open on your phone (opt-in LAN mode):**
  - `make dev-lan` (or the toggle in Setup → Advanced) binds the API and web to the local network;
  - it adds the machine's LAN address to the allowed hosts and origins;
  - Setup shows a QR code and URL for the phone;
  - it's off by default. A warning explains that anyone on the same Wi-Fi could open the app, and offers a one-time
    **pairing code**: the phone must enter a 6-digit code shown on the computer before any LAN request is accepted,
    and the paired device gets a cookie.

## 3. API contract (additions)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/settings` | | `Settings` |
| PATCH | `/api/settings` | partial `Settings` | `Settings` (persisted in SQLite, wins over env) |
| POST | `/api/system/backends/refresh` | | same as `GET /api/system/backends`, re-detected now |
| POST | `/api/system/backends/{kind}/{id}/test` | `{confirm_credits?: boolean}` | `{ok, seconds, detail, sample_url?}`. Image tests need `confirm_credits: true` (except mock and mflux) |
| GET | `/api/system/setup` | | `{complete: boolean, missing: ("brain"\|"engine"\|"defaults")[], steps: {...}}` |
| GET | `/api/system/lan` | | `{enabled, url, qr_svg, pairing_required: true}` (desktop/localhost only) |
| POST | `/api/system/lan/pair` | `{code}` | sets the device cookie (LAN only) |

```ts
type Settings = {
  default_brain: string | null; default_engine: string | null; allow_web_research: boolean;
  setup_completed_at: string | null;
  providers: { claude?: { config_dir?: string | null }, copilot?: { model?: string | null }, kimi?: { bin?: string | null } };
  lan: { enabled: boolean };
};
```

`BackendStatus` gains:
- `logged_in: true | false | null`. Claude uses `claude auth status` (JSON `loggedIn`). Codex uses `codex login status`.
  Copilot and Kimi report null ("Unknown, run a test"). mflux reports true when installed.
- `install: {macos: string, linux: string, docs_url: string}`
- `login: string | null`, the sign-in command
- `used_for: ("chat"|"web_research"|"vision"|"images")[]`
- `cost_note: string`
- `last_test: {ok, at, seconds, detail} | null`

## 4. Acceptance tests (written first, proof in `docs/proof/S*-red.txt` → `S*-green.txt`)

| ID | Test |
|---|---|
| S1 | pytest: `doctor` reports each prerequisite and CLI with the install and login commands. Exit 1 with nothing installed (monkeypatched PATH), exit 0 with a ready brain and engine |
| S2 | pytest: settings persist across restarts and override env defaults; `providers.claude.config_dir` is passed as `CLAUDE_CONFIG_DIR` to the claude subprocess |
| S3 | pytest: login detection parses `claude auth status` JSON (logged in or out); unknown is null |
| S4 | pytest: a brain test calls the CLI once with a tiny prompt; an image test needs `confirm_credits` (422 without it); results are stored in `last_test` |
| S5 | e2e: a fresh install (mock "nothing ready") is redirected from `/` to `/setup`, sees "Not installed" with copyable commands, and Check again reflects a newly installed tool |
| S6 | e2e: completing setup (choose defaults) sets `setup_completed_at`; `/` then shows the landing; the header chip says ready; Studio pickers default to the chosen backends |
| S7 | e2e @mobile: on every route (`/`, `/setup`, `/venues`, `/venues/new` with all tabs, a Studio with all tabs, Looks, Compare) there is no horizontal overflow, all buttons and links are ≥ 44 px tall or wide, and screenshots are saved |
| S8 | e2e @mobile: in the Studio, with the keyboard simulated (visualViewport resized), the composer stays visible; the slider drags by touch; Render is reachable from each tab |
| S9 | e2e @mobile: "Take photos" and "Record a walkthrough" inputs have the right `accept` and `capture` |
| S10 | pytest: LAN mode is off by default. When enabled, a LAN Host is rejected until it pairs with the right code; a wrong code is rate-limited; localhost is unaffected |
