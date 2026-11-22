// API types, mirroring docs/api.md. Schema-backed types come from @vv/schema.
import type { DesignSpec, RuleWarning, VenueRules, VenueSpec } from "@vv/schema";

export type { DesignSpec, RuleWarning, VenueRules, VenueSpec };

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type BackendCaps = {
  can_generate: boolean;
  can_edit: boolean;
  typical_seconds: number;
  cost_note: string;
  photoreal: boolean;
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
  engines: BackendStatus[];
  defaults: { brain: string; engine: string };
};

export type Photo = {
  id: string;
  space_id: string;
  url: string;
  kind: "upload" | "generated_base";
  approved: boolean;
  width: number;
  height: number;
};

export type Space = {
  id: string;
  venue_id: string;
  name: string;
  venue_spec: VenueSpec;
  photos: Photo[];
  current_spec: DesignSpec | null;
};

export type Venue = {
  id: string;
  name: string;
  rules: VenueRules;
  created_at: string;
  spaces: Space[];
};

export type Render = {
  id: string;
  look_id: string;
  photo_id: string;
  engine: string;
  status: JobStatus;
  url: string | null;
  prompt: string;
  structure_score: number | null;
  qa: { tables_seen?: number; notes?: string } | null;
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

export type Job = {
  id: string;
  kind: "render" | "generate_base";
  status: JobStatus;
  progress: number;
  error: string | null;
  result: { render_id?: string; photo_id?: string } | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ChatResponse = {
  reply: string;
  spec: DesignSpec;
  warnings: RuleWarning[];
  ambiguities: string[];
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
  generateBase(spaceId: string, body: { engine: string; angle_hint?: string }): Promise<Job>;
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
  listJobs(spaceId: string): Promise<Job[]>;
  /** Returns a URL that opens the Look's PDF export. */
  exportUrl(lookId: string): Promise<string>;
}
