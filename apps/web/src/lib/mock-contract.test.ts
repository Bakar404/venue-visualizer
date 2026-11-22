// The mock API must send exactly what the live API sends. Responses are checked against the OpenAPI document the
// backend exports (packages/schema/openapi.json; a pytest fails when that file is stale).
import Ajv2020 from "ajv/dist/2020";
import openapi from "@vv/schema/openapi.json";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "@/lib/errors";
import { mockApi } from "@/lib/mock-api";
import * as system from "@/lib/mock-system";
import { systemHooks } from "@/lib/mock-system";
import type { Job, SettingsPatch } from "@/lib/types";

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema(openapi, "openapi");

/** Validates a response as it would arrive over the network (JSON drops `undefined`). */
function expectSchema(schema: string, data: unknown) {
  const validate = ajv.getSchema(`openapi#/components/schemas/${schema}`);
  if (!validate) throw new Error(`OpenAPI has no schema ${schema}`);
  if (validate(JSON.parse(JSON.stringify(data)))) return;
  const errors = (validate.errors ?? []).map((e) => `  ${e.instancePath || "/"} ${e.message} ${JSON.stringify(e.params)}`);
  throw new Error(`Mock response doesn't match ${schema}:\n${errors.join("\n")}`);
}

async function finished(job: Job): Promise<Job> {
  for (;;) {
    const now = await mockApi.getJob(job.id);
    if (now.status !== "queued" && now.status !== "running") return now;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("mock API matches the OpenAPI contract", () => {
  it("GET /api/system/backends", async () => {
    expectSchema("BackendsOut", await mockApi.backends());
  });

  it("GET /api/looks/{id}, including renders with structure QA", async () => {
    const looks = await Promise.all(["look-blush", "look-cocktail", "look-string-lights"].map((id) => mockApi.getLook(id)));
    for (const look of looks) expectSchema("LookOut", look);
    const qa = looks.flatMap((l) => l.renders).map((r) => r.qa);
    expect(qa.some((q) => q?.structure && q.structure_message)).toBe(true);
  });

  it("GET /api/looks/{id} after a fresh render", { timeout: 20_000 }, async () => {
    const { jobs } = await mockApi.renderLook("look-evergreen", { photo_ids: ["photo-ballroom-b"], engine: "mock" });
    for (const job of jobs) expectSchema("JobOut", await finished(job));
    expectSchema("LookOut", await mockApi.getLook("look-evergreen"));
  });

  it("POST /api/spaces/{id}/chat", { timeout: 20_000 }, async () => {
    const space = await mockApi.getSpace("space-ballroom");
    expectSchema("ChatOut", await mockApi.chat(space.id, { message: "Make the linens sage", spec: space.current_spec }));
  });

  it("GET /api/spaces/{id}, with references", async () => {
    const space = await mockApi.getSpace("space-wren-long-room");
    expect(space.references.length).toBeGreaterThan(0);
    expectSchema("SpaceOut", space);
    expectSchema("SpaceOut", await mockApi.getSpace("space-ballroom"));
  });

  it("POST /api/venues/import", { timeout: 20_000 }, async () => {
    const job = await finished(await mockApi.research({ query: "Larkspur House", brain: "claude" }));
    expectSchema("JobOut", job);
    const match = job.result!.research!.matches[0];
    const space = match.spaces![0];
    const [imported, referenced] = space.photos!;
    const venue = await mockApi.importVenue({
      research_job_id: job.id,
      match_index: 0,
      space_names: [space.name],
      accepted_rules: [],
      accepted_provided_items: [],
      photos: [
        { url: imported.url, mode: "import", rights_confirmed: true },
        { url: referenced.url, mode: "reference", rights_confirmed: false },
      ],
    });
    expectSchema("ImportOut", venue);
    expect(venue.spaces[0].references).toHaveLength(1);
    expect(venue.spaces[0].photos).toHaveLength(1);
  });
});

// First-run setup endpoints (docs/onboarding-and-mobile.md, section 3), validated against the same OpenAPI document.
async function rejects(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("Expected the request to fail");
}

function throws(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("Expected the call to fail");
}

describe("mock API matches the first-run setup contract", () => {
  beforeEach(() => systemHooks.setScenario("fresh"));
  afterEach(() => vi.useRealTimers());
  afterAll(() => systemHooks.setScenario("demo"));

  it("GET /api/system/backends and POST /api/system/backends/refresh carry setup info", async () => {
    systemHooks.install("claude");
    const before = await mockApi.backends();
    expectSchema("BackendsOut", before);
    expect(before.brains.find((b) => b.id === "claude")?.available).toBe(false);
    const after = await mockApi.refreshBackends();
    expectSchema("BackendsOut", after);
    expect(after.brains.find((b) => b.id === "claude")).toMatchObject({
      available: true,
      logged_in: true,
      login: { command: "claude", note: "then follow the sign-in prompt" },
    });
    // The sign-in command is only the command; how to finish signing in is a separate note.
    const codex = after.engines.find((e) => e.id === "codex");
    expect(codex).toMatchObject({ login: { command: "codex login", note: null }, image_setup: "codex features enable image_generation" });
    expect(after.engines.find((e) => e.id === "copilot")?.login).toEqual({ command: "copilot", note: "then type /login" });
  });

  it("GET and PATCH /api/settings", async () => {
    expectSchema("SettingsOut", await mockApi.getSettings());
    const saved = await mockApi.updateSettings({ default_brain: "claude", providers: { claude: { config_dir: "~/.claude-work" } } });
    expectSchema("SettingsOut", saved);
    expect(saved).toMatchObject({ default_brain: "claude", providers: { claude: { config_dir: "~/.claude-work" } } });
  });

  it("PATCH /api/settings validates provider paths with a 422, like the API", async () => {
    for (const config_dir of ["relative/claude", "/tmp/claude"]) {
      const error = await rejects(mockApi.updateSettings({ providers: { claude: { config_dir } } }));
      expect(error.status).toBe(422);
      expect(error.message).toMatch(/config_dir must be an existing Claude configuration directory under your home folder/);
    }
    const kimi = await rejects(mockApi.updateSettings({ providers: { kimi: { bin: "kimi" } } }));
    expect(kimi.status).toBe(422);
    expect(kimi.message).toMatch(/absolute path/);
    expect((await mockApi.getSettings()).providers).toEqual({});
  });

  it("PATCH /api/settings refuses lan.enabled with a 422: it's read-only (set by `make dev-lan`)", async () => {
    // @ts-expect-error lan isn't part of the PATCH body.
    const typed: SettingsPatch = { lan: { enabled: true } };
    const error = await rejects(mockApi.updateSettings(typed));
    expect(error.status).toBe(422);
    expect(error.message).toContain("make dev-lan");
    // Nothing in the body is applied, and phone access stays off.
    await rejects(mockApi.updateSettings({ default_brain: "claude", lan: { enabled: true } } as SettingsPatch));
    expect(await mockApi.getSettings()).toMatchObject({ default_brain: null, lan: { enabled: false } });
    expect((await mockApi.lanInfo()).enabled).toBe(false);
  });

  it("POST /api/system/backends/{kind}/{id}/test", { timeout: 20_000 }, async () => {
    systemHooks.setScenario("ready");
    const brain = await mockApi.testBackend("brain", "claude", {});
    expectSchema("BackendTestOut", brain);
    expect(brain.ok).toBe(true);
    expect((await rejects(mockApi.testBackend("engine", "copilot", {}))).status).toBe(422);
    const image = await mockApi.testBackend("engine", "copilot", { confirm_credits: true });
    expectSchema("BackendTestOut", image);
    expect(image.sample_url).toBeTruthy();
    expectSchema("BackendTestOut", await mockApi.testBackend("engine", "mflux", {}));
    const backends = await mockApi.backends();
    expect(backends.engines.find((e) => e.id === "copilot")?.last_test?.ok).toBe(true);
  });

  it("tests are one at a time per backend (409) and cool down 10 s for chat, 60 s for images (429)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    systemHooks.setScenario("ready");
    const t0 = Date.now();
    const run = system.beginTest("brain", "claude", false);
    expect(throws(() => system.beginTest("brain", "claude", false))).toMatchObject({ status: 409 });
    system.finishTest(run);
    vi.setSystemTime(t0 + 4_000);
    expect(throws(() => system.testBackend("brain", "claude", false))).toMatchObject({ status: 429, retryAfter: 6 });
    // Other backends have their own cooldown.
    expect(system.testBackend("engine", "mflux", false).ok).toBe(true);
    vi.setSystemTime(t0 + 10_000);
    expect(system.testBackend("brain", "claude", false).ok).toBe(true);
    vi.setSystemTime(t0 + 4_000 + 59_000);
    expect(throws(() => system.testBackend("engine", "mflux", false))).toMatchObject({ status: 429, retryAfter: 1 });
    vi.setSystemTime(t0 + 4_000 + 60_000);
    expect(system.testBackend("engine", "mflux", false).ok).toBe(true);
  });

  it("GET /api/system/setup: per-role readiness, and try_it only once complete", async () => {
    const fresh = await mockApi.setupStatus();
    expectSchema("SetupOut", fresh);
    expect(fresh).toMatchObject({
      complete: false,
      missing: ["brain", "engine", "defaults"],
      client: "owner",
      brain: { ready: [], likely: [], missing: true },
      steps: { try_it: false },
    });
    systemHooks.setScenario("ready");
    const ready = await mockApi.setupStatus();
    expectSchema("SetupOut", ready);
    expect(ready).toMatchObject({ complete: false, missing: ["defaults"], steps: { tools: true, defaults: false, try_it: false } });
    await mockApi.updateSettings({ setup_completed_at: new Date().toISOString() });
    expect(await mockApi.setupStatus()).toMatchObject({ complete: true, missing: [], steps: { try_it: true } });
  });

  it("GET /api/system/lan keeps the code; POST /api/system/lan/code rotates it", async () => {
    const off = await mockApi.lanInfo();
    expectSchema("LanOut", off);
    expect(off).toMatchObject({ enabled: false, url: null, qr_svg: null, pairing_code: null });
    expect((await rejects(mockApi.pairDevice("123456"))).status).toBe(409);
    systemHooks.setLan(true);
    const first = await mockApi.lanInfo();
    expectSchema("LanOut", first);
    expect(first).toMatchObject({ pairing_expires_in: 600, pairing_locked_for: null });
    expect(first.url).toMatch(/^http:\/\/[\d.]+:3000\/pair$/);
    expect(first.qr_svg).toContain("<svg");
    // Showing the panel again doesn't issue a new code.
    expect((await mockApi.lanInfo()).pairing_code).toBe(first.pairing_code);
    const rotated = await mockApi.rotateLanCode();
    expectSchema("LanOut", rotated);
    expect(rotated.pairing_code).toMatch(/^\d{6}$/);
    expect(rotated.pairing_code).not.toBe(first.pairing_code);
    expect((await rejects(mockApi.pairDevice(first.pairing_code!))).status).toBe(403);
    await expect(mockApi.pairDevice(rotated.pairing_code!)).resolves.toBeUndefined();
    // One-time.
    expect((await rejects(mockApi.pairDevice(rotated.pairing_code!))).status).toBe(403);
  });

  it("pairing pauses after too many wrong codes, and GET /api/system/lan says for how long", async () => {
    systemHooks.setLan(true);
    const { pairing_code } = await mockApi.lanInfo();
    const wrong = pairing_code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await rejects(mockApi.pairDevice(wrong))).status).toBe(403);
    const limited = await rejects(mockApi.pairDevice(pairing_code!));
    expect(limited).toMatchObject({ status: 429 });
    expect(limited.retryAfter).toBeGreaterThan(0);

    systemHooks.lockPairing(300);
    const locked = await mockApi.lanInfo();
    expectSchema("LanOut", locked);
    expect(locked).toMatchObject({ pairing_code: null, pairing_expires_in: null, pairing_locked_for: 300 });
  });

  describe("pairing codes expire", () => {
    it("10 minutes after they are issued, even if the panel checks again", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      systemHooks.setLan(true);
      const t0 = new Date("2026-11-21T12:00:00Z").getTime();
      vi.setSystemTime(t0);
      const early = system.lanInfo().pairing_code!;
      vi.setSystemTime(t0 + 10 * 60_000 - 1000);
      expect(system.lanInfo()).toMatchObject({ pairing_code: early, pairing_expires_in: 1 });
      system.pairDevice(early, "Phone A");
      const late = system.lanInfo();
      expect(late.pairing_expires_in).toBe(600);
      vi.setSystemTime(t0 + 2 * 10 * 60_000 + 1);
      expect(() => system.pairDevice(late.pairing_code!, "Phone B")).toThrow(/No pairing code is active/);
      expect(system.lanDevices().map((d) => d.label)).toEqual(["Phone A"]);
    });
  });

  it("GET and DELETE /api/system/lan/devices", async () => {
    systemHooks.setLan(true);
    expect(await mockApi.lanDevices()).toEqual([]);
    for (let i = 0; i < 3; i++) await mockApi.pairDevice((await mockApi.rotateLanCode()).pairing_code!);
    const devices = await mockApi.lanDevices();
    expect(devices).toHaveLength(3);
    for (const d of devices) {
      expectSchema("LanDeviceOut", d);
      expect(d.last_seen >= d.paired_at).toBe(true);
    }

    await expect(mockApi.forgetLanDevice(devices[1].id)).resolves.toBeUndefined();
    expect((await mockApi.lanDevices()).map((d) => d.id)).toEqual([devices[0].id, devices[2].id]);
    expect((await rejects(mockApi.forgetLanDevice(devices[1].id))).status).toBe(404);
    await expect(mockApi.forgetAllLanDevices()).resolves.toBeUndefined();
    expect(await mockApi.lanDevices()).toEqual([]);
  });

  it("an unpaired phone gets 403 'Pair this device…' everywhere except pairing; a paired phone isn't the owner", async () => {
    systemHooks.setScenario("ready");
    systemHooks.setLan(true);
    const { pairing_code } = await mockApi.lanInfo();
    systemHooks.setClient("phone");
    for (const call of [mockApi.backends(), mockApi.setupStatus(), mockApi.listVenues(), mockApi.getSettings()]) {
      const error = await rejects(call);
      expect(error.status).toBe(403);
      expect(error.message).toBe("Pair this device before using Venue Visualizer over the LAN.");
    }
    await mockApi.pairDevice(pairing_code!);
    expect((await mockApi.setupStatus()).client).toBe("phone");
    expectSchema("BackendsOut", await mockApi.backends());
    // Owner-only endpoints.
    expect((await rejects(mockApi.updateSettings({ default_brain: "claude" }))).status).toBe(403);
    expect((await rejects(mockApi.lanInfo())).status).toBe(403);
    expect((await rejects(mockApi.rotateLanCode())).status).toBe(403);
    expect((await rejects(mockApi.lanDevices())).status).toBe(403);
    // From a phone even the free local engine asks before running (R4).
    expect((await rejects(mockApi.testBackend("engine", "mflux", {}))).status).toBe(422);
    expect((await mockApi.testBackend("engine", "mflux", { confirm_credits: true })).ok).toBe(true);
  });

  it("POST /api/system/backends/{kind}/{id}/test can be rate-limited with Retry-After", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    systemHooks.setScenario("ready");
    systemHooks.rateLimitTests(5);
    const t0 = Date.now();
    expect(throws(() => system.testBackend("brain", "claude", false))).toMatchObject({ status: 429, retryAfter: 5 });
    vi.setSystemTime(t0 + 3_200);
    expect(throws(() => system.testBackend("brain", "claude", false))).toMatchObject({ status: 429, retryAfter: 2 });
    vi.setSystemTime(t0 + 5_000);
    expect(system.testBackend("brain", "claude", false).ok).toBe(true);
  });
});
