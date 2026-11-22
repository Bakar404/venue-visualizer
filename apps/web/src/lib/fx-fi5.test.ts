// FX-FI5 / FX-R2: one readiness rule (services/api/readiness.py) shared by the API, the doctor and the web.
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { backendState, isLikely, isReady, likelyNote, normalizeBackends } from "@/lib/backends";
import * as system from "@/lib/mock-system";
import { systemHooks } from "@/lib/mock-system";
import type { Backends, BackendStatus } from "@/lib/types";

const at = "2026-11-22T09:00:00Z";
const test = (ok: boolean) => ({ ok, at, seconds: 2, detail: "" });

describe("backendState mirrors services/api/readiness.py", () => {
  it("ready = signed in or a passed test; likely = installed, login unknown, no failed test", () => {
    expect(backendState({ available: false, logged_in: null })).toBe("missing");
    expect(backendState({ available: true, logged_in: false })).toBe("signed_out");
    expect(backendState({ available: true, logged_in: true })).toBe("ready");
    expect(backendState({ available: true, logged_in: null, last_test: test(true) })).toBe("ready");
    expect(backendState({ available: true, logged_in: null })).toBe("likely");
    expect(backendState({ available: true, logged_in: null, last_test: test(false) })).toBe("failed");
    expect(isReady({ available: true, logged_in: null })).toBe(false);
    expect(isLikely({ available: true, logged_in: null })).toBe(true);
    expect(isLikely({ available: true, logged_in: null, last_test: test(false) })).toBe(false);
  });
});

describe("likelyNote", () => {
  it("says a likely tool will probably work, and never calls it ready", () => {
    expect(likelyNote(["copilot"])).toBe("Copilot will probably work. Run Test to be sure.");
    expect(likelyNote(["copilot", "kimi"])).toBe("Copilot and Kimi Code will probably work. Run Test to be sure.");
    expect(likelyNote([])).toBeNull();
  });
});

const engine = (id: string, extra: Partial<BackendStatus>): BackendStatus => ({
  id, label: id, kind: "engine", available: true, logged_in: null, version: null, detail: null,
  caps: { can_generate: true, can_edit: true, typical_seconds: 5, cost_note: "", photoreal: true, max_refs: 1 },
  cost_note: "", used_for: ["images"], login: null, last_test: null, install: { macos: "", linux: "", docs_url: "" },
  ...extra,
});

describe("normalizeBackends (R2: the default choice is only ever a READY engine)", () => {
  const data = (engines: BackendStatus[], preferred: string | null): Backends => ({
    brains: [], engines, internal: {}, thresholds: { structure_ok: 0.5 }, defaults: { brain: null, engine: preferred },
  });
  it("skips a likely default and falls back to a ready engine", () => {
    const out = normalizeBackends(data([engine("copilot", {}), engine("mflux", { logged_in: true })], "copilot"));
    expect(out.defaults.engine).toBe("mflux");
  });
  it("never picks a failed or merely likely engine", () => {
    const out = normalizeBackends(data([engine("copilot", {}), engine("codex", { last_test: test(false) })], "copilot"));
    expect(out.defaults.engine).toBeNull();
  });
});

describe("mock GET /api/system/setup uses the same rule", () => {
  beforeEach(() => systemHooks.setScenario("fresh"));
  afterAll(() => systemHooks.setScenario("demo"));

  it("reports per-role ready/likely and only completes with READY tools", () => {
    systemHooks.install("copilot");
    system.refreshBackends();
    system.updateSettings({ setup_completed_at: at });
    const likely = system.setupStatus();
    expect(likely).toMatchObject({
      complete: false,
      client: "owner",
      brain: { ready: [], likely: ["copilot"], missing: true },
      engine: { ready: [], likely: ["copilot"], missing: true },
    });
    system.testBackend("brain", "copilot", false);
    system.testBackend("engine", "copilot", true);
    expect(system.setupStatus()).toMatchObject({
      complete: true,
      missing: [],
      brain: { ready: ["copilot"], likely: [], missing: false },
      engine: { ready: ["copilot"], likely: [], missing: false },
      steps: { try_it: true },
    });
  });
});
