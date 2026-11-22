# Fresh-install walkthrough (2026-11-22)

A clean `git clone` on macOS, following the README exactly as a new person would. Claude Code and GitHub Copilot CLI
were installed; Codex, Kimi and mflux were not.

## What worked
- `make setup` installed everything in about 5 s from cache.
- `make doctor` listed the prerequisites and each AI tool, with install and sign-in commands.
- `make dev`, then opening http://localhost:3000, **redirected to `/setup`**.
- The Claude **Test chat** passed in 3.6 s. The Copilot **Test images** step asked to confirm credit use first, then
  passed in 19.4 s and showed the sample image. Copilot then changed from "Unknown" to "Ready".
- Choosing the defaults and clicking **Finish setup** saved them, and the header chip turned green ("Claude Code + Copilot").
- At 375 px wide, the landing page and `/venues/new` had no horizontal overflow.

## Findings → fixes (acceptance tests in parentheses)

| ID | What a newcomer sees | Fix |
|---|---|---|
| FI1 | `make setup` ends with a boxed pnpm warning: "Ignored build scripts: esbuild. Run pnpm approve-builds…". It is harmless but alarming. | Declare esbuild in the root `package.json` `pnpm.ignoredBuiltDependencies` (its native binary comes from optional platform packages; the scene build already works without the postinstall). (A pytest that parses `package.json`.) |
| FI2 | `make doctor` ends with `make: *** [doctor] Error 1`, which looks like a crash when it really means "not ready yet". | `make doctor` always exits 0 and prints the verdict. `make doctor-ci` (or `python -m api.doctor --strict`) keeps the exit code for scripts and CI. (pytest: parse the Makefile and run the doctor.) |
| FI3 | Doctor lines such as "✗ Codex installed \| ? signed in" are hard to read. | Use one plain status phrase per tool: "✓ Claude Code: ready (signed in)", "✗ Codex: not installed", "? GitHub Copilot: installed; sign-in unknown, run Test in Setup", followed by the commands. (pytest snapshot of the doctor text.) |
| FI4 | "Do this next: run the GitHub Copilot engine test in Setup" assumes the app is already running. | Say: "Start the app with `make dev`, open http://localhost:3000/setup and click **Test images** on GitHub Copilot." (pytest.) |
| FI5 | Setup says "You have a ready brain and a ready image engine" while Copilot is still "Unknown", which contradicts the doctor. | Single source of truth: the API's `GET /api/system/setup` returns `ready`, `likely` and `missing` per role. Both the UI summary and the doctor use it. "Unknown" counts as *likely* ("Copilot will probably work; run Test to be sure"), not as ready. (pytest + e2e.) |
