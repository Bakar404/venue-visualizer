/* eslint-disable */
/**
 * GENERATED FILE. Do not edit by hand.
 * Source: packages/schema/*.schema.json. Regenerate with `pnpm --filter @vv/schema generate`.
 */

// ---- design-spec.schema.json ----
/**
 * Structured description of event decor for one space. Produced by a brain from natural language, editable in the UI, enforced against venue rules by deterministic code.
 */
export interface DesignSpec {
  version: 1;
  /**
   * Space name, e.g. 'ballroom'.
   */
  space: string;
  event_type?: "wedding" | "corporate" | "birthday" | "gala" | "shower" | "other";
  guest_count?: number | null;
  /**
   * @maxItems 8
   */
  palette: string[];
  tables: {
    count: number;
    shape: "round" | "banquet" | "square" | "oval" | "cocktail" | "mixed";
    size_in?: number | null;
    seats?: number | null;
  };
  linens: {
    color: string;
    pattern?: string | null;
    length?: "floor" | "lap" | "none";
    runner?: string | null;
  };
  napkins?: {
    color?: string | null;
    fold?: string | null;
  };
  chairs: {
    /**
     * e.g. chiavari, cross-back, ghost, folding, banquet
     */
    style: string;
    color: string;
    cushion?: string | null;
    sash?: string | null;
  };
  centerpieces: {
    height: "none" | "low" | "medium" | "tall" | "mixed";
    flowers?: string[];
    colors?: string[];
    greenery?: string | null;
    container?: string | null;
    candles?: "none" | "flameless" | "live";
  };
  lighting: {
    /**
     * Color/temperature, e.g. 'warm amber'. null = none.
     */
    uplighting?: string | null;
    pin_spots?: boolean;
    string_lights?: boolean;
    ambient?: "daylight" | "evening_warm" | "dim" | "colored";
  };
  /**
   * Free-form items, e.g. 'sweetheart table', 'flower wall backdrop', 'dance floor'. Items that touch venue rules (fog, confetti, live candles) are normalized by the rules engine.
   */
  extras: string[];
  effects?: {
    fog?: boolean;
    confetti?: boolean;
    sparklers?: boolean;
  };
  /**
   * How decor is attached; checked against venue rules.
   */
  install?: {
    uses_adhesives?: boolean;
    uses_nails?: boolean;
    ceiling_draping?: boolean;
  };
  notes?: string | null;
}

// ---- venue.schema.json ----
/**
 * Entered by the user. Authoritative. A brain may never add or relax rules.
 *
 * This interface was referenced by `VenueSchemas`'s JSON-Schema
 * via the `definition` "VenueRules".
 */
export interface VenueRules {
  /**
   * false = flameless only
   */
  live_candles?: boolean;
  fog?: boolean;
  confetti?: boolean;
  sparklers?: boolean;
  /**
   * false = no tape/adhesives
   */
  adhesives?: boolean;
  nails?: boolean;
  ceiling_draping?: boolean;
  /**
   * e.g. 'ivory linens', 'gold chiavari chairs'. Informational defaults for the brain.
   */
  provided_items?: string[];
  notes?: string | null;
}
/**
 * Describes an empty space. Used for the no-photo path and as context for edits.
 *
 * This interface was referenced by `VenueSchemas`'s JSON-Schema
 * via the `definition` "VenueSpec".
 */
export interface VenueSpec {
  /**
   * e.g. 'rustic barn', 'modern loft', 'classic ballroom'
   */
  style?: string | null;
  length_ft?: number | null;
  width_ft?: number | null;
  ceiling_ft?: number | null;
  walls?: string | null;
  floor?: string | null;
  windows?: string | null;
  /**
   * e.g. 'two crystal chandeliers', 'exposed beams'
   */
  fixtures?: string[];
  notes?: string | null;
}
/**
 * This interface was referenced by `VenueSchemas`'s JSON-Schema
 * via the `definition` "RuleWarning".
 */
export interface RuleWarning {
  rule: string;
  /**
   * JSON pointer into DesignSpec, e.g. /centerpieces/candles
   */
  field: string;
  message: string;
  /**
   * Human description of the automatic fix applied
   */
  fix?: string | null;
}
