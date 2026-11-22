import { describe, expect, it } from "vitest";

import { structureVerdict } from "@/lib/structure";
import type { Render } from "@/lib/types";

const qa = (q: unknown) => q as Render["qa"];

describe("structureVerdict", () => {
  it("prefers the backend's structure_message", () => {
    expect(structureVerdict(qa({ structure_message: { level: "unverifiable", text: "Lighting changed a lot." } }))).toEqual({
      level: "unverifiable",
      label: "Couldn't verify",
      text: "Lighting changed a lot.",
    });
  });

  it("maps old reasons to the two levels", () => {
    const unverifiable = structureVerdict(qa({ structure: { method: "orb", reason: "no consistent match between photos" } }));
    expect(unverifiable.level).toBe("unverifiable");
    expect(unverifiable.label).toBe("Couldn't verify");

    const partial = structureVerdict(qa({ structure: { method: "orb", reason: "render only shows 41% of the protected area" } }));
    expect(partial).toMatchObject({ level: "changed", label: "May have changed the room" });
    expect(partial.text).toContain("41%");
  });

  it("uses a string message with the level mapped from the reason", () => {
    const v = structureVerdict(qa({ structure_message: "Couldn't align the photos.", structure: { method: "unverifiable", reason: null } }));
    expect(v).toEqual({ level: "unverifiable", label: "Couldn't verify", text: "Couldn't align the photos." });
  });
});
