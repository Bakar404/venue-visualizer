/** Deterministic keyword "brain" for mock mode, in the spirit of the API's offline mock brain. */
import { knownColorNames } from "@/lib/spec";
import type { DesignSpec, VenueRules } from "@/lib/types";

const FLOWERS = [
  "garden roses",
  "roses",
  "peonies",
  "ranunculus",
  "hydrangeas",
  "dahlias",
  "orchids",
  "tulips",
  "anemones",
  "lilies",
  "gardenias",
  "baby's breath",
  "sweet peas",
  "magnolia",
  "wildflowers",
];
const CHAIR_STYLES = ["chiavari", "cross-back", "ghost", "folding", "banquet", "windsor", "velvet"];
const SHAPES = ["round", "banquet", "square", "oval", "cocktail"] as const;
const EXTRAS = ["dance floor", "flower wall", "sweetheart table", "lounge", "bar", "photo booth", "stage", "cake table", "head table", "arch"];
const EVENTS = ["wedding", "corporate", "birthday", "gala", "shower"] as const;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
};

function num(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

function colorsIn(text: string): string[] {
  const names = knownColorNames().sort((a, b) => b.length - a.length);
  const found: Array<[number, string]> = [];
  let rest = text;
  for (const name of names) {
    const re = new RegExp(`\\b${name}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) {
      found.push([m.index, name]);
      rest = rest.slice(0, m.index) + " ".repeat(name.length) + rest.slice(m.index + name.length);
    }
  }
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, n]) => n))];
}

function colorNear(text: string, keyword: string): string | null {
  const idx = text.indexOf(keyword);
  if (idx < 0) return null;
  const window = text.slice(Math.max(0, idx - 24), idx + keyword.length + 24);
  return colorsIn(window)[0] ?? null;
}

export function mockBrain(
  message: string,
  input: DesignSpec,
  rules: VenueRules,
): { reply: string; spec: DesignSpec; ambiguities: string[] } {
  const text = ` ${message.toLowerCase()} `;
  const spec = structuredClone(input);
  const changes: string[] = [];
  const ambiguities: string[] = [];

  const guests = text.match(/(\d+|\w+)\s+(guests|people|attendees)/);
  if (guests && num(guests[1])) {
    spec.guest_count = num(guests[1]);
    changes.push(`${spec.guest_count} guests`);
  }

  for (const event of EVENTS) {
    if (text.includes(event)) {
      spec.event_type = event;
      break;
    }
  }

  const tables = text.match(/(\d+|\w+)\s+(?:(round|banquet|square|oval|cocktail|long)\s+)?tables?/);
  if (tables && num(tables[1]) !== null) {
    spec.tables.count = num(tables[1])!;
    if (tables[2]) spec.tables.shape = tables[2] === "long" ? "banquet" : (tables[2] as (typeof SHAPES)[number]);
    changes.push(`${spec.tables.count} ${spec.tables.shape} tables`);
  } else {
    const shape = SHAPES.find((s) => text.includes(`${s} table`)) ?? (text.includes("long table") ? "banquet" : null);
    if (shape) {
      spec.tables.shape = shape;
      changes.push(`${shape} tables`);
    }
  }
  if (!tables && spec.guest_count && guests) {
    const seats = spec.tables.seats ?? 10;
    spec.tables.count = Math.ceil(spec.guest_count / seats);
    changes.push(`${spec.tables.count} tables of ${seats}`);
  }

  const colors = colorsIn(text.replace(/uplight\w*\s+\w+(\s+\w+)?/g, " "));
  const linen = colorNear(text, "linen") ?? colorNear(text, "tablecloth");
  const chairColor = CHAIR_STYLES.map((s) => colorNear(text, s)).find(Boolean) ?? colorNear(text, "chair");
  if (colors.length && (text.includes("palette") || colors.length >= 2 || (!linen && !chairColor))) {
    spec.palette = colors.slice(0, 5);
    spec.centerpieces.colors = colors.slice(0, 3);
    changes.push(`palette of ${colors.slice(0, 3).join(", ")}`);
  }
  if (linen) {
    spec.linens.color = linen;
    changes.push(`${linen} linens`);
  } else if (colors.length >= 1 && text.includes("palette")) {
    spec.linens.color = colors.at(-1) ?? spec.linens.color;
  }
  if (text.includes("runner")) {
    spec.linens.runner = colorNear(text, "runner") ?? "gold";
    changes.push(`${spec.linens.runner} runners`);
  }

  const chairStyle = CHAIR_STYLES.find((s) => text.includes(s));
  if (chairStyle) {
    spec.chairs.style = chairStyle;
    changes.push(`${chairColor ?? spec.chairs.color} ${chairStyle} chairs`);
  }
  if (chairColor) spec.chairs.color = chairColor;

  if (/\btall\b/.test(text)) spec.centerpieces.height = "tall";
  else if (/\blow\b/.test(text)) spec.centerpieces.height = "low";
  else if (/\bmedium\b/.test(text)) spec.centerpieces.height = "medium";
  if (/\b(tall|low|medium)\b/.test(text)) changes.push(`${spec.centerpieces.height} centerpieces`);

  const flowers = FLOWERS.filter((f) => text.includes(f) && !(f === "roses" && text.includes("garden roses")));
  if (flowers.length) {
    spec.centerpieces.flowers = flowers;
    changes.push(flowers.join(" and "));
  } else if (/\bflowers?\b|\bfloral\b/.test(text)) {
    ambiguities.push("Use garden roses", "Use peonies", "Use ranunculus");
  }
  if (text.includes("greenery") || text.includes("eucalyptus")) spec.centerpieces.greenery = text.includes("eucalyptus") ? "eucalyptus" : "mixed greenery";

  if (/candle/.test(text)) {
    spec.centerpieces.candles = /flameless|led\b/.test(text) ? "flameless" : /no candles/.test(text) ? "none" : "live";
    changes.push(spec.centerpieces.candles === "none" ? "no candles" : `${spec.centerpieces.candles} candles`);
  }
  if (/string lights|fairy lights|bistro lights/.test(text)) {
    spec.lighting.string_lights = !/no (string|fairy|bistro) lights/.test(text);
    changes.push(spec.lighting.string_lights ? "string lights" : "no string lights");
  }
  if (/uplight/.test(text)) {
    spec.lighting.uplighting = /no uplight/.test(text) ? null : colorNear(text, "uplight") ?? "warm amber";
    changes.push(spec.lighting.uplighting ? `${spec.lighting.uplighting} uplighting` : "no uplighting");
  }
  if (/pin ?spot/.test(text)) spec.lighting.pin_spots = true;
  if (/\b(dim|moody|candlelit|intimate)\b/.test(text)) spec.lighting.ambient = "dim";
  else if (/\b(daylight|daytime|bright|brunch)\b/.test(text)) spec.lighting.ambient = "daylight";
  else if (/\bwarm\b/.test(text)) spec.lighting.ambient = "evening_warm";

  spec.effects = { fog: false, confetti: false, sparklers: false, ...spec.effects };
  if (/\bfog\b|\bhaze\b/.test(text)) spec.effects.fog = !/no (fog|haze)/.test(text);
  if (/confetti/.test(text)) spec.effects.confetti = !/no confetti/.test(text);
  if (/sparkler/.test(text)) spec.effects.sparklers = !/no sparkler/.test(text);
  spec.install = { uses_adhesives: false, uses_nails: false, ceiling_draping: false, ...spec.install };
  if (/drap/.test(text)) {
    spec.install.ceiling_draping = !/no drap/.test(text);
    changes.push(spec.install.ceiling_draping ? "ceiling draping" : "no draping");
  }
  if (/\btape\b|adhesive/.test(text)) spec.install.uses_adhesives = true;

  for (const extra of EXTRAS) {
    if (text.includes(extra) && !spec.extras.includes(extra)) {
      spec.extras = [...spec.extras, extra];
      changes.push(extra);
    }
  }

  if (changes.length === 0 && ambiguities.length === 0) {
    const provided = rules.provided_items?.[0];
    return {
      reply: `I couldn't find a specific change in that. Try colors, a guest count, table shapes or centerpieces${provided ? `, or build around the venue's ${provided.toLowerCase()}` : ""}.`,
      spec,
      ambiguities: ["Blush and gold palette", "Tall centerpieces", "Add string lights"],
    };
  }

  const reply = changes.length
    ? `Updated the plan: ${changes.slice(0, 6).join(", ")}.`
    : "Happy to add flowers. Which would you like?";
  return { reply, spec, ambiguities };
}

export function buildPrompt(spec: DesignSpec): string {
  const c = spec.centerpieces;
  const flowers = c.flowers?.length ? ` of ${c.flowers.join(" and ")}` : "";
  const add = [
    `${spec.tables.count} ${spec.tables.shape} tables with ${spec.linens.color} ${spec.linens.length ?? "floor"}-length linens`,
    `${spec.chairs.color} ${spec.chairs.style} chairs`,
    c.height !== "none" ? `${c.height} centerpieces${flowers}` : null,
    c.candles && c.candles !== "none" ? `${c.candles} candles` : null,
    spec.lighting.uplighting ? `${spec.lighting.uplighting} uplighting` : null,
    spec.lighting.string_lights ? "string lights" : null,
    ...spec.extras,
  ].filter(Boolean);
  return `Add ${add.join(", ")}. Keep unchanged: walls, windows, ceiling, floor, chandeliers, camera angle.`;
}
