import type { DesignSpec, SceneCamera, VenueSpec } from "@vv/scene";

export interface SceneParams {
  spec: DesignSpec;
  venue: VenueSpec;
  camera: SceneCamera;
}

const CAMERAS: readonly SceneCamera[] = ["wide", "top", "corner"];
const SHAPES = ["round", "banquet", "square", "oval", "cocktail", "mixed"];
const HEIGHTS = ["none", "low", "medium", "tall", "mixed"];

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

function parseJson(name: string, raw: string | null): unknown {
  if (!raw) throw new Error(`missing "${name}"`);
  try {
    return JSON.parse(base64UrlDecode(raw));
  } catch {
    throw new Error(`"${name}" is not base64url-encoded JSON`);
  }
}

/** Checks the fields the scene relies on. The backend validates the full schema before it builds the URL. */
function assertDesignSpec(v: unknown): asserts v is DesignSpec {
  if (!isObject(v)) throw new Error("spec must be an object");
  if (v.version !== 1) throw new Error("spec.version must be 1");
  if (typeof v.space !== "string") throw new Error("spec.space must be a string");
  if (!Array.isArray(v.palette) || v.palette.some((c) => typeof c !== "string")) throw new Error("spec.palette must be a string array");
  if (!Array.isArray(v.extras)) throw new Error("spec.extras must be an array");
  const t = v.tables;
  if (!isObject(t) || !Number.isInteger(t.count) || (t.count as number) < 0 || (t.count as number) > 300 || !SHAPES.includes(t.shape as string)) {
    throw new Error("spec.tables needs an integer count (0–300) and a known shape");
  }
  if (!isObject(v.linens) || typeof v.linens.color !== "string") throw new Error("spec.linens.color is required");
  if (!isObject(v.chairs) || typeof v.chairs.style !== "string" || typeof v.chairs.color !== "string") throw new Error("spec.chairs needs style and color");
  if (!isObject(v.centerpieces) || !HEIGHTS.includes(v.centerpieces.height as string)) throw new Error("spec.centerpieces.height is invalid");
  if (!isObject(v.lighting)) throw new Error("spec.lighting must be an object");
}

function assertVenueSpec(v: unknown): asserts v is VenueSpec {
  if (!isObject(v)) throw new Error("venue must be an object");
  for (const key of ["length_ft", "width_ft", "ceiling_ft"] as const) {
    const n = v[key];
    if (n != null && (typeof n !== "number" || !Number.isFinite(n))) throw new Error(`venue.${key} must be a number`);
  }
  if (v.fixtures != null && !Array.isArray(v.fixtures)) throw new Error("venue.fixtures must be an array");
}

export function decodeSceneParams(params: URLSearchParams): SceneParams {
  const spec = parseJson("spec", params.get("spec"));
  assertDesignSpec(spec);
  const venue = params.get("venue") ? parseJson("venue", params.get("venue")) : {};
  assertVenueSpec(venue);
  const camera = (params.get("camera") ?? "wide") as SceneCamera;
  if (!CAMERAS.includes(camera)) throw new Error(`camera must be one of ${CAMERAS.join(", ")}`);
  return { spec, venue, camera };
}
