// API types, mirroring docs/api.md. Schema-backed types come from @vv/schema; response shapes come from (or are
// checked against, at the bottom of this file) the OpenAPI document in @vv/schema/openapi.
import type { DesignSpec, RuleWarning, VenueResearch, VenueRules, VenueSpec } from "@vv/schema";
import type { components } from "@vv/schema/openapi";

export type { DesignSpec, RuleWarning, VenueResearch, VenueRules, VenueSpec };

export type ResearchMatch = VenueResearch["matches"][number];
export type ResearchSpace = NonNullable<ResearchMatch["spaces"]>[number];
export type ResearchPhoto = NonNullable<ResearchSpace["photos"]>[number];
export type ResearchRule = NonNullable<ResearchMatch["rules_found"]>[number];
export type RuleKey = NonNullable<ResearchRule["maps_to"]>;

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** Response schemas from the API's OpenAPI document (packages/schema/openapi.json, checked by a pytest). */
type Schemas = components["schemas"];

export type BackendCaps = Schemas["BackendCaps"];

// First-run setup additions from docs/onboarding-and-mobile.md, section 3. Written from the spec because the backend is
// being built in parallel. TODO(openapi): switch these to `Schemas[...]` once packages/schema/openapi.json has them.

export type UsedFor = "chat" | "web_research" | "vision" | "images";
export type InstallCommands = { macos: string; linux: string; docs_url: string };
export type BackendTest = { ok: boolean; at: string; seconds: number; detail: string };
/** Optional here so older APIs (without these fields) still type-check against the OpenAPI document. */
export type BackendSetupInfo = {
  install?: InstallCommands;
  /** The sign-in command, or null when there's nothing to sign in to. */
  login?: string | null;
  used_for?: UsedFor[];
  cost_note?: string;
  last_test?: BackendTest | null;
};
export type BackendStatus = Schemas["BackendStatus"] & BackendSetupInfo;
/**
 * `engines`: user-facing photoreal engines, plus "mock" in dev. `internal`: helpers the pipeline uses on its own,
 * never offered as an output choice. `defaults.engine` is null when no public image engine is available.
 */
export type Backends = Omit<Schemas["BackendsOut"], "brains" | "engines" | "internal"> & {
  brains: BackendStatus[];
  engines: BackendStatus[];
  internal: Record<string, BackendStatus>;
};

export type Settings = {
  default_brain: string | null;
  default_engine: string | null;
  allow_web_research: boolean;
  setup_completed_at: string | null;
  providers: {
    claude?: { config_dir?: string | null };
    copilot?: { model?: string | null };
    kimi?: { bin?: string | null };
  };
  /** Read-only: phone access is turned on by starting the app with `make dev-lan`. */
  lan: { enabled: boolean };
};
/** `lan` is read-only, so it isn't part of the body; the API answers 400 if it's sent. */
export type SettingsPatch = Partial<Omit<Settings, "providers" | "lan">> & {
  providers?: Settings["providers"];
};

export type BackendTestResult = { ok: boolean; seconds: number; detail: string; sample_url?: string | null };
export type SetupMissing = "brain" | "engine" | "defaults";
/** The spec leaves `steps` open, so it's read loosely. */
export type SetupStatus = { complete: boolean; missing: SetupMissing[]; steps: Record<string, unknown> };
/**
 * `pairing_code` isn't in the spec's table; the setup page needs it to show the code on the computer. Assumed name,
 * to confirm with the backend. Each fetch issues a fresh one-time code that expires after 10 minutes (and replaces
 * the previous code). TODO(openapi): type these from packages/schema/openapi.json once the backend lands.
 */
export type LanInfo = {
  enabled: boolean;
  url: string | null;
  qr_svg: string | null;
  pairing_required: true;
  pairing_code?: string | null;
};
/** How long a pairing code works after `GET /api/system/lan` issues it. */
export const PAIRING_CODE_MINUTES = 10;
/** A phone paired with this computer (`GET /api/system/lan/devices`). TODO(openapi): type from the schema once it lands. */
export type LanDevice = { id: string; label: string; paired_at: string; last_seen: string };

