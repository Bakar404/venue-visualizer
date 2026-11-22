import { describe, expect, it } from "vitest";
import { colorFor } from "./colors";

describe("colorFor", () => {
  it("maps decor words and lighting descriptions, preferring specific multiword colors", () => {
    expect(colorFor("ivory")).toBe("#f3edda");
    expect(colorFor("Warm amber uplighting")).toBe("#e6b36b");
    expect(colorFor("dusty-blue linen")).toBe("#8ba6b8");
    expect(colorFor("  BLUSH  ")).toBe(colorFor("blush"));
    expect(colorFor("greenery")).toBe("#54744b");
    expect(colorFor("#Ab12EF")).toBe("#ab12ef");
  });

  it("produces deterministic muted hex colors for unknown words, not substring matches", () => {
    const unknown = colorFor("Moonstone mist");
    expect(unknown).toMatch(/^#[0-9a-f]{6}$/);
    expect(unknown).toBe(colorFor(" moonstone   MIST "));
    expect(unknown).not.toBe(colorFor("other unusual color"));
    expect(colorFor("blueberry")).not.toBe(colorFor("blue"));
    const channels = [1, 3, 5].map(start => parseInt(unknown.slice(start, start + 2), 16));
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(57);
    expect(Math.min(...channels)).toBeGreaterThanOrEqual(124);
  });
});
