// API types, mirroring docs/api.md. Schema-backed types come from @vv/schema.
import type { DesignSpec, RuleWarning, VenueResearch, VenueRules, VenueSpec } from "@vv/schema";

export type { DesignSpec, RuleWarning, VenueResearch, VenueRules, VenueSpec };

export type ResearchMatch = VenueResearch["matches"][number];
export type ResearchSpace = NonNullable<ResearchMatch["spaces"]>[number];
export type ResearchPhoto = NonNullable<ResearchSpace["photos"]>[number];
export type ResearchRule = NonNullable<ResearchMatch["rules_found"]>[number];
export type RuleKey = NonNullable<ResearchRule["maps_to"]>;

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type BackendCaps = {
  can_generate?: boolean;
  can_edit?: boolean;
  typical_seconds?: number;
  cost_note?: string;
  photoreal?: boolean;
  /** Brains: can search and fetch the public web (needed by the venue finder). */
  web?: boolean;
  /** Brains: accepts image input (needed for video tours and render QA). */
  vision?: boolean;
};

export type BackendStatus = {
  id: string;
  label: string;
  kind: "brain" | "engine";
  available: boolean;
  logged_in: boolean | null;
  version: string | null;
  detail: string | null;
  caps?: BackendCaps;
};

export type Backends = {
  brains: BackendStatus[];
  /** User-facing photoreal engines, plus "mock" in dev. Internal helpers are never listed here. */
  engines: BackendStatus[];
  /** `engine` is null when no public image engine is available (see docs/api.md). */
  defaults: { brain: string; engine: string | null };
  thresholds?: { structure_ok: number };
  /** Internal helpers the pipeline uses on its own; never offered as an output choice. */
  internal?: {
    layout_guide?: { available: boolean; detail?: string | null };
  };
};

export type Photo = {
  id: string;
  space_id: string;
  url: string;
  kind: "upload" | "generated_base" | "video_frame" | "web";
  approved: boolean;
  width: number;
  height: number;
  /** Web photos: the page the image was found on. */
  source_url?: string | null;
  /** Web photos: photographer or site credit, printed on exports. */
  credit?: string | null;
};

/** A web photo kept as a reference only (nothing downloaded). See docs/api.md, "Reference photos → base photo". */
export type SpaceReference = {
  url: string;
  source_page?: string | null;
  caption?: string | null;
  credit?: string | null;
};

export type Space = {
  id: string;
  venue_id: string;
  name: string;
  venue_spec: VenueSpec;
  photos: Photo[];
  current_spec: DesignSpec | null;
  /** Web photos imported in reference mode; older APIs omit this. */
  references?: SpaceReference[];
};

export type Venue = {
  id: string;
  name: string;
  rules: VenueRules;
  created_at: string;
  spaces: Space[];
};

export type VenueImportResult = Venue & { skipped_photos: { url: string; reason: string }[] };

export type StructureReport = {
  score: number;
  method: string;
  aligned: boolean;
  inliers: number;
  scale: number | null;
  rotation: number | null;
  coverage: number | null;
  edge_density?: number | null;
  flat?: boolean | null;
  /** Why the check failed or couldn't run, in the pipeline's words (e.g. "the render lost the room's structure"). */
  reason?: string | null;
};

/** Plain-language verdict for the structure badge. `unverifiable`: we couldn't check; `changed`: the room likely differs. */
export type StructureMessage = { level: "unverifiable" | "changed" | (string & {}); text: string };

export type Render = {
  id: string;
  look_id: string;
  photo_id: string;
  engine: string;
  status: JobStatus;
  url: string | null;
  prompt: string;
  structure_score: number | null;
  qa: {
    tables_seen?: number | null;
    notes?: string | null;
    structure?: StructureReport | null;
    structure_warning?: string | null;
    structure_message?: StructureMessage | string | null;
  } | null;
  error: string | null;
  created_at: string;
};

export type Look = {
  id: string;
  space_id: string;
  name: string;
  spec: DesignSpec;
  parent_look_id: string | null;
  created_at: string;
  renders: Render[];
};

export type FrameView = "wide" | "corner" | "detail";

export type VideoFrame = {
  photo_id: string;
  url: string;
  /** Seconds into the video. */
  t?: number;
  space_guess: string;
  view: FrameView;
  description: string;
  fixtures?: string[];
  /** The vision pass thinks this frame works as a base photo. */
  usable: boolean;
  /** 0..1, from Laplacian variance. */
  sharpness: number;
};

export type SuggestedSpace = { name: string; venue_spec: VenueSpec; photo_ids: string[] };

export type JobKind = "render" | "generate_base" | "venue_research" | "video_ingest";

export type Job = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  error: string | null;
  /** Short human status from the worker, e.g. "Collecting photos of each space". */
  message?: string | null;
  created_at?: string;
  result: {
    render_id?: string;
    photo_id?: string;
    research?: VenueResearch;
    frames?: VideoFrame[];
    spaces_suggested?: SuggestedSpace[];
    duration_s?: number;
  } | null;
};

