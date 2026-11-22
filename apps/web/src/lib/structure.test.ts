import { describe, expect, it } from "vitest";

import { structureVerdict } from "@/lib/structure";
import type { Render } from "@/lib/types";

const qa = (q: unknown) => q as Render["qa"];

describe("structureVerdict", () => {
  it("uses the backend's “unverified” structure_message", () => {
    const text = "Lighting changed a lot, so we couldn't confirm the room matches; compare with the slider.";
    expect(structureVerdict(qa({ structure_message: { level: "unverified", text } }))).toEqual({
      level: "unverified",
      label: "Couldn't verify",
      text,
    });
  });

  it("uses the backend's “changed” structure_message", () => {
    const text = "This render may have changed the room's architecture.";
    expect(structureVerdict(qa({ structure_message: { level: "changed", text } }))).toEqual({
      level: "changed",
      label: "May have changed the room",
      text,
    });
  });

  it("shows no badge when the backend says the room is ok", () => {
    const message = { level: "ok", text: "The room's architecture appears unchanged." };
    expect(structureVerdict(qa({ structure_message: message, structure: { method: "aligned", reason: null } }))).toBeNull();
  });

  it("maps old reasons (no structure_message) to the same levels", () => {
    const unverified = structureVerdict(qa({ structure_message: null, structure: { method: "orb", reason: "no consistent match between photos" } }));
    expect(unverified).toMatchObject({ level: "unverified", label: "Couldn't verify" });

    const legacy = structureVerdict(qa({ structure: { method: "unverifiable", reason: null } }));
    expect(legacy?.level).toBe("unverified");

    const partial = structureVerdict(qa({ structure: { method: "orb", reason: "render only shows 41% of the protected area" } }));
    expect(partial).toMatchObject({ level: "changed", label: "May have changed the room" });
    expect(partial?.text).toContain("41%");
  });
});