/** Web photos carry `source_url` (the image), `source_page` (where it was found) and `credit` (printed on exports). */
export type Photo = Schemas["PhotoOut"];

/** A web photo kept as a reference only (nothing downloaded). See docs/api.md, "Reference photos → base photo". */
export type SpaceReference = Schemas["PhotoReference"];

export type Space = {
  id: string;
  venue_id: string;
  name: string;
  venue_spec: VenueSpec;
  photos: Photo[];
  current_spec: DesignSpec | null;
  capacity_seated: number | null;
  capacity_standing: number | null;
  source: string | null;
  /** Web photos imported in reference mode. */
  references: SpaceReference[];
};

export type Venue = {
  id: string;
  name: string;
  rules: VenueRules;
  created_at: string;
  spaces: Space[];
};

export type VenueImportResult = Venue & { skipped_photos: { url: string; reason: string }[] };

export type StructureReport = Schemas["StructureReport"];

/** Plain-language verdict for the structure badge: `ok`, `unverified` (we couldn't check) or `changed` (the room likely differs). */
export type StructureMessage = Schemas["StructureMessage"];

export type RenderQA = Schemas["RenderQA"];

export type Render = {
  id: string;
  look_id: string;
  photo_id: string;
  engine: string;
  status: JobStatus;
  url: string | null;
  prompt: string;
  structure_score: number | null;
  qa: RenderQA | null;
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
  warnings: RuleWarning[];
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
  cancel_requested: boolean;
  error: string | null;
  error_status: number | null;
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
  /** Re-detects the CLIs now (Check again). */
  refreshBackends(): Promise<Backends>;
  /**
   * A tiny real call. Image tests need `confirm_credits: true` (except mock and mflux), else 422. May answer 429 with
   * `Retry-After` (seconds), surfaced as `ApiError.retryAfter`.
   */
  testBackend(kind: "brain" | "engine", id: string, body: { confirm_credits?: boolean }): Promise<BackendTestResult>;
  getSettings(): Promise<Settings>;
  updateSettings(body: SettingsPatch): Promise<Settings>;
  setupStatus(): Promise<SetupStatus>;
  lanInfo(): Promise<LanInfo>;
  /** A phone on the LAN pairs with the 6-digit code shown on the computer; the API sets a device cookie. */
  pairDevice(code: string): Promise<void>;
  /** Phones paired with this computer, newest first. */
  lanDevices(): Promise<LanDevice[]>;
  /** Unpairs one phone; it needs a new code to connect again. 404 if it's unknown. */
  forgetLanDevice(id: string): Promise<void>;
  forgetAllLanDevices(): Promise<void>;
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

// Compile-time contract: every response the API can send (per its OpenAPI schema) must fit the web's type. Plans,
// venue specs and rules are typed from their own JSON Schemas (@vv/schema), so those fields are swapped in.
type Check<T extends true> = T;
type Accepts<Web, Api> = [Api] extends [Web] ? true : false;
type With<T, U> = Omit<T, keyof U> & U;
type ApiSpace = With<Schemas["SpaceOut"], { current_spec: DesignSpec | null; venue_spec: VenueSpec }>;
type ApiVenue = With<Schemas["VenueOut"], { rules: VenueRules; spaces: ApiSpace[] }>;
export type ApiContract = [
  Check<Accepts<Backends, Schemas["BackendsOut"]>>,
  Check<Accepts<Look, With<Schemas["LookOut"], { spec: DesignSpec }>>>,
  Check<Accepts<Space, ApiSpace>>,
  Check<Accepts<Venue, ApiVenue>>,
  Check<Accepts<VenueImportResult, With<Schemas["ImportOut"], { rules: VenueRules; spaces: ApiSpace[] }>>>,
  Check<Accepts<ChatResponse, With<Schemas["ChatOut"], { spec: DesignSpec }>>>,
  Check<Accepts<ChatMessage, Schemas["ChatMessageOut"]>>,
  Check<Accepts<Omit<Job, "result">, Omit<Schemas["JobOut"], "result">>>,
  Check<Accepts<SpecCheckResponse, With<Schemas["SpecCheckResult"], { spec: DesignSpec }>>>,
  Check<Accepts<StructureMessage["level"], "ok" | "unverified" | "changed">>,
];
