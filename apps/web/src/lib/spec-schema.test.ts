import { describe, expect, it } from "vitest";

import { defaultSpec, suggestLookName } from "@/lib/spec";
import { specFormSchema } from "@/lib/spec-schema";

const withTables = (tables: Record<string, unknown>) => {
  const spec = defaultSpec();
  return { ...spec, tables: { ...spec.tables, ...tables } };
};

const issuePaths = (value: unknown) => {
  const result = specFormSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
};

describe("specFormSchema", () => {
  it("accepts the default spec and the schema's boundary values", () => {
    expect(issuePaths(defaultSpec())).toEqual([]);
    expect(issuePaths(withTables({ count: 300, seats: 24, size_in: 120 }))).toEqual([]);
    expect(issuePaths(withTables({ count: 0, seats: 1, size_in: 24 }))).toEqual([]);
  });

  it("rejects values the JSON schema rejects, on the right field", () => {
    expect(issuePaths(withTables({ count: 301 }))).toEqual(["tables.count"]);
    expect(issuePaths(withTables({ seats: 25 }))).toEqual(["tables.seats"]);
    expect(issuePaths(withTables({ size_in: 23 }))).toEqual(["tables.size_in"]);
    expect(issuePaths(withTables({ size_in: 121 }))).toEqual(["tables.size_in"]);
    expect(issuePaths({ ...defaultSpec(), guest_count: 2001 })).toEqual(["guest_count"]);
  });

  it("accepts null wherever the API accepts None", () => {
    const spec = defaultSpec();
    // "As photo" clears the time of day.
    expect(issuePaths({ ...spec, scene: { windows: "as_photographed", time_of_day: null } })).toEqual([]);
    expect(issuePaths({ ...spec, scene: null, napkins: null, guest_count: null, notes: null })).toEqual([]);
    expect(issuePaths({ ...spec, napkins: { color: null, fold: null } })).toEqual([]);
    expect(issuePaths({ ...spec, tables: { ...spec.tables, size_in: null, seats: null } })).toEqual([]);
    expect(issuePaths({ ...spec, linens: { ...spec.linens, pattern: null, runner: null } })).toEqual([]);
    expect(issuePaths({ ...spec, chairs: { ...spec.chairs, cushion: null, sash: null } })).toEqual([]);
    expect(
      issuePaths({ ...spec, centerpieces: { ...spec.centerpieces, flowers: null, colors: null, greenery: null, container: null } }),
    ).toEqual([]);
    expect(issuePaths({ ...spec, lighting: { ...spec.lighting, uplighting: null } })).toEqual([]);
  });
});

describe("suggestLookName", () => {
  it("names the look after the newest palette colors", () => {
    const spec = { ...defaultSpec(), palette: ["ivory", "gold", "blush", "navy", "silver"] };
    expect(suggestLookName(spec)).toBe("Blush, navy & silver");
  });
});
