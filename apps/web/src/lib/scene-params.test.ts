import { describe, expect, it } from "vitest";

import { base64UrlEncode, decodeSceneParams, MAX_PARAM_LENGTH } from "@/lib/scene-params";
import { defaultSpec } from "@/lib/spec";

const encode = (v: unknown) => base64UrlEncode(JSON.stringify(v));
const params = (spec: unknown, venue?: unknown, camera?: string) => {
  const p = new URLSearchParams({ spec: encode(spec) });
  if (venue !== undefined) p.set("venue", encode(venue));
  if (camera) p.set("camera", camera);
  return p;
};
const withTables = (tables: Record<string, unknown>) => {
  const spec = defaultSpec();
  return { ...spec, tables: { ...spec.tables, ...tables } };
};

describe("decodeSceneParams", () => {
  it("round-trips a valid spec", () => {
    const spec = defaultSpec();
    const out = decodeSceneParams(params(spec, { length_ft: 80, width_ft: 50 }, "top"));
    expect(out.camera).toBe("top");
    expect(out.spec.tables).toEqual(spec.tables);
    expect(out.venue.length_ft).toBe(80);
  });

  it.each([
    [{ seats: 0 }, "seats"],
    [{ seats: 25 }, "seats"],
    [{ seats: 8.5 }, "seats"],
    [{ count: 301 }, "count"],
    [{ count: -1 }, "count"],
    [{ size_in: 23 }, "size_in"],
    [{ size_in: 121 }, "size_in"],
    [{ shape: "hexagon" }, "shape"],
  ])("rejects tables %o", (tables, field) => {
    expect(() => decodeSceneParams(params(withTables(tables)))).toThrow(field);
  });

  it.each([0, -5, 1001, "60"])("rejects room dimension %s", (length_ft) => {
    expect(() => decodeSceneParams(params(defaultSpec(), { length_ft }))).toThrow("length_ft");
  });

  it("defaults an unknown lighting.ambient instead of failing", () => {
    const spec = defaultSpec();
    const out = decodeSceneParams(params({ ...spec, lighting: { ...spec.lighting, ambient: "disco" } }));
    expect(out.spec.lighting.ambient).toBe("evening_warm");
  });

  it("caps string and list lengths", () => {
    const spec = defaultSpec();
    const out = decodeSceneParams(
      params({ ...spec, notes: "n".repeat(5000), extras: Array.from({ length: 40 }, () => "x".repeat(300)), linens: { ...spec.linens, color: "c".repeat(999) } }),
    );
    expect(out.spec.notes).toHaveLength(2000);
    expect(out.spec.extras).toHaveLength(32);
    expect(out.spec.extras[0]).toHaveLength(200);
    expect(out.spec.linens.color).toHaveLength(200);
  });

  it("refuses oversized params before decoding them", () => {
    const p = new URLSearchParams({ spec: "a".repeat(MAX_PARAM_LENGTH + 1) });
    expect(() => decodeSceneParams(p)).toThrow("longer than");
  });

  it("rejects malformed input and unknown cameras", () => {
    expect(() => decodeSceneParams(new URLSearchParams())).toThrow("missing");
    expect(() => decodeSceneParams(new URLSearchParams({ spec: "%%%" }))).toThrow("base64url");
    expect(() => decodeSceneParams(params(defaultSpec(), undefined, "drone"))).toThrow("camera");
  });
});
