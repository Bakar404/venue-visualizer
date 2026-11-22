import { describe, expect, it } from "vitest";

import { defaultSpec, specEquals } from "@/lib/spec";
import { withoutNulls } from "@/lib/stable-json";
import type { DesignSpec } from "@/lib/types";

describe("specEquals", () => {
  const draft = defaultSpec("ballroom");

  it("treats null and undefined keys as absent, at every depth (the API drops None fields)", () => {
    const typedThenCleared: DesignSpec = { ...draft, linens: { ...draft.linens, runner: null }, notes: undefined };
    expect(specEquals(typedThenCleared, withoutNulls(draft))).toBe(true);
    expect(specEquals({ ...draft, scene: { windows: "as_photographed", time_of_day: null } }, { ...draft, scene: { windows: "as_photographed" } })).toBe(true);
    // The form registers every scene field, so an untouched section is `{ time_of_day: undefined, windows: undefined }`.
    expect(specEquals({ ...draft, scene: { time_of_day: undefined, windows: undefined } }, { ...draft, scene: undefined })).toBe(true);
  });

  it("still tells real differences apart, and keeps empty arrays", () => {
    expect(specEquals({ ...draft, linens: { ...draft.linens, runner: "burlap" } }, draft)).toBe(false);
    expect(specEquals({ ...draft, extras: [] }, { ...draft, extras: ["dance floor"] })).toBe(false);
    expect(withoutNulls({ extras: [], palette: null, tables: { seats: undefined, count: 0 } })).toEqual({ extras: [], tables: { count: 0 } });
    expect(withoutNulls({ extras: [], scene: { time_of_day: null } })).toEqual({ extras: [] });
  });
});
