import type { DesignSpec, SceneCamera, VenueSpec } from "@vv/scene";

export interface SceneParams {
  spec: DesignSpec;
  venue: VenueSpec;
  camera: SceneCamera;
}

const CAMERAS: readonly SceneCamera[] = ["wide", "top", "corner"];
const SHAPES = ["round", "banquet", "square", "oval", "cocktail", "mixed"] as const;
const HEIGHTS = ["none", "low", "medium", "tall", "mixed"] as const;

export function base64UrlDecode(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Each encoded query param is capped before decoding so a huge URL can't stall the page. */
export const MAX_PARAM_LENGTH = 64 * 1024;
const MAX_TEXT = 200;
const MAX_NOTES = 2000;
const MAX_LIST = 32;
const MAX_ROOM_FT = 1000;
const AMBIENTS = ["daylight", "evening_warm", "dim", "colored"] as const;
const LENGTHS = ["floor", "lap", "none"];
const CANDLES = ["none", "flameless", "live"];

function parseJson(name: string, raw: string | null): unknown {
  if (!raw) throw new Error(`missing "${name}"`);
  if (raw.length > MAX_PARAM_LENGTH) throw new Error(`"${name}" is longer than ${MAX_PARAM_LENGTH} characters`);
  try {
    return JSON.parse(base64UrlDecode(raw));
  } catch {
    throw new Error(`"${name}" is not base64url-encoded JSON`);
  }
}

/** Optional text, trimmed to `max`. Non-strings become undefined. */
function text(v: unknown, max = MAX_TEXT): string | undefined {
  return typeof v === "string" ? v.slice(0, max) : undefined;
}

function requiredText(v: unknown, path: string): string {
  if (typeof v !== "string") throw new Error(`${path} must be a string`);
  return v.slice(0, MAX_TEXT);
}

function textList(v: unknown, path: string, required = false): string[] {
  if (v == null && !required) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`${path} must be a string array`);
  return (v as string[]).slice(0, MAX_LIST).map((x) => x.slice(0, MAX_TEXT));
}

function int(v: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new Error(`${path} must be an integer ${min}–${max}`);
  return v as number;
}

function optionalInt(v: unknown, path: string, min: number, max: number): number | null {
  return v == null ? null : int(v, path, min, max);
}

function oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
  if (!options.includes(v as T)) throw new Error(`${path} must be one of ${options.join(", ")}`);
  return v as T;
}

const optionalOneOf = <T extends string>(v: unknown, options: readonly T[]): T | undefined =>
  options.includes(v as T) ? (v as T) : undefined;

const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

/**
 * Validates every field the scene reads and returns a clean copy: numbers within the schema's bounds,
 * strings and lists length-capped, unknown enum values rejected (or defaulted for lighting.ambient).
 */
export function sanitizeDesignSpec(v: unknown): DesignSpec {
  if (!isObject(v)) throw new Error("spec must be an object");
  if (v.version !== 1) throw new Error("spec.version must be 1");
  const t = v.tables;
  if (!isObject(t)) throw new Error("spec.tables must be an object");
  const linens = v.linens;
  if (!isObject(linens)) throw new Error("spec.linens must be an object");
  const chairs = v.chairs;
  if (!isObject(chairs)) throw new Error("spec.chairs must be an object");
  const centerpieces = v.centerpieces;
  if (!isObject(centerpieces)) throw new Error("spec.centerpieces must be an object");
  const lighting = isObject(v.lighting) ? v.lighting : null;
  if (!lighting) throw new Error("spec.lighting must be an object");
  const napkins = isObject(v.napkins) ? v.napkins : undefined;
  const effects = isObject(v.effects) ? v.effects : undefined;
  const install = isObject(v.install) ? v.install : undefined;

  return {
    version: 1,
    space: requiredText(v.space, "spec.space"),
    event_type: optionalOneOf(v.event_type, ["wedding", "corporate", "birthday", "gala", "shower", "other"] as const),
    guest_count: optionalInt(v.guest_count, "spec.guest_count", 1, 2000),
    palette: textList(v.palette, "spec.palette", true),
    tables: {
      count: int(t.count, "spec.tables.count", 0, 300),
      shape: oneOf(t.shape, SHAPES, "spec.tables.shape"),
      size_in: optionalInt(t.size_in, "spec.tables.size_in", 24, 120),
      seats: optionalInt(t.seats, "spec.tables.seats", 1, 24),
    },
    linens: {
      color: requiredText(linens.color, "spec.linens.color"),
      pattern: text(linens.pattern) ?? null,
      length: optionalOneOf(linens.length, LENGTHS as ["floor", "lap", "none"]),
      runner: text(linens.runner) ?? null,
    },
    napkins: napkins && { color: text(napkins.color) ?? null, fold: text(napkins.fold) ?? null },
    chairs: {
      style: requiredText(chairs.style, "spec.chairs.style"),
      color: requiredText(chairs.color, "spec.chairs.color"),
      cushion: text(chairs.cushion) ?? null,
      sash: text(chairs.sash) ?? null,
    },
    centerpieces: {
      height: oneOf(centerpieces.height, HEIGHTS, "spec.centerpieces.height"),
      flowers: textList(centerpieces.flowers, "spec.centerpieces.flowers"),
      colors: textList(centerpieces.colors, "spec.centerpieces.colors"),
      greenery: text(centerpieces.greenery) ?? null,
      container: text(centerpieces.container) ?? null,
      candles: optionalOneOf(centerpieces.candles, CANDLES as ["none", "flameless", "live"]),
    },
    lighting: {
      uplighting: text(lighting.uplighting) ?? null,
      pin_spots: bool(lighting.pin_spots),
      string_lights: bool(lighting.string_lights),
      ambient: optionalOneOf(lighting.ambient, AMBIENTS) ?? "evening_warm",
    },
    extras: textList(v.extras, "spec.extras", true),
    effects: effects && { fog: bool(effects.fog), confetti: bool(effects.confetti), sparklers: bool(effects.sparklers) },
    install: install && {
      uses_adhesives: bool(install.uses_adhesives),
      uses_nails: bool(install.uses_nails),
      ceiling_draping: bool(install.ceiling_draping),
    },
    notes: text(v.notes, MAX_NOTES) ?? null,
  };
}

function dimension(v: unknown, path: string): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_ROOM_FT) {
    throw new Error(`${path} must be a number greater than 0 and at most ${MAX_ROOM_FT}`);
  }
  return v;
}

export function sanitizeVenueSpec(v: unknown): VenueSpec {
  if (!isObject(v)) throw new Error("venue must be an object");
  return {
    style: text(v.style) ?? null,
    length_ft: dimension(v.length_ft, "venue.length_ft"),
    width_ft: dimension(v.width_ft, "venue.width_ft"),
    ceiling_ft: dimension(v.ceiling_ft, "venue.ceiling_ft"),
    walls: text(v.walls) ?? null,
    floor: text(v.floor) ?? null,
    windows: text(v.windows) ?? null,
    fixtures: textList(v.fixtures, "venue.fixtures"),
    notes: text(v.notes, MAX_NOTES) ?? null,
  };
}

export function decodeSceneParams(params: URLSearchParams): SceneParams {
  const spec = sanitizeDesignSpec(parseJson("spec", params.get("spec")));
  const venue = sanitizeVenueSpec(params.get("venue") ? parseJson("venue", params.get("venue")) : {});
  const camera = (params.get("camera") ?? "wide") as SceneCamera;
  if (!CAMERAS.includes(camera)) throw new Error(`camera must be one of ${CAMERAS.join(", ")}`);
  return { spec, venue, camera };
}
