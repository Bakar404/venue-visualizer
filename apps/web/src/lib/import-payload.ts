import { stableStringify } from "@/lib/stable-json";
import type { ImportVenueBody, ResearchRule, ResearchSpace, RuleKey, Space, VenueSpec } from "@/lib/types";
import { safeHttpUrl } from "@/lib/url";

/** The VenueSpec the API derives from a researched space (style comes from the match). */
export function venueSpecFromResearch(space: ResearchSpace, style: string | null | undefined): VenueSpec {
  return {
    style: style ?? null,
    length_ft: space.length_ft ?? null,
    width_ft: space.width_ft ?? null,
    ceiling_ft: space.ceiling_ft ?? null,
    walls: space.walls ?? null,
    floor: space.floor ?? null,
    windows: space.windows ?? null,
    fixtures: space.fixtures ?? [],
    notes: space.description ?? null,
  };
}

/** The API rejects more than this many web photos/references per space. */
export const MAX_WEB_PHOTOS_PER_SPACE = 12;

export type ImportDraftSpace = {
  /** The suggested name, verbatim. The API identifies spaces by it. */
  sourceName: string;
  include: boolean;
  /** What the user wants the space called; applied with a PATCH after import. */
  name: string;
  spec: VenueSpec;
  /** The spec the review screen started from, to detect edits. */
  initialSpec: VenueSpec;
  /** "Use as base photo" switches. */
  photos: { url: string; use: boolean }[];
  /**
   * Every photo URL the research suggested for this space, including ones shown under another space. The API
   * counts a selected URL against each space that lists it, so the per-space cap must too.
   */
  suggestedUrls?: string[];
};

export type ImportDraft = {
  researchJobId: string;
  matchIndex: number;
  spaces: ImportDraftSpace[];
  acceptedRules: Iterable<RuleKey>;
  acceptedProvidedItems: Iterable<string>;
  /** The single venue-level "personal planning" confirmation. */
  rightsConfirmed: boolean;
};

/**
 * Rule keys the API can accept: the key's suggestions must reduce to exactly one non-null `allowed`
 * value. Rules without a key, or whose sources disagree, stay as read-only suggestions.
 */
export function acceptableRuleKeys(rules: readonly ResearchRule[]): Set<RuleKey> {
  const values = new Map<RuleKey, Set<boolean>>();
  for (const rule of rules) {
    if (!rule.maps_to || rule.allowed === null || rule.allowed === undefined) continue;
    const seen = values.get(rule.maps_to) ?? new Set<boolean>();
    seen.add(rule.allowed);
    values.set(rule.maps_to, seen);
  }
  return new Set([...values].filter(([, seen]) => seen.size === 1).map(([key]) => key));
}

/** The photos that will be sent for one space: safe, de-duplicated, capped. */
export function selectablePhotos<T extends { url: string }>(photos: readonly T[], taken = new Set<string>()): T[] {
  const out: T[] = [];
  for (const photo of photos) {
    if (out.length >= MAX_WEB_PHOTOS_PER_SPACE) break;
    if (!safeHttpUrl(photo.url) || taken.has(photo.url)) continue;
    taken.add(photo.url);
    out.push(photo);
  }
  return out;
}

/** Builds `POST /api/venues/import` exactly as docs/api.md describes it. */
export function buildImportPayload(draft: ImportDraft): ImportVenueBody {
  const included = draft.spaces.filter((s) => s.include);
  const owners = new Map<string, number[]>();
  included.forEach((s, i) => {
    for (const url of new Set([...(s.suggestedUrls ?? []), ...s.photos.map((p) => p.url)])) {
      owners.set(url, [...(owners.get(url) ?? []), i]);
    }
  });
  const counts = included.map(() => 0);
  const taken = new Set<string>();
  const photos: ImportVenueBody["photos"] = [];
  included.forEach((s) => {
    for (const p of s.photos) {
      if (!safeHttpUrl(p.url) || taken.has(p.url)) continue;
      const spaces = owners.get(p.url) ?? [];
      if (spaces.some((j) => counts[j] >= MAX_WEB_PHOTOS_PER_SPACE)) continue;
      taken.add(p.url);
      for (const j of spaces) counts[j]++;
      const mode = p.use && draft.rightsConfirmed ? ("import" as const) : ("reference" as const);
      photos.push({ url: p.url, mode, rights_confirmed: mode === "import" });
    }
  });
  return {
    research_job_id: draft.researchJobId,
    match_index: draft.matchIndex,
    space_names: [...new Set(included.map((s) => s.sourceName))],
    accepted_rules: [...new Set(draft.acceptedRules)],
    accepted_provided_items: [...new Set(draft.acceptedProvidedItems)],
    photos,
  };
}

export type SpacePatch = { id: string; body: { name?: string; venue_spec?: VenueSpec } };

/** Renames and room-detail edits made during review, applied to the created spaces (matched by suggested name). */
export function spacePatches(spaces: readonly ImportDraftSpace[], created: readonly Pick<Space, "id" | "name">[]): SpacePatch[] {
  const byName = new Map(created.map((s) => [s.name, s.id]));
  const out: SpacePatch[] = [];
  for (const s of spaces) {
    if (!s.include) continue;
    const id = byName.get(s.sourceName);
    if (!id) continue;
    const body: SpacePatch["body"] = {};
    const name = s.name.trim();
    if (name && name !== s.sourceName) body.name = name;
    if (stableStringify(s.spec) !== stableStringify(s.initialSpec)) body.venue_spec = s.spec;
    if (body.name !== undefined || body.venue_spec !== undefined) out.push({ id, body });
  }
  return out;
}
