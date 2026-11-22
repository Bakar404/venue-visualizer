import { describe, expect, it } from "vitest";

import { normalizeAmbiguities, normalizeChatResponse } from "@/lib/chat";

describe("normalizeAmbiguities", () => {
  it("keeps v2 objects and drops options that are really questions", () => {
    expect(
      normalizeAmbiguities([{ question: "Amber or blue?", options: ["Keep amber", "Amber or blue?", "Switch to blue", "Keep amber"] }]),
    ).toEqual([{ question: "Amber or blue?", options: ["Keep amber", "Switch to blue"] }]);
  });

  it("turns old strings into a question without chips and groups plain replies as options", () => {
    expect(normalizeAmbiguities(["Keep the amber uplighting, or switch to blue?", "Use peonies", "Use roses", " "])).toEqual([
      { question: "Keep the amber uplighting, or switch to blue?", options: [] },
      { question: "", options: ["Use peonies", "Use roses"] },
    ]);
  });
});

describe("normalizeChatResponse", () => {
  it("fills v2 fields an older server leaves out", () => {
    const r = normalizeChatResponse({ reply: "Done", spec: {}, ambiguities: ["Taller?"], intent: "dance" });
    expect(r).toMatchObject({ reply: "Done", intent: "none", spec_changed: false, look_name: null, warnings: [], rule_notes: [] });
    expect(r.ambiguities).toEqual([{ question: "Taller?", options: [] }]);
  });

  it("passes v2 fields through", () => {
    const r = normalizeChatResponse({ reply: "", intent: "render", spec_changed: true, look_name: "  Moody night " });
    expect(r).toMatchObject({ intent: "render", spec_changed: true, look_name: "Moody night" });
  });
});
