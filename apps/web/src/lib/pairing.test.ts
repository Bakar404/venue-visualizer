import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/errors";
import { needsPairing, pairUrl, safeNext } from "@/lib/pairing";

const origin = "http://localhost:3000";

describe("pairing redirects (FX-R1)", () => {
  it("recognises only the LAN guard's 403", () => {
    expect(needsPairing(new ApiError(403, "Pair this device before using Venue Visualizer over the LAN."))).toBe(true);
    expect(needsPairing(new ApiError(403, "Change settings on this computer, not from a paired device."))).toBe(false);
    expect(needsPairing(new ApiError(401, "Pair this device"))).toBe(false);
  });

  it("keeps next on this site", () => {
    expect(safeNext("/venues/abc?x=1#y", origin)).toBe("/venues/abc?x=1#y");
    expect(safeNext("/venues/../spaces?x=1#y", origin)).toBe("/spaces?x=1#y");
  });

  it.each([
    new URLSearchParams("next=/%09/evil.com").get("next"),
    "/\n/evil.com",
    "/\r/evil.com",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/venues\\abc",
    "/venues\u0000",
    "/venues\u007f",
    "javascript:alert(1)",
    "/venues/..//external.example",
    "/venues/../pair#again",
    "/pair?next=/x",
    "",
    null,
  ])("uses home for an unsafe or absent next value (%j)", (bad) => {
    expect(safeNext(bad, origin)).toBe("/");
  });

  it("builds the /pair link from the current location", () => {
    expect(pairUrl({ origin, pathname: "/venues/v1", search: "?tab=rooms" })).toBe("/pair?next=%2Fvenues%2Fv1%3Ftab%3Drooms");
    expect(pairUrl({ origin, pathname: "/pair", search: "" })).toBe("/pair");
  });
});
