import type { DesignSpec, RuleWarning, VenueRules } from "@/lib/types";

export function defaultSpec(space = "ballroom"): DesignSpec {
  return {
    version: 1,
    space,
    event_type: "wedding",
    guest_count: 120,
    palette: ["ivory", "gold"],
    tables: { count: 12, shape: "round", size_in: 60, seats: 10 },
    linens: { color: "ivory", pattern: null, length: "floor", runner: null },
    napkins: { color: "ivory", fold: null },
    chairs: { style: "chiavari", color: "gold", cushion: "ivory", sash: null },
    centerpieces: {
      height: "low",
      flowers: ["garden roses"],
      colors: ["ivory", "blush"],
      greenery: "eucalyptus",
      container: "gold compote",
      candles: "flameless",
    },
    lighting: { uplighting: "warm amber", pin_spots: false, string_lights: false, ambient: "evening_warm" },
    extras: [],
    effects: { fog: false, confetti: false, sparklers: false },
    install: { uses_adhesives: false, uses_nails: false, ceiling_draping: false },
    notes: null,
  };
}

export const RULE_LABELS: Record<
  Exclude<keyof VenueRules, "provided_items" | "notes">,
  { label: string; hint: string }
> = {
  live_candles: { label: "Live candles", hint: "Off means flameless only" },
  fog: { label: "Fog or haze", hint: "Fog machines and hazers" },
  confetti: { label: "Confetti", hint: "Confetti and petal toss" },
  sparklers: { label: "Sparklers", hint: "Sparkler send-offs" },
  adhesives: { label: "Tape and adhesives", hint: "On walls, floors or fixtures" },
  nails: { label: "Nails and screws", hint: "Anything that pierces surfaces" },
  ceiling_draping: { label: "Ceiling draping", hint: "Fabric hung from the ceiling" },
};

export type RuleKey = keyof typeof RULE_LABELS;
export const RULE_KEYS = Object.keys(RULE_LABELS) as RuleKey[];

export function defaultRules(): VenueRules {
  return {
    live_candles: true,
    fog: true,
    confetti: true,
    sparklers: true,
    adhesives: true,
    nails: true,
    ceiling_draping: true,
    provided_items: [],
    notes: null,
  };
}

export function isAllowed(rules: VenueRules, key: RuleKey): boolean {
  return rules[key] ?? true;
}

/**
 * Deterministic venue-rule enforcement, mirroring `pipeline.rules.check`.
 * Used by mock mode only; the API is authoritative in real mode.
 */
export function applyRules(input: DesignSpec, rules: VenueRules): { spec: DesignSpec; warnings: RuleWarning[] } {
  const spec = structuredClone(input);
  const warnings: RuleWarning[] = [];

  if (rules.live_candles === false && spec.centerpieces.candles === "live") {
    spec.centerpieces.candles = "flameless";
    warnings.push({
      rule: "live_candles",
      field: "/centerpieces/candles",
      message: "This venue doesn't allow open flames.",
      fix: "Switched candles to flameless LED pillars.",
    });
  }
  const effects: Array<["fog" | "confetti" | "sparklers", string]> = [
    ["fog", "Fog and haze aren't allowed here."],
    ["confetti", "Confetti isn't allowed here."],
    ["sparklers", "Sparklers aren't allowed here."],
  ];
  for (const [key, message] of effects) {
    if (rules[key] === false && spec.effects?.[key]) {
      spec.effects = { ...spec.effects, [key]: false };
      warnings.push({ rule: key, field: `/effects/${key}`, message, fix: `Removed ${key} from the plan.` });
    }
  }
  const installs: Array<["adhesives" | "nails" | "ceiling_draping", "uses_adhesives" | "uses_nails" | "ceiling_draping", string, string]> = [
    ["adhesives", "uses_adhesives", "No tape or adhesives on venue surfaces.", "Use freestanding stands and weighted bases instead."],
    ["nails", "uses_nails", "No nails or screws in venue surfaces.", "Use freestanding frames instead."],
    ["ceiling_draping", "ceiling_draping", "Ceiling draping isn't allowed here.", "Removed ceiling draping; kept uplighting for height."],
  ];
  for (const [rule, field, message, fix] of installs) {
    if (rules[rule] === false && spec.install?.[field]) {
      spec.install = { ...spec.install, [field]: false };
      warnings.push({ rule, field: `/install/${field}`, message, fix });
    }
  }
  return { spec, warnings };
}

