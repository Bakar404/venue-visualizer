import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/errors";
import { needsPairing, pairUrl, safeNext } from "@/lib/pairing";

describe("pairing redirects (FX-R1)", () => {
  it("recognises only the LAN guard's 403", () => {
    expect(needsPairing(new ApiError(403, "Pair this device before using Venue Visualizer over the LAN."))).toBe(true);
    expect(needsPairing(new ApiError(403, "Change settings on this computer, not from a paired device."))).toBe(false);
    expect(needsPairing(new ApiError(401, "Pair this device"))).toBe(false);
  });

  it("keeps next on this site", () => {
    expect(safeNext("/venues/v1?tab=rooms")).toBe("/venues/v1?tab=rooms");
    for (const bad of ["//evil.example/x", "/\\evil.example", "https://evil.example", "", null, "/pair?next=/x"]) expect(safeNext(bad)).toBeNull();
  });

  it("builds the /pair link from the current location", () => {
    expect(pairUrl({ pathname: "/venues/v1", search: "?tab=rooms" })).toBe("/pair?next=%2Fvenues%2Fv1%3Ftab%3Drooms");
    expect(pairUrl({ pathname: "/pair", search: "" })).toBe("/pair");
  });
});
