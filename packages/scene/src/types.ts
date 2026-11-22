/** Mirrors the JSON schemas in packages/schema; no generated schema package exists yet. */
export interface DesignSpec {
  version: 1;
  space: string;
  event_type?: "wedding" | "corporate" | "birthday" | "gala" | "shower" | "other";
  guest_count?: number | null;
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
  napkins?: { color?: string | null; fold?: string | null };
  chairs: { style: string; color: string; cushion?: string | null; sash?: string | null };
  centerpieces: {
    height: "none" | "low" | "medium" | "tall" | "mixed";
    flowers?: string[];
    colors?: string[];
    greenery?: string | null;
    container?: string | null;
    candles?: "none" | "flameless" | "live";
  };
  lighting: {
    uplighting?: string | null;
    pin_spots?: boolean;
    string_lights?: boolean;
    ambient?: "daylight" | "evening_warm" | "dim" | "colored";
  };
  extras: string[];
  effects?: { fog?: boolean; confetti?: boolean; sparklers?: boolean };
  install?: { uses_adhesives?: boolean; uses_nails?: boolean; ceiling_draping?: boolean };
  notes?: string | null;
}

export interface VenueSpec {
  style?: string | null;
  length_ft?: number | null;
  width_ft?: number | null;
  ceiling_ft?: number | null;
  walls?: string | null;
  floor?: string | null;
  windows?: string | null;
  fixtures?: string[];
  notes?: string | null;
}

export interface ChairPlacement {
  x: number;
  z: number;
  rotY: number;
}

export interface RoundPlacement {
  x: number;
  z: number;
  shape: "round" | "cocktail";
  diameterFt: number;
  chairs: ChairPlacement[];
}

export interface RectangularPlacement {
  x: number;
  z: number;
  shape: "banquet" | "square" | "oval";
  lengthFt: number;
  widthFt: number;
  chairs: ChairPlacement[];
}

export type TablePlacement = RoundPlacement | RectangularPlacement;
export interface FloorPlacement {
  x: number;
  z: number;
  lengthFt: number;
  widthFt: number;
}

export interface Layout {
  tables: TablePlacement[];
  danceFloor: FloorPlacement | null;
  headTable: RectangularPlacement | null;
  room: { lengthFt: number; widthFt: number; ceilingFt: number };
  warnings: string[];
}

export type SceneMode = "orbit" | "walk" | "still";
export type SceneCamera = "wide" | "top" | "corner";

export interface VenueSceneProps {
  spec: DesignSpec;
  venueSpec?: VenueSpec;
  mode?: SceneMode;
  camera?: SceneCamera;
  onReady?: () => void;
}
