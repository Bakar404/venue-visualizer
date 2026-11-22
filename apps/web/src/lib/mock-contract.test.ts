// The mock API must send exactly what the live API sends. Responses are checked against the OpenAPI document the
// backend exports (packages/schema/openapi.json; a pytest fails when that file is stale).
import Ajv2020 from "ajv/dist/2020";
import openapi from "@vv/schema/openapi.json";
import { describe, expect, it } from "vitest";
import { mockApi } from "@/lib/mock-api";
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
