import { z } from "zod";

/** Numeric bounds from packages/schema/design-spec.schema.json; the form must never accept more than the API. */
export const SPEC_LIMITS = {
  guest_count: { min: 1, max: 2000 },
  "tables.count": { min: 0, max: 300 },
  "tables.size_in": { min: 24, max: 120 },
  "tables.seats": { min: 1, max: 24 },
  palette: 8,
  notes: 2000,
} as const;

export type NumericSpecField = "guest_count" | "tables.count" | "tables.size_in" | "tables.seats";

const text = z.string().trim().max(120, "Keep it under 120 characters").nullable().optional();
const required = (what: string) => z.string().trim().min(1, `Add a ${what}`).max(80);
const count = (min: number, max: number) =>
  z.number({ error: "Enter a number" }).int("Use a whole number").min(min, `At least ${min}`).max(max, `At most ${max}`);

export const specFormSchema = z.looseObject({
  version: z.literal(1),
  space: z.string(),
  event_type: z.enum(["wedding", "corporate", "birthday", "gala", "shower", "other"]).optional(),
  guest_count: count(SPEC_LIMITS.guest_count.min, SPEC_LIMITS.guest_count.max).nullable().optional(),
  palette: z.array(z.string()).max(SPEC_LIMITS.palette, `Up to ${SPEC_LIMITS.palette} colors`),
  tables: z.object({
    count: count(SPEC_LIMITS["tables.count"].min, SPEC_LIMITS["tables.count"].max),
    shape: z.enum(["round", "banquet", "square", "oval", "cocktail", "mixed"]),
    size_in: count(SPEC_LIMITS["tables.size_in"].min, SPEC_LIMITS["tables.size_in"].max).nullable().optional(),
    seats: count(SPEC_LIMITS["tables.seats"].min, SPEC_LIMITS["tables.seats"].max).nullable().optional(),
  }),
  linens: z.object({ color: required("linen color"), pattern: text, length: z.enum(["floor", "lap", "none"]).optional(), runner: text }),
  napkins: z.object({ color: text, fold: text }).optional(),
  chairs: z.object({ style: required("chair style"), color: required("chair color"), cushion: text, sash: text }),
  centerpieces: z.object({
    height: z.enum(["none", "low", "medium", "tall", "mixed"]),
    flowers: z.array(z.string()).optional(),
    colors: z.array(z.string()).optional(),
    greenery: text,
    container: text,
    candles: z.enum(["none", "flameless", "live"]).optional(),
  }),
  lighting: z.object({
    uplighting: text,
    pin_spots: z.boolean().optional(),
    string_lights: z.boolean().optional(),
    ambient: z.enum(["daylight", "evening_warm", "dim", "colored"]).optional(),
  }),
  extras: z.array(z.string()),
  effects: z.object({ fog: z.boolean().optional(), confetti: z.boolean().optional(), sparklers: z.boolean().optional() }).optional(),
  install: z
    .object({ uses_adhesives: z.boolean().optional(), uses_nails: z.boolean().optional(), ceiling_draping: z.boolean().optional() })
    .optional(),
  scene: z
    .object({
      time_of_day: z.enum(["daylight", "golden_hour", "evening", "night"]).optional(),
      windows: z.enum(["as_photographed", "dark", "sheer_draped"]).optional(),
    })
    .optional(),
  notes: z.string().max(SPEC_LIMITS.notes, `Keep notes under ${SPEC_LIMITS.notes} characters`).nullable().optional(),
});