const NAMED_COLORS: Record<string, string> = {
  ivory: "#F4EEDC",
  cream: "#F1E6CC",
  white: "#FBFAF7",
  champagne: "#E9D8B4",
  gold: "#C9A54B",
  "antique gold": "#B08D45",
  brass: "#B5893B",
  silver: "#C7C9CC",
  blush: "#EBC3BE",
  "dusty rose": "#C99A98",
  rose: "#D88A93",
  pink: "#EFA9B8",
  peach: "#F3BE9A",
  terracotta: "#C8694A",
  rust: "#A8532E",
  burgundy: "#6F1F2D",
  wine: "#5E1A2A",
  red: "#B3292E",
  coral: "#EE7E66",
  lavender: "#C4B5DC",
  lilac: "#C9A9D6",
  mauve: "#A6798F",
  plum: "#5D2E4F",
  navy: "#1F2A44",
  "dusty blue": "#8FA6BC",
  "sky blue": "#A9CBE5",
  blue: "#3F6CA8",
  sage: "#A7B79A",
  eucalyptus: "#8BA493",
  emerald: "#1F6B4F",
  green: "#3E7A52",
  olive: "#7A7A44",
  "forest green": "#244233",
  black: "#1B1A19",
  charcoal: "#3A3936",
  grey: "#9A9893",
  gray: "#9A9893",
  taupe: "#A39383",
  copper: "#B26C3D",
  yellow: "#EBCB5B",
  mustard: "#C89B2C",
  orange: "#E2873B",
  amber: "#D9A13B",
  "warm amber": "#E2A24A",
  teal: "#2C7C7A",
  purple: "#6B4C9A",
};

export function colorFor(name: string): string {
  const key = name.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(key)) return key;
  if (NAMED_COLORS[key]) return NAMED_COLORS[key];
  const word = Object.keys(NAMED_COLORS)
    .sort((a, b) => b.length - a.length)
    .find((k) => key.includes(k));
  if (word) return NAMED_COLORS[word];
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 32% 66%)`;
}

export function knownColorNames(): string[] {
  return Object.keys(NAMED_COLORS);
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function suggestLookName(spec: DesignSpec): string {
  const colors = spec.palette.slice(0, 3).map((c) => c.trim()).filter(Boolean);
  if (colors.length === 0) return "Untitled look";
  if (colors.length === 1) return titleCase(colors[0]);
  return titleCase(`${colors.slice(0, -1).join(", ")} & ${colors.at(-1)}`);
}

export function specEquals(a: DesignSpec | null | undefined, b: DesignSpec | null | undefined) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const FIELD_LABELS: Record<string, string> = {
  space: "Space",
  event_type: "Event",
  guest_count: "Guests",
  palette: "Palette",
  "tables.count": "Tables",
  "tables.shape": "Table shape",
  "tables.size_in": "Table size (in)",
  "tables.seats": "Seats per table",
  "linens.color": "Linen color",
  "linens.pattern": "Linen pattern",
  "linens.length": "Linen length",
  "linens.runner": "Runner",
  "napkins.color": "Napkin color",
  "napkins.fold": "Napkin fold",
  "chairs.style": "Chair style",
  "chairs.color": "Chair color",
  "chairs.cushion": "Cushion",
  "chairs.sash": "Sash",
  "centerpieces.height": "Centerpiece height",
  "centerpieces.flowers": "Flowers",
  "centerpieces.colors": "Flower colors",
  "centerpieces.greenery": "Greenery",
  "centerpieces.container": "Container",
  "centerpieces.candles": "Candles",
  "lighting.uplighting": "Uplighting",
  "lighting.pin_spots": "Pin spots",
  "lighting.string_lights": "String lights",
  "lighting.ambient": "Ambient light",
  extras: "Extras",
  "effects.fog": "Fog",
  "effects.confetti": "Confetti",
  "effects.sparklers": "Sparklers",
  "install.uses_adhesives": "Uses adhesives",
  "install.uses_nails": "Uses nails",
  "install.ceiling_draping": "Ceiling draping",
  notes: "Notes",
};

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return String(value).replace(/_/g, " ");
}

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export type SpecRow = { path: string; label: string; a: string; b: string; changed: boolean };

export function diffSpecs(a: DesignSpec, b: DesignSpec): SpecRow[] {
  return Object.entries(FIELD_LABELS)
    .filter(([path]) => path !== "space")
    .map(([path, label]) => {
      const va = display(get(a, path));
      const vb = display(get(b, path));
      return { path, label, a: va, b: vb, changed: va !== vb };
    });
}

export function labelForPointer(pointer: string): string {
  const path = pointer.replace(/^\//, "").replace(/\//g, ".");
  return FIELD_LABELS[path] ?? path;
}

/** Job progress may arrive as 0-1 or 0-100; normalise to a 0-1 fraction. */
export function progressFraction(progress: number | null | undefined): number {
  if (!progress || Number.isNaN(progress)) return 0;
  const p = progress > 1 ? progress / 100 : progress;
  return Math.min(1, Math.max(0, p));
}

export const LOW_STRUCTURE_SCORE = 0.55;

export function latestRenderFor<T extends { photo_id: string; created_at: string }>(
  renders: T[] | undefined,
  photoId: string,
): T | undefined {
  return renders
    ?.filter((r) => r.photo_id === photoId)
    .sort((x, y) => x.created_at.localeCompare(y.created_at))
    .at(-1);
}

export function firstDoneRender<T extends { status: string; url: string | null }>(renders: T[] | undefined) {
  return renders?.find((r) => r.status === "done" && r.url);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
