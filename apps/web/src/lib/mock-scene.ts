/**
 * Mock-mode scene illustrations. Draws an empty room as SVG and, for renders, composes decor from
 * a DesignSpec on top (tables, linens, chairs, centerpieces, uplighting...). Self-contained, with
 * type-only imports, so `scripts/gen-samples.ts` can run it with plain Node.
 */
import type { DesignSpec } from "@vv/schema";

export type RoomVariant = "north" | "corner" | "generated";

type Geometry = {
  vx: number;
  backY: number;
  backTop: number;
  backLeft: number;
  backRight: number;
};

const W = 1536;
const H = 1024;

const GEOMETRY: Record<RoomVariant, Geometry> = {
  north: { vx: 768, backY: 640, backTop: 220, backLeft: 368, backRight: 1168 },
  corner: { vx: 560, backY: 650, backTop: 250, backLeft: 210, backRight: 880 },
  generated: { vx: 768, backY: 620, backTop: 240, backLeft: 340, backRight: 1196 },
};

type RoomPalette = { wall: string; side: string; ceiling: string; floor: string; floorLine: string; trim: string };

function roomPalette(style: string | null | undefined): RoomPalette {
  const s = (style ?? "").toLowerCase();
  if (/barn|rustic|farm|wood/.test(s))
    return { wall: "#C9A57E", side: "#B58E66", ceiling: "#8A6544", floor: "#7A5638", floorLine: "#5E412A", trim: "#5E412A" };
  if (/loft|industrial|modern|warehouse|concrete/.test(s))
    return { wall: "#CFCBC4", side: "#BDB8B0", ceiling: "#9E9A93", floor: "#8F8B84", floorLine: "#77736D", trim: "#2E2D2B" };
  if (/garden|terrace|tent|pavilion|glass|conservatory/.test(s))
    return { wall: "#DDE5D8", side: "#CCD6C6", ceiling: "#F2F1EA", floor: "#BDB4A3", floorLine: "#9C9382", trim: "#F7F5EF" };
  return { wall: "#ECE4D6", side: "#DFD5C4", ceiling: "#F3EEE5", floor: "#B89A74", floorLine: "#9C7F5B", trim: "#D6C7AE" };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

function arch(x: number, y: number, w: number, h: number) {
  const r = w / 2;
  return `M${x},${y + h} L${x},${y + r} A${r},${r} 0 0 1 ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function chandelier(cx: number, cy: number, scale: number) {
  const s = scale;
  const crystals = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 8) * Math.PI;
    return `<circle cx="${cx - Math.cos(a) * 46 * s}" cy="${cy + 44 * s + Math.sin(a) * 16 * s}" r="${3 * s}" fill="#FFF6DC" opacity=".9"/>`;
  }).join("");
  return `<g>
    <line x1="${cx}" y1="0" x2="${cx}" y2="${cy}" stroke="#8C7A5B" stroke-width="${2 * s}"/>
    <ellipse cx="${cx}" cy="${cy + 18 * s}" rx="${30 * s}" ry="${8 * s}" fill="#C9A54B"/>
    <ellipse cx="${cx}" cy="${cy + 44 * s}" rx="${50 * s}" ry="${12 * s}" fill="#B8933F"/>
    <path d="M${cx - 50 * s},${cy + 44 * s} Q${cx},${cy + 96 * s} ${cx + 50 * s},${cy + 44 * s}" fill="#F4E7C3" opacity=".75"/>
    ${crystals}
    <circle cx="${cx}" cy="${cy + 40 * s}" r="${70 * s}" fill="url(#glow)" opacity=".55"/>
  </g>`;
}

function room(variant: RoomVariant, style?: string | null): string {
  const g = GEOMETRY[variant];
  const p = roomPalette(style ?? (variant === "generated" ? "garden pavilion" : "classic ballroom"));
  const { backY, backTop, backLeft, backRight } = g;
  const parts: string[] = [];

  parts.push(`<polygon points="0,0 ${W},0 ${backRight},${backTop} ${backLeft},${backTop}" fill="${p.ceiling}"/>`);
  parts.push(`<polygon points="0,0 ${backLeft},${backTop} ${backLeft},${backY} 0,${H}" fill="${p.side}"/>`);
  parts.push(`<polygon points="${W},0 ${backRight},${backTop} ${backRight},${backY} ${W},${H}" fill="${p.side}"/>`);
  parts.push(`<rect x="${backLeft}" y="${backTop}" width="${backRight - backLeft}" height="${backY - backTop}" fill="${p.wall}"/>`);
  parts.push(`<polygon points="${backLeft},${backY} ${backRight},${backY} ${W},${H} 0,${H}" fill="${p.floor}"/>`);

  // Floor boards converging on the vanishing point.
  for (let i = 0; i <= 24; i++) {
    const xb = backLeft + ((backRight - backLeft) * i) / 24;
    const xf = (W * i) / 24;
    parts.push(`<line x1="${xb}" y1="${backY}" x2="${xf}" y2="${H}" stroke="${p.floorLine}" stroke-width="1.2" opacity=".45"/>`);
  }
  for (let i = 1; i < 7; i++) {
    const t = Math.pow(i / 7, 1.6);
    const y = backY + (H - backY) * t;
    const xl = backLeft * (1 - t);
    const xr = backRight + (W - backRight) * t;
    parts.push(`<line x1="${xl}" y1="${y}" x2="${xr}" y2="${y}" stroke="${p.floorLine}" stroke-width="1" opacity=".3"/>`);
  }

  // Ceiling detail.
  if (variant === "generated" && /barn|rustic|wood/.test((style ?? "").toLowerCase())) {
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const y = backTop * t;
      parts.push(`<line x1="${backLeft * t}" y1="${y}" x2="${W - (W - backRight) * t}" y2="${y}" stroke="${p.trim}" stroke-width="${14 * (1 - t) + 4}"/>`);
    }
  } else {
    parts.push(`<rect x="${backLeft + 40}" y="${backTop - 34}" width="${backRight - backLeft - 80}" height="14" fill="${p.trim}" opacity=".6"/>`);
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      parts.push(`<line x1="${backLeft * t}" y1="${backTop * t}" x2="${W - (W - backRight) * t}" y2="${backTop * t}" stroke="${p.trim}" stroke-width="2" opacity=".35"/>`);
    }
  }

  // Back wall windows.
  const winCount = variant === "corner" ? 2 : 3;
  const span = backRight - backLeft;
  const winW = Math.min(140, span / (winCount * 1.9));
  for (let i = 0; i < winCount; i++) {
    const cx = backLeft + (span * (i + 0.5)) / winCount;
    const x = cx - winW / 2;
    const y = backTop + 70;
    const h = backY - backTop - 120;
    parts.push(`<path d="${arch(x - 10, y - 10, winW + 20, h + 20)}" fill="${p.trim}"/>`);
    parts.push(`<path d="${arch(x, y, winW, h)}" fill="url(#sky)"/>`);
    parts.push(`<line x1="${cx}" y1="${y + 8}" x2="${cx}" y2="${y + h}" stroke="${p.trim}" stroke-width="5"/>`);
    parts.push(`<line x1="${x}" y1="${y + h * 0.55}" x2="${x + winW}" y2="${y + h * 0.55}" stroke="${p.trim}" stroke-width="5"/>`);
  }

  // Tall windows on the right wall for the corner view.
  if (variant === "corner") {
    for (let i = 0; i < 3; i++) {
      const t0 = 0.12 + i * 0.27;
      const t1 = t0 + 0.16;
      const xa = backRight + (W - backRight) * t0;
      const xb = backRight + (W - backRight) * t1;
      const topA = backTop * (1 - t0) + 60;
      const topB = backTop * (1 - t1) + 60;
      const botA = backY + (H - backY) * t0 - 90;
      const botB = backY + (H - backY) * t1 - 90;
      parts.push(`<polygon points="${xa},${topA} ${xb},${topB} ${xb},${botB} ${xa},${botA}" fill="url(#sky)" stroke="${p.trim}" stroke-width="10"/>`);
    }
  }

  // Pilasters on side walls.
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const xl = backLeft * (1 - t);
    parts.push(`<line x1="${xl}" y1="${backTop * (1 - t)}" x2="${xl}" y2="${backY + (H - backY) * t}" stroke="${p.trim}" stroke-width="${10 * t + 4}" opacity=".55"/>`);
    if (variant !== "corner") {
      const xr = backRight + (W - backRight) * t;
      parts.push(`<line x1="${xr}" y1="${backTop * (1 - t)}" x2="${xr}" y2="${backY + (H - backY) * t}" stroke="${p.trim}" stroke-width="${10 * t + 4}" opacity=".55"/>`);
    }
  }

  // Fixtures.
  if (variant === "north") {
    parts.push(chandelier(560, 110, 1));
    parts.push(chandelier(976, 110, 1));
  } else if (variant === "corner") {
    parts.push(chandelier(620, 130, 1.2));
  } else if (!/barn|rustic|wood/.test((style ?? "").toLowerCase())) {
    parts.push(chandelier(768, 120, 0.9));
  }

  return parts.join("\n");
}

type DecorInput = Pick<DesignSpec, "tables" | "linens" | "chairs" | "centerpieces" | "lighting" | "extras" | "effects" | "install" | "palette">;

export type ResolvedColors = {
  linen: string;
  chair: string;
  runner: string | null;
  flowers: string[];
  greenery: string;
  uplight: string | null;
  accent: string;
};

function tablesSvg(g: Geometry, spec: DecorInput, c: ResolvedColors, rand: () => number) {
  const count = Math.max(0, Math.min(spec.tables.count, 18));
  if (count === 0) return "";
  const rows = count <= 4 ? 1 : count <= 9 ? 2 : 3;
  const perRow = Math.ceil(count / rows);
  const shape = spec.tables.shape;
  const out: string[] = [];
  let placed = 0;

  for (let r = 0; r < rows; r++) {
    const t = rows === 1 ? 0.55 : 0.28 + (0.62 * r) / (rows - 1);
    const y = g.backY + (H - g.backY) * Math.pow(t, 1.15);
    const left = g.backLeft * (1 - t);
    const right = g.backRight + (W - g.backRight) * t;
    const n = Math.min(perRow, count - placed);
    const s = 0.42 + t * 0.95;
    for (let i = 0; i < n; i++) {
      const x = left + ((right - left) * (i + 0.5 + (r % 2 ? 0.25 : 0))) / (n + (r % 2 ? 0.5 : 0));
      out.push(table(x, y, s, shape, spec, c, rand));
      placed++;
    }
  }
  return out.join("\n");
}

function table(x: number, y: number, s: number, shape: string, spec: DecorInput, c: ResolvedColors, rand: () => number) {
  const wide = shape === "banquet" ? 2.1 : shape === "oval" ? 1.4 : 1;
  const rx = 62 * s * wide;
  const ry = 18 * s;
  const length = spec.linens.length ?? "floor";
  const skirt = length === "floor" ? 46 * s : length === "lap" ? 20 * s : 6 * s;
  const cocktail = shape === "cocktail";
  const parts: string[] = [];

  const chair = (cx: number, cy: number, k: number) =>
    `<g><rect x="${cx - 9 * s * k}" y="${cy - 40 * s * k}" width="${18 * s * k}" height="${40 * s * k}" rx="${5 * s * k}" fill="${c.chair}"/>` +
    `<rect x="${cx - 12 * s * k}" y="${cy - 4 * s * k}" width="${24 * s * k}" height="${6 * s * k}" fill="${c.chair}" opacity=".85"/></g>`;

  if (!cocktail) {
    parts.push(chair(x - rx * 0.55, y - ry * 0.4, 0.9));
    parts.push(chair(x + rx * 0.55, y - ry * 0.4, 0.9));
    parts.push(chair(x, y - ry * 0.9, 0.85));
  }

  const top = cocktail ? y - 30 * s : y;
  if (shape === "banquet" || shape === "square") {
    parts.push(`<rect x="${x - rx}" y="${top - ry}" width="${rx * 2}" height="${ry * 2 + skirt}" rx="${4 * s}" fill="${c.linen}"/>`);
    parts.push(`<rect x="${x - rx}" y="${top - ry}" width="${rx * 2}" height="${ry * 2}" rx="${4 * s}" fill="#fff" opacity=".22"/>`);
  } else {
    const r = cocktail ? 0.45 : 1;
    parts.push(`<path d="M${x - rx * r},${top} L${x - rx * r},${top + skirt} A${rx * r},${ry * r} 0 0 0 ${x + rx * r},${top + skirt} L${x + rx * r},${top} Z" fill="${c.linen}"/>`);
    parts.push(`<path d="M${x - rx * r},${top} L${x - rx * r},${top + skirt} A${rx * r},${ry * r} 0 0 0 ${x + rx * r},${top + skirt} L${x + rx * r},${top} Z" fill="#000" opacity=".08"/>`);
    parts.push(`<ellipse cx="${x}" cy="${top}" rx="${rx * r}" ry="${ry * r}" fill="${c.linen}"/>`);
    parts.push(`<ellipse cx="${x}" cy="${top}" rx="${rx * r}" ry="${ry * r}" fill="#fff" opacity=".2"/>`);
  }
  if (c.runner && !cocktail) {
    parts.push(`<rect x="${x - rx * 0.12}" y="${top - ry}" width="${rx * 0.24}" height="${ry * 2 + skirt}" fill="${c.runner}" opacity=".85"/>`);
  }

  if (!cocktail) {
    parts.push(chair(x - rx * 0.75, y + ry * 1.6 + skirt * 0.2, 1.05));
    parts.push(chair(x + rx * 0.75, y + ry * 1.6 + skirt * 0.2, 1.05));
  }

  parts.push(centerpiece(x, top, s, spec, c, rand));
  return `<g>${parts.join("")}</g>`;
}

function centerpiece(x: number, y: number, s: number, spec: DecorInput, c: ResolvedColors, rand: () => number) {
  const out: string[] = [];
  const height = spec.centerpieces.height;
  const flowers = c.flowers.length ? c.flowers : [c.accent];
  const candles = spec.centerpieces.candles ?? "none";
  const stem = height === "tall" ? 120 : height === "medium" ? 55 : height === "mixed" ? 90 : 0;

  if (height !== "none") {
    if (stem > 0) {
      out.push(`<rect x="${x - 2 * s}" y="${y - stem * s}" width="${4 * s}" height="${stem * s}" fill="#D9C7A0"/>`);
    }
    const cy = y - stem * s - 6 * s;
    const radius = (height === "tall" ? 30 : height === "low" ? 18 : 24) * s;
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * radius;
      const fx = x + Math.cos(a) * d * 1.3;
      const fy = cy + Math.sin(a) * d * 0.6 - (stem ? radius * 0.4 : 0);
      const color = i % 4 === 0 ? c.greenery : flowers[i % flowers.length];
      out.push(`<circle cx="${fx}" cy="${fy}" r="${(5 + rand() * 4) * s}" fill="${color}"/>`);
    }
  }
  if (candles !== "none") {
    for (const dx of [-34, 34, -18, 18]) {
      const cx = x + dx * s;
      out.push(`<rect x="${cx - 3 * s}" y="${y - 14 * s}" width="${6 * s}" height="${14 * s}" fill="#FBF3DF"/>`);
      out.push(`<circle cx="${cx}" cy="${y - 17 * s}" r="${candles === "live" ? 9 * s : 7 * s}" fill="url(#flame)"/>`);
    }
  }
  return out.join("");
}

function lightingSvg(g: Geometry, spec: DecorInput, c: ResolvedColors) {
  const out: string[] = [];
  if (c.uplight) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x = g.backLeft + ((g.backRight - g.backLeft) * (i + 0.5)) / n;
      out.push(`<ellipse cx="${x}" cy="${g.backY - 60}" rx="60" ry="230" fill="${c.uplight}" opacity=".32" filter="url(#blur)"/>`);
    }
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const xl = g.backLeft * (1 - t) + 20;
      const xr = g.backRight + (W - g.backRight) * t - 20;
      const yb = g.backY + (H - g.backY) * t - 120;
      out.push(`<ellipse cx="${xl}" cy="${yb}" rx="${40 + 40 * t}" ry="${260 + 120 * t}" fill="${c.uplight}" opacity=".26" filter="url(#blur)"/>`);
      out.push(`<ellipse cx="${xr}" cy="${yb}" rx="${40 + 40 * t}" ry="${260 + 120 * t}" fill="${c.uplight}" opacity=".26" filter="url(#blur)"/>`);
    }
  }
  if (spec.lighting.string_lights) {
    for (let k = 0; k < 4; k++) {
      const y0 = 30 + k * 45;
      const sag = 60 + k * 12;
      const d = `M0,${y0} Q${W / 2},${y0 + sag * 2} ${W},${y0}`;
      out.push(`<path d="${d}" stroke="#3A3226" stroke-width="1.5" fill="none" opacity=".6"/>`);
      for (let i = 1; i < 24; i++) {
        const t = i / 24;
        const x = W * t;
        const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * (y0 + sag * 2) + t * t * y0;
        out.push(`<circle cx="${x}" cy="${y + 4}" r="4" fill="#FFE7A8"/><circle cx="${x}" cy="${y + 4}" r="12" fill="url(#flame)" opacity=".7"/>`);
      }
    }
  }
  return out.join("\n");
}

function extrasSvg(g: Geometry, spec: DecorInput, c: ResolvedColors, rand: () => number) {
  const out: string[] = [];
  const extras = spec.extras.map((e) => e.toLowerCase());
  if (extras.some((e) => e.includes("flower wall") || e.includes("backdrop"))) {
    const x0 = g.vx - 170;
    const y0 = g.backTop + 90;
    out.push(`<rect x="${x0}" y="${y0}" width="340" height="${g.backY - y0}" fill="${c.greenery}"/>`);
    for (let i = 0; i < 160; i++) {
      out.push(`<circle cx="${x0 + rand() * 340}" cy="${y0 + rand() * (g.backY - y0)}" r="${7 + rand() * 6}" fill="${c.flowers[i % Math.max(1, c.flowers.length)] ?? c.accent}"/>`);
    }
  }
  if (extras.some((e) => e.includes("dance floor"))) {
    const y = g.backY + 30;
    out.push(`<polygon points="${g.vx - 220},${y} ${g.vx + 220},${y} ${g.vx + 300},${y + 90} ${g.vx - 300},${y + 90}" fill="#F7F3EA" opacity=".85" stroke="#1B1A19" stroke-width="2"/>`);
  }
  if (spec.install?.ceiling_draping) {
    for (let i = 0; i < 6; i++) {
      const x = (W * (i + 0.5)) / 6;
      out.push(`<path d="M${g.vx},${g.backTop * 0.4} Q${(x + g.vx) / 2},${g.backTop * 0.9} ${x},0" stroke="${c.linen}" stroke-width="38" fill="none" opacity=".7"/>`);
    }
  }
  return out.join("\n");
}

function moodSvg(spec: DecorInput, c: ResolvedColors) {
  const ambient = spec.lighting.ambient ?? "evening_warm";
  const out: string[] = [];
  if (ambient === "evening_warm") out.push(`<rect width="${W}" height="${H}" fill="#3B220E" opacity=".2"/>`);
  if (ambient === "dim") out.push(`<rect width="${W}" height="${H}" fill="#0E0B08" opacity=".42"/>`);
  if (ambient === "colored") out.push(`<rect width="${W}" height="${H}" fill="${c.uplight ?? c.accent}" opacity=".16"/>`);
  if (spec.effects?.fog) out.push(`<rect y="${H * 0.55}" width="${W}" height="${H * 0.45}" fill="url(#fog)"/>`);
  if (spec.effects?.confetti) {
    const rand = mulberry32(7);
    for (let i = 0; i < 120; i++) {
      out.push(`<rect x="${rand() * W}" y="${rand() * H * 0.8}" width="8" height="4" fill="${c.flowers[i % Math.max(1, c.flowers.length)] ?? c.accent}" transform="rotate(${rand() * 180} ${rand() * W} ${rand() * H})"/>`);
    }
  }
  return out.join("\n");
}

function defs() {
  return `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#CFE0EA"/><stop offset="1" stop-color="#F3EBDD"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#FFF1C9" stop-opacity=".9"/><stop offset="1" stop-color="#FFF1C9" stop-opacity="0"/></radialGradient>
    <radialGradient id="flame"><stop offset="0" stop-color="#FFE3A3" stop-opacity="1"/><stop offset="1" stop-color="#FFB547" stop-opacity="0"/></radialGradient>
    <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></linearGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28"/></filter>
  </defs>`;
}

function wrap(body: string, label: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${defs()}${body}</svg>`;
}

export function roomSvg(variant: RoomVariant, style?: string | null): string {
  return wrap(room(variant, style), "Empty venue room");
}

export function renderSvg(variant: RoomVariant, spec: DecorInput, colors: ResolvedColors, style?: string | null, stamp = "Mock engine"): string {
  const g = GEOMETRY[variant];
  const rand = mulberry32(spec.tables.count * 97 + spec.palette.join("").length * 13 + 1);
  const body = [
    room(variant, style),
    lightingSvg(g, spec, colors),
    extrasSvg(g, spec, colors, rand),
    tablesSvg(g, spec, colors, rand),
    moodSvg(spec, colors),
    `<text x="${W - 24}" y="${H - 24}" text-anchor="end" font-family="Georgia, serif" font-size="22" fill="#fff" opacity=".7">${esc(stamp)}</text>`,
  ].join("\n");
  return wrap(body, "Mock render of the venue with decor");
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const SCENE_SIZE = { width: W, height: H };
