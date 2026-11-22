import type {
  ChairPlacement, DesignSpec, FloorPlacement, Layout, RectangularPlacement,
  TablePlacement, VenueSpec,
} from "./types";

const CHAIR_REACH = 2.1;

export function tableDimensions(table: TablePlacement): { width: number; length: number } {
  return "diameterFt" in table
    ? { width: table.diameterFt, length: table.diameterFt }
    : { width: table.widthFt, length: table.lengthFt };
}

function chairsFor(table: TablePlacement, seats: number): ChairPlacement[] {
  if ("diameterFt" in table) {
    return Array.from({ length: seats }, (_, index) => {
      const angle = index * Math.PI * 2 / seats;
      const radius = table.diameterFt / 2 + 1.2;
      return {
        x: table.x + Math.sin(angle) * radius,
        z: table.z + Math.cos(angle) * radius,
        rotY: angle + Math.PI,
      };
    });
  }
  const firstSide = Math.ceil(seats / 2);
  return Array.from({ length: seats }, (_, index) => {
    const front = index < firstSide;
    const count = front ? firstSide : seats - firstSide;
    const position = front ? index : index - firstSide;
    return {
      x: table.x + (front ? 1 : -1) * (table.widthFt / 2 + 1.2),
      z: table.z + ((position + 0.5) / count - 0.5) * table.lengthFt,
      rotY: front ? -Math.PI / 2 : Math.PI / 2,
    };
  });
}

function makeTable(spec: DesignSpec, index: number): TablePlacement {
  const shape = spec.tables.shape === "mixed" ? (index % 2 ? "banquet" : "round") : spec.tables.shape;
  const size = (spec.tables.size_in ?? (shape === "banquet" || shape === "oval" ? 96 : 60)) / 12;
  if (shape === "round" || shape === "cocktail") {
    return { x: 0, z: 0, shape, diameterFt: size, chairs: [] };
  }
  return {
    x: 0, z: 0, shape, lengthFt: size,
    widthFt: shape === "square" ? size : 3, chairs: [],
  };
}

function intersects(a: FloorPlacement, b: FloorPlacement, gap: number): boolean {
  return Math.abs(a.x - b.x) < (a.widthFt + b.widthFt) / 2 + gap - 1e-8
    && Math.abs(a.z - b.z) < (a.lengthFt + b.lengthFt) / 2 + gap - 1e-8;
}

function grid(
  count: number, width: number, length: number, cellWidth: number, cellLength: number,
  gap: number, obstacles: FloorPlacement[],
): { x: number; z: number }[] {
  const columns = Math.max(0, Math.floor((width + gap) / (cellWidth + gap)));
  const rows = Math.max(0, Math.floor((length + gap) / (cellLength + gap)));
  const positions: { x: number; z: number }[] = [];
  // Both centered and edge-aligned grids avoid a central reserved area without jitter.
  for (const alignment of [0.5, 0, 1]) {
    positions.length = 0;
    const spanX = columns * cellWidth + Math.max(0, columns - 1) * gap;
    const spanZ = rows * cellLength + Math.max(0, rows - 1) * gap;
    for (let row = 0; row < rows && positions.length < count; row++) {
      for (let col = 0; col < columns && positions.length < count; col++) {
        const x = -width / 2 + (width - spanX) * alignment + cellWidth / 2 + col * (cellWidth + gap);
        const z = -length / 2 + (length - spanZ) * alignment + cellLength / 2 + row * (cellLength + gap);
        const footprint = { x, z, widthFt: cellWidth, lengthFt: cellLength };
        if (!obstacles.some(obstacle => intersects(footprint, obstacle, gap))) positions.push({ x, z });
      }
    }
    if (positions.length === count) break;
  }
  return positions;
}

