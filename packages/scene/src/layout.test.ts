import { describe, expect, it } from "vitest";
import { layoutTables, tableDimensions } from "./layout";
import type { DesignSpec, FloorPlacement } from "./types";

const spec: DesignSpec = {
  version: 1, space: "ballroom", palette: ["ivory", "sage"],
  tables: { count: 12, shape: "round", size_in: 60, seats: 8 },
  linens: { color: "ivory" }, chairs: { style: "chiavari", color: "gold" },
  centerpieces: { height: "low" }, lighting: {}, extras: [],
};

function overlap(a: FloorPlacement, b: FloorPlacement, gap = 0) {
  return Math.abs(a.x - b.x) < (a.widthFt + b.widthFt) / 2 + gap - 1e-7
    && Math.abs(a.z - b.z) < (a.lengthFt + b.lengthFt) / 2 + gap - 1e-7;
}

describe("layoutTables", () => {
  it("preserves exact table and chair counts, dimensions, and determinism", () => {
    const venue = { length_ft: 100, width_ft: 80, ceiling_ft: 16 };
    const layout = layoutTables(spec, venue);
    expect(layout.tables).toHaveLength(12);
    expect(layout.tables.every(table => table.chairs.length === 8)).toBe(true);
    expect(layout.room).toEqual({ lengthFt: 100, widthFt: 80, ceilingFt: 16 });
    expect(layout.tables[0]).toMatchObject({ shape: "round", diameterFt: 5 });
    expect(layout).toEqual(layoutTables(spec, venue));
    expect(layout.warnings).toEqual([]);
    expect(spec.tables.count).toBe(12);
  });

  it("keeps chair-inclusive footprints inside the room with 5ft walkways", () => {
    const layout = layoutTables(spec, { length_ft: 100, width_ft: 80 });
    const occupied = layout.tables.map(table => {
      const dimensions = tableDimensions(table);
      return { x: table.x, z: table.z, widthFt: dimensions.width + 4.2, lengthFt: dimensions.length + 4.2 };
    });
    occupied.forEach((a, i) => {
      expect(Math.abs(a.x) + a.widthFt / 2).toBeLessThanOrEqual(40);
      expect(Math.abs(a.z) + a.lengthFt / 2).toBeLessThanOrEqual(50);
      occupied.slice(i + 1).forEach(b => expect(overlap(a, b, 5)).toBe(false));
    });
  });

  it("reserves a centered dance floor and far-wall sweetheart table", () => {
    const layout = layoutTables(
      { ...spec, guest_count: 160, extras: ["Dance floor", "sweetheart table"] },
      { length_ft: 120, width_ft: 100 },
    );
    expect(layout.danceFloor).toMatchObject({ x: 0, z: 0 });
    expect(layout.danceFloor!.widthFt ** 2).toBeCloseTo(240);
    expect(layout.headTable?.z).toBeLessThan(-50);
    expect(layout.headTable?.chairs).toHaveLength(2);
    for (const table of layout.tables) {
      const size = tableDimensions(table);
      const occupied = { x: table.x, z: table.z, widthFt: size.width + 4.2, lengthFt: size.length + 4.2 };
      expect(overlap(occupied, layout.danceFloor!, 5)).toBe(false);
      expect(overlap(occupied, layout.headTable!, 5)).toBe(false);
    }
    expect(layout.warnings).toEqual([]);
  });

  it("places odd banquet seating along both long sides facing inward", () => {
    const layout = layoutTables({ ...spec, tables: { count: 2, shape: "banquet", size_in: 96, seats: 7 } });
    expect(layout.tables[0]).toMatchObject({ lengthFt: 8, widthFt: 3 });
    const table = layout.tables[0];
    expect(table.chairs.filter(chair => chair.x > table.x)).toHaveLength(4);
    expect(table.chairs.filter(chair => chair.x < table.x)).toHaveLength(3);
    expect(table.chairs[0].rotY).toBe(-Math.PI / 2);
  });

  it("reduces walkway width explicitly, without overlaps or dropped tables", () => {
    const layout = layoutTables(
      { ...spec, tables: { ...spec.tables, count: 4 } },
      { length_ft: 23, width_ft: 23 },
    );
    expect(layout.warnings).toEqual(["4 tables don't fit with 5ft walkways; using 4ft"]);
    expect(layout.tables).toHaveLength(4);
    layout.tables.forEach((a, i) => layout.tables.slice(i + 1).forEach(b => {
      expect(overlap({ ...a, widthFt: 9.2, lengthFt: 9.2 }, { ...b, widthFt: 9.2, lengthFt: 9.2 }, 4)).toBe(false);
    }));
  });

  it("reports impossible rooms and preserves count using non-overlapping overflow", () => {
    const layout = layoutTables(spec, { length_ft: 5, width_ft: 5 });
    expect(layout.tables).toHaveLength(12);
    expect(layout.warnings.join(" ")).toContain("outside the room");
    layout.tables.forEach((a, i) => layout.tables.slice(i + 1).forEach(b => {
      expect(overlap({ ...a, widthFt: 9.2, lengthFt: 9.2 }, { ...b, widthFt: 9.2, lengthFt: 9.2 })).toBe(false);
    }));
  });

  it("handles zero tables, schema shapes, and default guest-derived room area", () => {
    expect(layoutTables({ ...spec, tables: { count: 0, shape: "round" } }).tables).toEqual([]);
    const layout = layoutTables({ ...spec, guest_count: 400 });
    expect(layout.room.lengthFt * layout.room.widthFt).toBeCloseTo(4800);
    for (const shape of ["square", "oval", "cocktail", "mixed"] as const) {
      const result = layoutTables({ ...spec, tables: { count: 3, shape, seats: 1 } });
      expect(result.tables).toHaveLength(3);
      expect(result.tables.every(table => table.chairs.length === 1)).toBe(true);
      expect(result.tables[0].shape).toBe(shape === "mixed" ? "round" : shape);
    }
  });

  it("warns when reserved decor cannot fit and rejects invalid dimensions", () => {
    const layout = layoutTables({ ...spec, extras: ["dance floor", "head table"] }, { length_ft: 10, width_ft: 10 });
    expect(layout.warnings.join(" ")).toContain("Reserved decor");
    expect(layout.warnings.join(" ")).toContain("overlap");
    expect(() => layoutTables(spec, { length_ft: NaN })).toThrow(RangeError);
    expect(() => layoutTables({ ...spec, tables: { count: -1, shape: "round" } })).toThrow(RangeError);
  });
});
