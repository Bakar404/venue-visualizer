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
  /**
   * Time of day and what the windows show. Maps phrases like '7pm', 'dark outside', 'golden hour'.
   */
  scene?: {
    time_of_day?: "daylight" | "golden_hour" | "evening" | "night";
    windows?: "as_photographed" | "dark" | "sheer_draped";
  };
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

// ---- venue-research.schema.json ----
/**
 * What the venue-finder agent found on the public web about a real venue. Everything here is a suggestion with a source; the user confirms before it becomes a Venue/Space. Rules found online are NOT authoritative until the user accepts them.
 */
export interface VenueResearch {
  query: string;
  /**
   * @maxItems 5
   */
  matches: {
    name: string;
    address?: string | null;
    website?: string | null;
    confidence: number;
    summary?: string | null;
    style?: string | null;
    spaces?: {
      name: string;
      description?: string | null;
      capacity_seated?: number | null;
      capacity_standing?: number | null;
      length_ft?: number | null;
      width_ft?: number | null;
      ceiling_ft?: number | null;
      walls?: string | null;
      floor?: string | null;
      windows?: string | null;
      fixtures?: string[];
      /**
       * @maxItems 12
       */
      photos?: {
        url: string;
        source_page: string;
        caption?: string | null;
        credit?: string | null;
      }[];
      source?: string | null;
    }[];
    /**
     * Policies the agent saw published (e.g. 'flameless candles only'). Suggestions only.
     */
    rules_found?: {
      text: string;
      maps_to?:
        | "live_candles"
        | "fog"
        | "confetti"
        | "sparklers"
        | "adhesives"
        | "nails"
        | "ceiling_draping"
        | null;
      allowed?: boolean | null;
      source: string;
    }[];
    provided_items?: string[];
    /**
     * @minItems 1
     */
    sources: string[];
  }[];
  notes?: string | null;
}
