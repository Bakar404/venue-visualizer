import { describe, expect, it } from "vitest";

import { stableStringify } from "@/lib/stable-json";
import { safeHttpUrl } from "@/lib/url";

describe("safeHttpUrl", () => {
  it("keeps http(s) URLs", () => {
    expect(safeHttpUrl("https://venue.example/a?b=1")).toBe("https://venue.example/a?b=1");
    expect(safeHttpUrl(" http://venue.example ")).toMatch(/^http:\/\/venue\.example/);
    expect(safeHttpUrl("/files/photo.jpg")).toBe("/files/photo.jpg");
  });

  it.each(["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,hi", "vbscript:x", "//evil.example", "", null, undefined])(
    "drops %s",
    (value) => {
      expect(safeHttpUrl(value)).toBeNull();
    },
  );
});

describe("stableStringify", () => {
  it("ignores key order but not array order", () => {
    expect(stableStringify({ a: 1, b: { c: [1, 2], d: null } })).toBe(stableStringify({ b: { d: null, c: [1, 2] }, a: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});
