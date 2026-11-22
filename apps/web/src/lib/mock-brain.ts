/** Deterministic keyword "brain" for mock mode, in the spirit of the API's offline mock brain. */
import { knownColorNames } from "@/lib/spec";
import type { Ambiguity, ChatIntent, DesignSpec, VenueRules } from "@/lib/types";

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

/** "burgundy and plum, blue uplighting" → blue: the color right before the keyword wins, else one right after. */
function colorOf(text: string, keyword: string): string | null {
  const idx = text.indexOf(keyword);
  if (idx < 0) return null;
  const before = colorsIn(text.slice(Math.max(0, idx - 24), idx)).at(-1);
  const gap = before ? text.slice(text.lastIndexOf(before, idx) + before.length, idx) : "";
  if (before && /^[\s-]*$/.test(gap)) return before;
  return colorsIn(text.slice(idx, idx + keyword.length + 24))[0] ?? before ?? null;
}

const RENDER_ASK = /\b(see it|see this|see that|see how|show me|let me see|render|preview|how (it|that|this) (looks|would look|will look)|what (it|that|this) looks like)\b/;
const MOODS = ["moody", "romantic", "rustic", "elegant", "whimsical", "modern", "classic", "boho", "glam", "garden", "minimal", "cozy", "dramatic", "airy"];
const TIME_WORDS: Record<NonNullable<NonNullable<DesignSpec["scene"]>["time_of_day"]>, string> = {
  daylight: "daylight",
  golden_hour: "golden hour",
  evening: "evening",
  night: "night",
};

function sceneFrom(text: string): DesignSpec["scene"] | null {
  if (/\b(golden hour|sunset)\b/.test(text)) return { time_of_day: "golden_hour" };
  if (/\b(night|nighttime|after dark|dark (out|outside))\b|\bnot daylight\b|\b(7|8|9|10|11)\s?(pm|p\.m\.)/.test(text)) {
    return { time_of_day: "night", windows: "dark" };
  }
  if (/\b(evening|dusk|(5|6)\s?(pm|p\.m\.))\b/.test(text)) return { time_of_day: "evening" };
  if (/\b(daylight|daytime|brunch|morning|afternoon|noon|sunny)\b/.test(text)) return { time_of_day: "daylight", windows: "as_photographed" };
  return null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A short name for what this message asked for, e.g. "Moody night, blue uplighting". */
function lookNameFor(text: string, spec: DesignSpec, palette: string[], changes: string[]): string | null {
  const mood = MOODS.find((m) => new RegExp(`\\b${m}\\b`).test(text));
  const time = sceneFrom(text)?.time_of_day;
  const head = [mood, time ? TIME_WORDS[time] : null].filter(Boolean).join(" ");
  const detail = /uplight/.test(text) && spec.lighting.uplighting
    ? `${spec.lighting.uplighting} uplighting`
    : palette.length >= 2
      ? `${palette[0]} & ${palette[1]}`
      : (changes[0] ?? "");
  const name = head && detail ? `${head}, ${detail}` : head || detail;
  return name ? cap(name) : null;
}

export function mockBrain(
  message: string,
  input: DesignSpec,
  rules: VenueRules,
): { reply: string; spec: DesignSpec; intent: ChatIntent; look_name: string | null; ambiguities: Ambiguity[] } {
  const text = ` ${message.toLowerCase()} `;
  const spec = structuredClone(input);
  const changes: string[] = [];
  const ambiguities: Ambiguity[] = [];
  const wantsRender = RENDER_ASK.test(text);

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

  const uplightColor = colorOf(text, "uplight");
  const withoutUplight = uplightColor ? text.replace(new RegExp(`\\b${uplightColor}([\\s-]+uplight\\w*)`), " $1") : text;
  const colors = colorsIn(withoutUplight.replace(/uplight\w*\s+(in\s+)?\w+(\s+\w+)?/g, " "));
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
    ambiguities.push({ question: "Which flowers would you like?", options: ["Garden roses", "Peonies", "Ranunculus"] });
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
    spec.lighting.uplighting = /no uplight/.test(text) ? null : uplightColor ?? "warm amber";
    changes.push(spec.lighting.uplighting ? `${spec.lighting.uplighting} uplighting` : "no uplighting");
  }
  if (/pin ?spot/.test(text)) spec.lighting.pin_spots = true;
  if (/\bmoodier\b/.test(text)) {
    spec.lighting.ambient = "dim";
    changes.push("dimmer, moodier lighting");
    if (!/uplight/.test(text) && spec.lighting.uplighting) {
      const current = spec.lighting.uplighting;
      ambiguities.push({
        question: `Keep the ${current} uplighting, or switch to cool blue?`,
        options: [`Keep the ${current} uplighting`, "Switch to cool blue uplighting"],
      });
    }
  }
  const scene = sceneFrom(text);
  if (scene) {
    spec.scene = { ...spec.scene, ...scene };
    const t = scene.time_of_day ? TIME_WORDS[scene.time_of_day] : "";
    changes.push(spec.scene.windows === "dark" ? `${t} with dark windows` : t);
  }
  const ambientText = text.replace(/\bwarm\s+\w+\s+uplight\w*/g, " ");
  if (/\b(dim|moody|candlelit|intimate)\b/.test(ambientText) || scene?.time_of_day === "night") spec.lighting.ambient = "dim";
  else if (/\b(daylight|daytime|bright|brunch)\b/.test(ambientText) && !/not daylight/.test(ambientText)) spec.lighting.ambient = "daylight";
  else if (/\bwarm\b/.test(ambientText)) spec.lighting.ambient = "evening_warm";

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
    if (wantsRender) {
      return { reply: "Your plan is ready to render. It uses everything in Plan details right now.", spec, intent: "render", look_name: null, ambiguities: [] };
    }
    const provided = rules.provided_items?.[0];
    return {
      reply: `I couldn't find a specific change in that. Try colors, a guest count, table shapes or centerpieces${provided ? `, or build around the venue's ${provided.toLowerCase()}` : ""}.`,
      spec,
      intent: "none",
      look_name: null,
      ambiguities: [{ question: "", options: ["Blush and gold palette", "Tall centerpieces", "Add string lights"] }],
    };
  }

  const reply = changes.length
    ? `Updated the plan: ${changes.slice(0, 6).join(", ")}.`
    : "Happy to add flowers. Which would you like?";
  const intent: ChatIntent = wantsRender ? "render" : changes.length ? "edit" : "question";
  const palette = colors.length >= 2 ? colors : [];
  return { reply, spec, intent, look_name: changes.length ? lookNameFor(text, spec, palette, changes) : null, ambiguities };
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
  const t = spec.scene?.time_of_day;
  const w = spec.scene?.windows;
  const when = t || (w && w !== "as_photographed")
    ? ` Set it ${t ? (t === "night" ? "at night" : t === "golden_hour" ? "at golden hour" : `in the ${TIME_WORDS[t]}`) : ""}${w === "dark" ? " with dark windows" : w === "sheer_draped" ? " with sheer drapes over the windows" : ""}.`
    : "";
  return `Add ${add.join(", ")}.${when} Keep unchanged: walls, windows, ceiling, floor, chandeliers, camera angle.`;
}