/** Feet, with x across the room, z along its length, and the far wall at negative z. */
export function layoutTables(spec: DesignSpec, venue?: VenueSpec): Layout {
  const count = spec.tables.count;
  if (!Number.isInteger(count) || count < 0 || count > 300) throw new RangeError("tables.count must be 0..300");
  const seats = spec.tables.seats ?? (spec.tables.shape === "cocktail" ? 2 : 8);
  if (!Number.isInteger(seats) || seats < 1 || seats > 24) throw new RangeError("tables.seats must be 1..24");
  const guests = spec.guest_count ?? count * seats;
  const area = Math.max(1200, guests * 12);
  const room = {
    lengthFt: venue?.length_ft ?? Math.max(40, Math.sqrt(area * 4 / 3)),
    widthFt: venue?.width_ft ?? Math.max(30, Math.sqrt(area * 3 / 4)),
    ceilingFt: venue?.ceiling_ft ?? 12,
  };
  if (Object.values(room).some(value => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("Room dimensions must be positive finite numbers");
  }
  const warnings: string[] = [];
  const extras = spec.extras.join(" ").toLowerCase();
  const danceSize = Math.max(12, Math.sqrt(guests * 1.5));
  const danceFloor: FloorPlacement | null = /dance[\s-]+floor/.test(extras)
    ? { x: 0, z: 0, lengthFt: danceSize, widthFt: danceSize } : null;
  const headTable: RectangularPlacement | null = /(?:head|sweetheart)[\s-]+table/.test(extras)
    ? {
      x: 0, z: -room.lengthFt / 2 + 3.5, shape: "banquet",
      lengthFt: 3, widthFt: /sweetheart/.test(extras) ? 6 : 12, chairs: [],
    } : null;
  if (headTable) {
    const headSeats = /sweetheart/.test(extras) ? 2 : 6;
    headTable.chairs = Array.from({ length: headSeats }, (_, i) => ({
      x: ((i + 0.5) / headSeats - 0.5) * headTable.widthFt,
      z: headTable.z - 2.5, rotY: 0,
    }));
  }
  const obstacles: FloorPlacement[] = [];
  if (danceFloor) obstacles.push(danceFloor);
  if (headTable) obstacles.push({ ...headTable, lengthFt: headTable.lengthFt + 4, widthFt: headTable.widthFt + 2 });
  for (const obstacle of obstacles) {
    if (Math.abs(obstacle.x) + obstacle.widthFt / 2 > room.widthFt / 2
      || Math.abs(obstacle.z) + obstacle.lengthFt / 2 > room.lengthFt / 2) {
      warnings.push("Reserved decor extends beyond the room; increase the venue dimensions.");
    }
  }
  if (obstacles.length === 2 && intersects(obstacles[0], obstacles[1], 0)) {
    warnings.push("The dance floor and head table overlap in this room.");
  }
  const tables = Array.from({ length: count }, (_, i) => makeTable(spec, i));
  if (count === 0) return { tables, danceFloor, headTable, room, warnings };
  const cellWidth = Math.max(...tables.map(table => tableDimensions(table).width)) + CHAIR_REACH * 2;
  const cellLength = Math.max(...tables.map(table => tableDimensions(table).length)) + CHAIR_REACH * 2;
  let positions: { x: number; z: number }[] = [];
  let usedGap = 5;
  for (const gap of [5, 4, 3, 2, 1, 0]) {
    positions = grid(count, room.widthFt, room.lengthFt, cellWidth, cellLength, gap, obstacles);
    usedGap = gap;
    if (positions.length === count) break;
  }
  if (positions.length < count) {
    // Never silently drop tables or shrink their geometry when the request is physically impossible.
    warnings.push(`${count} tables don't fit even without walkways; overflow tables are outside the room.`);
    const columns = Math.max(1, Math.floor(room.widthFt / cellWidth));
    for (let i = 0; positions.length < count; i++) {
      const x = (i % columns - (columns - 1) / 2) * (cellWidth + 5);
      const z = room.lengthFt / 2 + cellLength / 2 + 5 + Math.floor(i / columns) * (cellLength + 5);
      const footprint = { x, z, widthFt: cellWidth, lengthFt: cellLength };
      if (!obstacles.some(obstacle => intersects(footprint, obstacle, 5))) positions.push({ x, z });
    }
  } else if (usedGap < 5) {
    warnings.push(`${count} tables don't fit with 5ft walkways; using ${usedGap}ft`);
  }
  tables.forEach((table, index) => {
    Object.assign(table, positions[index]);
    table.chairs = chairsFor(table, seats);
  });
  return { tables, danceFloor, headTable, room, warnings };
}