export type PhotoMode = "import" | "reference";

/** `POST /api/venues/import`, exactly as docs/api.md describes it. */
export type ImportVenueBody = {
  research_job_id: string;
  match_index: number;
  /** Suggested space names, verbatim and unique. Renames happen afterwards with `PATCH /api/spaces/{id}`. */
  space_names: string[];
  /** Rule keys whose suggested value is unambiguous. */
  accepted_rules: RuleKey[];
  /** Must match suggested provided items verbatim. */
  accepted_provided_items: string[];
  photos: { url: string; mode: PhotoMode; rights_confirmed: boolean }[];
};

export type ApplyVideoBody = {
  job_id: string;
  spaces: { name: string; photo_ids: string[]; venue_spec?: VenueSpec }[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

/** "render" means the user asked to see the plan, so the UI offers Render now. */
export type ChatIntent = "edit" | "render" | "question" | "none";

/** A clarifying question. Quick-reply chips send an option, never the question. */
export type Ambiguity = { question: string; options: string[] };

export type ChatResponse = {
  reply: string;
  spec: DesignSpec;
  warnings: RuleWarning[];
  /** The pipeline's venue-rule adjustment notes; may be empty even when `warnings` is not. */
  rule_notes: string[];
  intent: ChatIntent;
  /** Server-computed: the returned spec differs from the one sent. */
  spec_changed: boolean;
  /** Short human name for the current plan, e.g. "Moody night, blue uplighting". */
  look_name: string | null;
  ambiguities: Ambiguity[];
  brain: string;
};

export type SpecCheckResponse = { spec: DesignSpec; warnings: RuleWarning[] };

export type RenderResponse = { jobs: Job[]; renders: Render[] };

export interface VVApi {
  backends(): Promise<Backends>;
  listVenues(): Promise<Venue[]>;
  createVenue(body: { name: string; rules?: VenueRules }): Promise<Venue>;
  getVenue(id: string): Promise<Venue>;
  updateVenue(id: string, body: { name?: string; rules?: VenueRules }): Promise<Venue>;
  deleteVenue(id: string): Promise<void>;
  createSpace(venueId: string, body: { name: string; venue_spec?: VenueSpec }): Promise<Space>;
  getSpace(id: string): Promise<Space>;
  updateSpace(
    id: string,
    body: { name?: string; venue_spec?: VenueSpec; current_spec?: DesignSpec | null },
  ): Promise<Space>;
  uploadPhotos(spaceId: string, files: File[]): Promise<Photo[]>;
  deletePhoto(id: string): Promise<void>;
  /** With `reference_url`, the engine draws an empty base view of the room in that reference photo. */
  generateBase(spaceId: string, body: { engine: string; angle_hint?: string; reference_url?: string }): Promise<Job>;
  /** Downloads one of the space's reference photos and keeps it as an approved base photo (with its credit). */
  importReference(spaceId: string, body: { url: string; rights_confirmed: true }): Promise<Photo>;
  approvePhoto(id: string): Promise<Photo>;
  chat(
    spaceId: string,
    body: { message: string; spec: DesignSpec | null; brain?: string },
  ): Promise<ChatResponse>;
  chatHistory(spaceId: string): Promise<ChatMessage[]>;
  checkSpec(body: { spec: DesignSpec; venue_id: string }): Promise<SpecCheckResponse>;
  defaultSpec(): Promise<DesignSpec>;
  listLooks(spaceId: string): Promise<Look[]>;
  createLook(
    spaceId: string,
    body: { name: string; spec: DesignSpec; parent_look_id?: string | null },
  ): Promise<Look>;
  getLook(id: string): Promise<Look>;
  deleteLook(id: string): Promise<void>;
  renderLook(
    id: string,
    body: { photo_ids?: string[]; engine?: string; brain_qa?: boolean },
  ): Promise<RenderResponse>;
  regenerateRender(id: string, body: { engine?: string }): Promise<Job>;
  getJob(id: string): Promise<Job>;
  /** Queued jobs cancel immediately; running ones stop when the worker notices. */
  cancelJob(id: string): Promise<Job>;
  /** Starts the venue finder: a web-capable brain researches the venue. Job kind "venue_research". */
  research(body: { query: string; brain?: string }): Promise<Job>;
  /** Turns a reviewed research match into a Venue with spaces, accepted rules and photos. */
  importVenue(body: ImportVenueBody): Promise<VenueImportResult>;
  /** Uploads a video tour and starts frame extraction. Job kind "video_ingest". */
  uploadVideo(
    venueId: string,
    file: File,
    opts?: { brain?: string | null; onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<Job>;
  /** Keeps the reviewed frames as photos, grouped into (new or renamed) spaces. */
  applyVideo(venueId: string, body: ApplyVideoBody): Promise<Venue>;
  listJobs(spaceId: string): Promise<Job[]>;
  /** Returns a URL that opens the Look's PDF export. */
  exportUrl(lookId: string): Promise<string>;
}
