import { describe, expect, it } from "vitest";

import {
  acceptableRuleKeys,
  buildImportPayload,
  type ImportDraft,
  type ImportDraftSpace,
  MAX_WEB_PHOTOS_PER_SPACE,
  selectablePhotos,
  spacePatches,
  venueSpecFromResearch,
} from "@/lib/import-payload";
import type { ResearchRule, VenueSpec } from "@/lib/types";

const spec: VenueSpec = {
  style: "rustic",
  length_ft: 60,
  width_ft: 40,
  ceiling_ft: 16,
  walls: null,
  floor: null,
  windows: null,
  fixtures: [],
  notes: null,
};

function space(overrides: Partial<ImportDraftSpace> = {}): ImportDraftSpace {
  return { sourceName: "Barn", include: true, name: "Barn", spec, initialSpec: spec, photos: [], ...overrides };
}

function draft(overrides: Partial<ImportDraft> = {}): ImportDraft {
  return {
    researchJobId: "job_1",
    matchIndex: 2,
    spaces: [space()],
    acceptedRules: [],
    acceptedProvidedItems: [],
    rightsConfirmed: false,
    ...overrides,
  };
}

describe("buildImportPayload", () => {
  it("uses the documented shape with suggested names and opt-in lists", () => {
    const body = buildImportPayload(
      draft({
        spaces: [space({ name: "Renamed barn" }), space({ sourceName: "Garden", name: "Garden", include: false })],
        acceptedRules: ["live_candles", "live_candles"],
        acceptedProvidedItems: ["Chairs"],
      }),
    );
    expect(body).toEqual({
      research_job_id: "job_1",
      match_index: 2,
      space_names: ["Barn"],
      accepted_rules: ["live_candles"],
      accepted_provided_items: ["Chairs"],
      photos: [],
    });
  });

  it("imports base photos only after the rights confirmation; otherwise sends them as references", () => {
    const photos = [
      { url: "https://venue.example/a.jpg", use: true },
      { url: "https://venue.example/b.jpg", use: false },
    ];
    expect(buildImportPayload(draft({ spaces: [space({ photos })] })).photos).toEqual([
      { url: "https://venue.example/a.jpg", mode: "reference", rights_confirmed: false },
      { url: "https://venue.example/b.jpg", mode: "reference", rights_confirmed: false },
    ]);
    expect(buildImportPayload(draft({ spaces: [space({ photos })], rightsConfirmed: true })).photos).toEqual([
      { url: "https://venue.example/a.jpg", mode: "import", rights_confirmed: true },
      { url: "https://venue.example/b.jpg", mode: "reference", rights_confirmed: false },
    ]);
  });

  it("drops unsafe and duplicate photo URLs across spaces", () => {
    const body = buildImportPayload(
      draft({
        spaces: [
          space({ photos: [{ url: "javascript:alert(1)", use: true }, { url: "https://x.example/1.jpg", use: true }] }),
          space({ sourceName: "Garden", name: "Garden", photos: [{ url: "https://x.example/1.jpg", use: true }] }),
        ],
        rightsConfirmed: true,
      }),
    );
    expect(body.photos.map((p) => p.url)).toEqual(["https://x.example/1.jpg"]);
    expect(body.space_names).toEqual(["Barn", "Garden"]);
  });
});

describe("buildImportPayload per-space cap", () => {
  it("counts a shared URL against every space that lists it, as the API does", () => {
    const shared = "https://x.example/shared.jpg";
    const own = Array.from({ length: 12 }, (_, i) => ({ url: `https://x.example/b${i}.jpg`, use: true }));
    const body = buildImportPayload(
      draft({
        spaces: [
          space({ photos: [{ url: shared, use: true }], suggestedUrls: [shared] }),
          space({ sourceName: "Garden", name: "Garden", photos: own, suggestedUrls: [shared, ...own.map((p) => p.url)] }),
        ],
      }),
    );
    const urls = body.photos.map((p) => p.url);
    expect(urls[0]).toBe(shared);
    expect(urls).toHaveLength(12);
    expect(new Set(urls).size).toBe(12);
  });
});

describe("selectablePhotos", () => {
  it("caps each space at the API limit", () => {
    const photos = Array.from({ length: 20 }, (_, i) => ({ url: `https://x.example/${i}.jpg` }));
    expect(selectablePhotos(photos)).toHaveLength(MAX_WEB_PHOTOS_PER_SPACE);
  });
});

describe("acceptableRuleKeys", () => {
  it("accepts only keys with exactly one non-null value", () => {
    const rule = (text: string, maps_to: ResearchRule["maps_to"], allowed: boolean | null): ResearchRule => ({
      text,
      maps_to,
      allowed,
      source: "https://venue.example/faq",
    });
    const rules = [
      rule("No candles", "live_candles", false),
      rule("Candles in glass ok", "live_candles", true),
      rule("No confetti", "confetti", false),
      rule("No confetti outside", "confetti", false),
      rule("Ask about fog", "fog", null),
      rule("Quiet after 10", null, false),
    ];
    expect([...acceptableRuleKeys(rules)]).toEqual(["confetti"]);
  });
});

describe("spacePatches", () => {
  it("patches renamed or edited spaces, matched by suggested name", () => {
    const edited = { ...spec, ceiling_ft: 20 };
    const patches = spacePatches(
      [
        space({ name: " Main hall " }),
        space({ sourceName: "Garden", name: "Garden", spec: edited }),
        space({ sourceName: "Loft", name: "Loft" }),
        space({ sourceName: "Cellar", name: "Wine cellar", include: false }),
      ],
      [
        { id: "s1", name: "Barn" },
        { id: "s2", name: "Garden" },
        { id: "s3", name: "Loft" },
      ],
    );
    expect(patches).toEqual([
      { id: "s1", body: { name: "Main hall" } },
      { id: "s2", body: { venue_spec: edited } },
    ]);
  });

  it("ignores key order when detecting spec edits", () => {
    const reordered = Object.fromEntries(Object.entries(spec).reverse()) as VenueSpec;
    expect(spacePatches([space({ spec: reordered })], [{ id: "s1", name: "Barn" }])).toEqual([]);
  });
});

describe("venueSpecFromResearch", () => {
  it("fills missing fields with nulls and uses the description as notes", () => {
    expect(venueSpecFromResearch({ name: "Barn", description: "Big", length_ft: 50 } as never, null)).toEqual({
      style: null,
      length_ft: 50,
      width_ft: null,
      ceiling_ft: null,
      walls: null,
      floor: null,
      windows: null,
      fixtures: [],
      notes: "Big",
    });
  });
});
