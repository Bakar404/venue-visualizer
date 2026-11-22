// The mock API must send exactly what the live API sends. Responses are checked against the OpenAPI document the
// backend exports (packages/schema/openapi.json; a pytest fails when that file is stale).
import Ajv2020 from "ajv/dist/2020";
import openapi from "@vv/schema/openapi.json";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ApiError } from "@/lib/errors";
import { mockApi } from "@/lib/mock-api";
import { systemHooks } from "@/lib/mock-system";
import type { Job } from "@/lib/types";

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

// First-run setup endpoints (docs/onboarding-and-mobile.md, section 3). The backend is adding them in parallel, so the
// schemas below are written from the spec. TODO(openapi): once packages/schema/openapi.json has them, validate with
// `expectSchema` against the generated components instead (and drop these zod copies).
const usedFor = z.enum(["chat", "web_research", "vision", "images"]);
const lastTest = z.strictObject({ ok: z.boolean(), at: z.string(), seconds: z.number(), detail: z.string() });
const setupInfo = z.object({
  logged_in: z.boolean().nullable(),
  install: z.strictObject({ macos: z.string(), linux: z.string(), docs_url: z.string() }).optional(),
  login: z.string().nullable(),
  used_for: z.array(usedFor),
  cost_note: z.string(),
  last_test: lastTest.nullable(),
});
const settingsSchema = z.strictObject({
  default_brain: z.string().nullable(),
  default_engine: z.string().nullable(),
  allow_web_research: z.boolean(),
  setup_completed_at: z.string().nullable(),
  providers: z.strictObject({
    claude: z.strictObject({ config_dir: z.string().nullable().optional() }).optional(),
    copilot: z.strictObject({ model: z.string().nullable().optional() }).optional(),
    kimi: z.strictObject({ bin: z.string().nullable().optional() }).optional(),
  }),
  lan: z.strictObject({ enabled: z.boolean() }),
});
const testResult = z.strictObject({ ok: z.boolean(), seconds: z.number(), detail: z.string(), sample_url: z.string().nullable().optional() });
const setupSchema = z.strictObject({
  complete: z.boolean(),
  missing: z.array(z.enum(["brain", "engine", "defaults"])),
  steps: z.record(z.string(), z.unknown()),
});
const lanSchema = z.strictObject({
  enabled: z.boolean(),
  url: z.string().nullable(),
  qr_svg: z.string().nullable(),
  pairing_required: z.literal(true),
  // Not in the spec's table; see LanInfo in types.ts.
  pairing_code: z.string().regex(/^\d{6}$/).nullable().optional(),
});

function expectSpec<T>(schema: z.ZodType<T>, data: unknown) {
  const parsed = schema.safeParse(JSON.parse(JSON.stringify(data)));
  if (!parsed.success) throw new Error(`Mock response doesn't match the spec:\n${z.prettifyError(parsed.error)}`);
}

async function rejects(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("Expected the request to fail");
}

describe("mock API matches the first-run setup spec", () => {
  beforeEach(() => systemHooks.setScenario("fresh"));
  afterAll(() => systemHooks.setScenario("demo"));

  it("GET /api/system/backends and POST /api/system/backends/refresh carry setup info", async () => {
    systemHooks.install("claude");
    const before = await mockApi.backends();
    expectSchema("BackendsOut", before);
    for (const b of [...before.brains, ...before.engines]) expectSpec(setupInfo, b);
    expect(before.brains.find((b) => b.id === "claude")?.available).toBe(false);
    const after = await mockApi.refreshBackends();
    expectSchema("BackendsOut", after);
    expect(after.brains.find((b) => b.id === "claude")).toMatchObject({ available: true, logged_in: true });
  });

  it("GET and PATCH /api/settings", async () => {
    expectSpec(settingsSchema, await mockApi.getSettings());
    const saved = await mockApi.updateSettings({ default_brain: "claude", providers: { claude: { config_dir: "~/.claude-work" } } });
    expectSpec(settingsSchema, saved);
    expect(saved).toMatchObject({ default_brain: "claude", providers: { claude: { config_dir: "~/.claude-work" } } });
  });

  it("POST /api/system/backends/{kind}/{id}/test", { timeout: 20_000 }, async () => {
    systemHooks.setScenario("ready");
    const brain = await mockApi.testBackend("brain", "claude", {});
    expectSpec(testResult, brain);
    expect(brain.ok).toBe(true);
    expect((await rejects(mockApi.testBackend("engine", "copilot", {}))).status).toBe(422);
    const image = await mockApi.testBackend("engine", "copilot", { confirm_credits: true });
    expectSpec(testResult, image);
    expect(image.sample_url).toBeTruthy();
    expectSpec(testResult, await mockApi.testBackend("engine", "mflux", {}));
    const backends = await mockApi.backends();
    expect(backends.engines.find((e) => e.id === "copilot")?.last_test?.ok).toBe(true);
  });

  it("GET /api/system/setup", async () => {
    const fresh = await mockApi.setupStatus();
    expectSpec(setupSchema, fresh);
    expect(fresh).toMatchObject({ complete: false, missing: ["brain", "engine", "defaults"] });
    systemHooks.setScenario("ready");
    await mockApi.updateSettings({ setup_completed_at: new Date().toISOString() });
    expect(await mockApi.setupStatus()).toMatchObject({ complete: true, missing: [] });
  });

  it("GET /api/system/lan and POST /api/system/lan/pair", async () => {
    const off = await mockApi.lanInfo();
    expectSpec(lanSchema, off);
    expect(off.enabled).toBe(false);
    expect((await rejects(mockApi.pairDevice("123456"))).status).toBe(409);
    await mockApi.updateSettings({ lan: { enabled: true } });
    const on = await mockApi.lanInfo();
    expectSpec(lanSchema, on);
    expect(on.qr_svg).toContain("<svg");
    const wrong = on.pairing_code === "000000" ? "111111" : "000000";
    expect((await rejects(mockApi.pairDevice(wrong))).status).toBe(403);
    await expect(mockApi.pairDevice(on.pairing_code!)).resolves.toBeUndefined();
  });
});
