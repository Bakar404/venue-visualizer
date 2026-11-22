import { describe, expect, it } from "vitest";

import { isUsable, setupPill } from "@/lib/backends";

const test = (ok: boolean) => ({ ok, at: "2026-11-01T09:00:00Z", seconds: 3, detail: "" });

describe("setupPill", () => {
  it("follows the spec's four states", () => {
    expect(setupPill({ available: false, logged_in: null })).toBe("Not installed");
    expect(setupPill({ available: true, logged_in: false })).toBe("Installed, not signed in");
    expect(setupPill({ available: true, logged_in: true })).toBe("Ready");
    expect(setupPill({ available: true, logged_in: null })).toBe("Unknown");
  });

  it("treats a CLI that can't report its login as ready once a test passes", () => {
    expect(setupPill({ available: true, logged_in: null, last_test: test(true) })).toBe("Ready");
    expect(setupPill({ available: true, logged_in: null, last_test: test(false) })).toBe("Unknown");
  });
});

describe("isUsable", () => {
  it("offers installed backends unless they're known to be signed out", () => {
    expect(isUsable({ available: true, logged_in: null })).toBe(true);
    expect(isUsable({ available: true, logged_in: false })).toBe(false);
    expect(isUsable({ available: false, logged_in: true })).toBe(false);
  });
});
