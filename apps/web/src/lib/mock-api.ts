/**
 * In-memory implementation of the HTTP API for `NEXT_PUBLIC_VV_MOCK=1`.
 * Seeds one venue with two sample photos and two saved Looks; jobs finish about 2 s after they start.
 * Everything lives in browser memory and resets on a full page reload.
 */
import { ApiError } from "@/lib/errors";
import { buildPrompt, mockBrain } from "@/lib/mock-brain";
import { buildTextPdf } from "@/lib/mock-pdf";
import { renderSvg, roomSvg, SCENE_SIZE, svgDataUrl, type ResolvedColors, type RoomVariant } from "@/lib/mock-scene";
import { applyRules, colorFor, defaultRules, defaultSpec, diffSpecs } from "@/lib/spec";
import type {
  Backends,
  ChatMessage,
  DesignSpec,
  Job,
  Look,
  Photo,
  Render,
  Space,
  Venue,
  VenueRules,
  VenueSpec,
  VVApi,
} from "@/lib/types";

type PhotoRow = Photo & { variant: RoomVariant | null; style: string | null; created_at: string };
type SpaceRow = Omit<Space, "photos">;
type VenueRow = Omit<Venue, "spaces">;
type LookRow = Omit<Look, "renders">;
type RenderRow = Render & { attempt: number };
type JobRow = {
  job: Job;
  startedAt: number;
  finalized: boolean;
  renderId?: string;
  spaceId?: string;
  engine: string;
};

type DB = {
  venues: Map<string, VenueRow>;
  spaces: Map<string, SpaceRow>;
  photos: Map<string, PhotoRow>;
  looks: Map<string, LookRow>;
  renders: Map<string, RenderRow>;
  jobs: Map<string, JobRow>;
  chat: Map<string, ChatMessage[]>;
};

const QUEUED_MS = 350;
const DONE_MS = 2000;

const BACKENDS: Backends = {
  brains: [
    { id: "claude", label: "Claude Code", kind: "brain", available: true, logged_in: true, version: "2.4.0", detail: null },
    { id: "codex", label: "Codex", kind: "brain", available: false, logged_in: null, version: null, detail: "`codex` was not found on your PATH." },
    { id: "copilot", label: "Copilot CLI", kind: "brain", available: true, logged_in: true, version: "1.0.115", detail: null },
    { id: "kimi", label: "Kimi Code", kind: "brain", available: true, logged_in: false, version: "0.9.2", detail: "Installed but signed out. Run `kimi login`." },
    { id: "mock", label: "Mock brain", kind: "brain", available: true, logged_in: null, version: null, detail: "Keyword parser for offline use." },
  ],
  engines: [
    {
      id: "copilot", label: "Copilot CLI images", kind: "engine", available: true, logged_in: true, version: "1.0.115", detail: null,
      caps: { can_generate: true, can_edit: true, typical_seconds: 30, cost_note: "Uses Copilot AI credits", photoreal: true },
    },
    {
      id: "codex", label: "Codex $imagegen", kind: "engine", available: false, logged_in: null, version: null,
      detail: "Needs Codex with the image_generation feature enabled and a ChatGPT login.",
      caps: { can_generate: true, can_edit: true, typical_seconds: 40, cost_note: "Uses your ChatGPT plan quota", photoreal: true },
    },
    {
      id: "mflux", label: "mflux (local)", kind: "engine", available: false, logged_in: null, version: null,
      detail: "mflux is not installed. It runs on Apple Silicon: `uv tool install mflux`.",
      caps: { can_generate: true, can_edit: true, typical_seconds: 180, cost_note: "Free, runs on your Mac", photoreal: true },
    },
    {
      id: "scene3d", label: "3D scene", kind: "engine", available: true, logged_in: null, version: null, detail: null,
      caps: { can_generate: true, can_edit: false, typical_seconds: 6, cost_note: "Free, no AI", photoreal: false },
    },
    {
      id: "mock", label: "Mock engine", kind: "engine", available: true, logged_in: null, version: null, detail: "Tints the photo and stamps the prompt.",
      caps: { can_generate: true, can_edit: true, typical_seconds: 2, cost_note: "Free, for testing", photoreal: false },
    },
  ],
  defaults: { brain: "claude", engine: "mock" },
};

let state: DB | null = null;

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => sleep(120 + Math.random() * 220);
const clone = <T,>(v: T): T => structuredClone(v);

function notFound(what: string): never {
  throw new ApiError(404, `${what} not found`);
}

export function resolveColors(spec: DesignSpec): ResolvedColors {
  const flowerNames = spec.centerpieces.colors?.length ? spec.centerpieces.colors : spec.palette;
  return {
    linen: colorFor(spec.linens.color || "ivory"),
    chair: colorFor(spec.chairs.color || "gold"),
    runner: spec.linens.runner ? colorFor(spec.linens.runner) : null,
    flowers: (flowerNames.length ? flowerNames : ["ivory", "blush"]).map(colorFor),
    greenery: colorFor(spec.centerpieces.greenery || "eucalyptus"),
    uplight: spec.lighting.uplighting ? colorFor(spec.lighting.uplighting) : null,
    accent: colorFor(spec.palette[0] ?? "gold"),
  };
}

function seed(): DB {
  const db: DB = {
    venues: new Map(),
    spaces: new Map(),
    photos: new Map(),
    looks: new Map(),
    renders: new Map(),
    jobs: new Map(),
    chat: new Map(),
  };

  db.venues.set("venue-larkspur", {
    id: "venue-larkspur",
    name: "Larkspur House",
    created_at: "2026-11-02T18:00:00Z",
    rules: {
      live_candles: false,
      fog: true,
      confetti: false,
      sparklers: false,
      adhesives: false,
      nails: false,
      ceiling_draping: true,
      provided_items: ["Ivory floor-length linens", "Gold chiavari chairs", "60-inch round tables"],
      notes: "Load-in from 2 pm. Decor must be cleared by midnight.",
    },
  });

  const blush: DesignSpec = {
    ...defaultSpec("Grand Ballroom"),
    guest_count: 140,
    palette: ["blush", "gold", "ivory"],
    tables: { count: 14, shape: "round", size_in: 60, seats: 10 },
    linens: { color: "blush", pattern: null, length: "floor", runner: null },
    centerpieces: {
      height: "tall",
      flowers: ["garden roses", "peonies"],
      colors: ["blush", "ivory"],
      greenery: "eucalyptus",
      container: "gold stand",
      candles: "flameless",
    },
    extras: ["dance floor"],
  };
  const evergreen: DesignSpec = {
    ...blush,
    palette: ["emerald", "ivory", "brass"],
    tables: { count: 8, shape: "banquet", size_in: 96, seats: 16 },
    linens: { color: "ivory", pattern: null, length: "floor", runner: "emerald" },
    chairs: { style: "cross-back", color: "walnut", cushion: "ivory", sash: null },
    centerpieces: {
      height: "low",
      flowers: ["ranunculus"],
      colors: ["ivory", "sage"],
      greenery: "smilax garland",
      container: "brass bud vases",
      candles: "flameless",
    },
    lighting: { uplighting: null, pin_spots: true, string_lights: true, ambient: "dim" },
    extras: [],
  };

  db.spaces.set("space-ballroom", {
    id: "space-ballroom",
    venue_id: "venue-larkspur",
    name: "Grand Ballroom",
    venue_spec: {
      style: "classic ballroom",
      length_ft: 90,
      width_ft: 60,
      ceiling_ft: 24,
      walls: "ivory panelling with gilt trim",
      floor: "oak parquet",
      windows: "three arched windows on the north wall",
      fixtures: ["two crystal chandeliers"],
      notes: null,
    },
    current_spec: blush,
  });
  db.spaces.set("space-terrace", {
    id: "space-terrace",
    venue_id: "venue-larkspur",
    name: "Garden Terrace",
    venue_spec: {
      style: "glass garden pavilion",
      length_ft: 50,
      width_ft: 30,
      ceiling_ft: 16,
      walls: "glass panels with white steel frames",
      floor: "limestone pavers",
      windows: "floor-to-ceiling glass on three sides",
      fixtures: ["one wrought-iron chandelier"],
      notes: null,
    },
    current_spec: null,
  });

  const photos: PhotoRow[] = [
    { id: "photo-north", variant: "north", url: "/samples/ballroom-north.svg" },
    { id: "photo-corner", variant: "corner", url: "/samples/ballroom-corner.svg" },
  ].map((p, i) => ({
    ...p,
    variant: p.variant as RoomVariant,
    space_id: "space-ballroom",
    kind: "upload",
    approved: true,
    style: "classic ballroom",
    created_at: `2026-11-02T18:0${i + 1}:00Z`,
    ...SCENE_SIZE,
  }));
  for (const p of photos) db.photos.set(p.id, p);

  const looks: Array<[LookRow, number[]]> = [
    [{ id: "look-blush", space_id: "space-ballroom", name: "Blush, gold & ivory", spec: blush, parent_look_id: null, created_at: "2026-11-18T20:00:00Z" }, [0.86, 0.48]],
    [{ id: "look-evergreen", space_id: "space-ballroom", name: "Evergreen by candlelight", spec: evergreen, parent_look_id: "look-blush", created_at: "2026-11-19T21:30:00Z" }, [0.83, 0.79]],
  ];
  for (const [look, scores] of looks) {
    db.looks.set(look.id, look);
    photos.forEach((photo, i) => {
      const id = `render-${look.id}-${photo.id}`;
      db.renders.set(id, {
        id,
        look_id: look.id,
        photo_id: photo.id,
        engine: "mock",
        status: "done",
        url: svgDataUrl(renderSvg(photo.variant!, look.spec, resolveColors(look.spec), photo.style)),
        prompt: buildPrompt(look.spec),
        structure_score: scores[i],
        qa: { tables_seen: Math.max(0, look.spec.tables.count - (i === 1 ? 1 : 0)), notes: "Counted from the mock engine output." },
        error: null,
        created_at: look.created_at,
        attempt: 1,
      });
    });
  }

  db.chat.set("space-ballroom", [
    { id: uid(), role: "user", content: "Blush and gold for about 140 guests, tall centerpieces with garden roses and peonies.", created_at: "2026-11-18T19:55:00Z" },
    { id: uid(), role: "assistant", content: "Set 14 round tables of 10 with blush floor-length linens, gold chiavari chairs and tall rose-and-peony arrangements. Candles are flameless because Larkspur House doesn't allow open flames.", created_at: "2026-11-18T19:55:05Z" },
  ]);
  return db;
}

function db(): DB {
  if (!state) state = seed();
  return state;
}

function photosFor(spaceId: string): Photo[] {
  return [...db().photos.values()]
    .filter((p) => p.space_id === spaceId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(({ id, space_id, url, kind, approved, width, height }) => ({ id, space_id, url, kind, approved, width, height }));
}

function spaceOut(row: SpaceRow): Space {
  return clone({ ...row, photos: photosFor(row.id) });
}

function venueOut(row: VenueRow): Venue {
  const spaces = [...db().spaces.values()].filter((s) => s.venue_id === row.id).map(spaceOut);
  return clone({ ...row, spaces });
}

function publicRender(row: RenderRow): Render {
  const out: Render & { attempt?: number } = { ...row };
  delete out.attempt;
  return out;
}

function lookOut(row: LookRow): Look {
  const renders = [...db().renders.values()]
    .filter((r) => r.look_id === row.id)
    .map(publicRender);
  return clone({ ...row, renders });
}

async function tintUpload(url: string, spec: DesignSpec): Promise<string> {
  if (typeof document === "undefined") return url;
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return url;
  ctx.drawImage(img, 0, 0);
  const colors = resolveColors(spec);
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = colors.accent;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  const band = Math.max(28, Math.round(canvas.height * 0.06));
  ctx.fillStyle = "rgba(20,18,15,.55)";
  ctx.fillRect(0, canvas.height - band, canvas.width, band);
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(band * 0.42)}px Georgia, serif`;
  ctx.fillText(`Mock engine: ${buildPrompt(spec)}`.slice(0, 140), band * 0.4, canvas.height - band * 0.35);
  return canvas.toDataURL("image/jpeg", 0.88);
}

async function finalize(row: JobRow) {
  const d = db();
  row.finalized = true;
  if (row.renderId) {
    const render = d.renders.get(row.renderId);
    const look = render && d.looks.get(render.look_id);
    const photo = render && d.photos.get(render.photo_id);
    if (!render || !look || !photo) {
      row.job = { ...row.job, status: "failed", progress: 1, error: "The photo or Look was deleted." };
      return;
    }
    if ((look.spec.notes ?? "").toLowerCase().includes("fail")) {
      render.status = "failed";
      render.error = "Mock engine: simulated failure (the Look's notes mention “fail”).";
      row.job = { ...row.job, status: "failed", progress: 1, error: render.error };
      return;
    }
    render.url = photo.variant
      ? svgDataUrl(renderSvg(photo.variant, look.spec, resolveColors(look.spec), photo.style, `${row.engine} engine (mock)`))
      : await tintUpload(photo.url, look.spec);
    render.status = "done";
    render.engine = row.engine;
    render.structure_score = photo.variant === "corner" && render.attempt === 1 ? 0.48 : 0.78 + ((render.attempt * 7) % 10) / 100;
    render.qa = { tables_seen: look.spec.tables.count, notes: "Counted from the mock engine output." };
    row.job = { ...row.job, status: "done", progress: 1, result: { render_id: render.id } };
  } else if (row.spaceId) {
    const space = d.spaces.get(row.spaceId);
    if (!space) {
      row.job = { ...row.job, status: "failed", progress: 1, error: "The space was deleted." };
      return;
    }
    const photo: PhotoRow = {
      id: uid(),
      space_id: space.id,
      url: svgDataUrl(roomSvg("generated", space.venue_spec.style)),
      kind: "generated_base",
      approved: false,
      variant: "generated",
      style: space.venue_spec.style ?? null,
      created_at: now(),
      ...SCENE_SIZE,
    };
    d.photos.set(photo.id, photo);
    row.job = { ...row.job, status: "done", progress: 1, result: { photo_id: photo.id } };
  }
}

async function tick() {
  const t = Date.now();
  for (const row of db().jobs.values()) {
    if (row.finalized) continue;
    const elapsed = t - row.startedAt;
    if (elapsed >= DONE_MS) {
      await finalize(row);
    } else if (elapsed >= QUEUED_MS) {
      row.job = { ...row.job, status: "running", progress: Math.min(0.99, (elapsed - QUEUED_MS) / (DONE_MS - QUEUED_MS)) };
      const render = row.renderId ? db().renders.get(row.renderId) : undefined;
      if (render) render.status = "running";
    }
  }
}

function newJob(kind: Job["kind"], engine: string, target: { renderId?: string; spaceId?: string }): Job {
  const job: Job = { id: uid(), kind, status: "queued", progress: 0, error: null, result: null };
  db().jobs.set(job.id, { job, startedAt: Date.now(), finalized: false, engine, ...target });
  return clone(job);
}

function requireVenue(id: string) {
  return db().venues.get(id) ?? notFound("Venue");
}
function requireSpace(id: string) {
  return db().spaces.get(id) ?? notFound("Space");
}
function requireLook(id: string) {
  return db().looks.get(id) ?? notFound("Look");
}

function engineAvailable(id: string | undefined) {
  if (!id) return "mock";
  const engine = BACKENDS.engines.find((e) => e.id === id);
  if (!engine) throw new ApiError(400, `Unknown engine “${id}”.`);
  if (!engine.available) throw new ApiError(409, `${engine.label} isn't available: ${engine.detail ?? "not detected"}`);
  return id;
}

export const mockApi: VVApi = {
  async backends() {
    await latency();
    return clone(BACKENDS);
  },
  async listVenues() {
    await latency();
    return [...db().venues.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(venueOut);
  },
  async createVenue({ name, rules }) {
    await latency();
    if (!name.trim()) throw new ApiError(422, "A venue needs a name.");
    const row: VenueRow = { id: uid(), name: name.trim(), rules: { ...defaultRules(), ...rules }, created_at: now() };
    db().venues.set(row.id, row);
    return venueOut(row);
  },
  async getVenue(id) {
    await latency();
    return venueOut(requireVenue(id));
  },
  async updateVenue(id, body) {
    await latency();
    const row = requireVenue(id);
    if (body.name !== undefined) row.name = body.name;
    if (body.rules !== undefined) row.rules = { ...row.rules, ...body.rules };
    return venueOut(row);
  },
  async deleteVenue(id) {
    await latency();
    db().venues.delete(id);
  },
  async createSpace(venueId, { name, venue_spec }) {
    await latency();
    requireVenue(venueId);
    if (!name.trim()) throw new ApiError(422, "A space needs a name.");
    const row: SpaceRow = { id: uid(), venue_id: venueId, name: name.trim(), venue_spec: venue_spec ?? { fixtures: [] }, current_spec: null };
    db().spaces.set(row.id, row);
    return spaceOut(row);
  },
  async getSpace(id) {
    await latency();
    await tick();
    return spaceOut(requireSpace(id));
  },
  async updateSpace(id, body) {
    await sleep(60);
    const row = requireSpace(id);
    if (body.name !== undefined) row.name = body.name;
    if (body.venue_spec !== undefined) row.venue_spec = clone(body.venue_spec as VenueSpec);
    if (body.current_spec !== undefined) row.current_spec = clone(body.current_spec);
    return spaceOut(row);
  },
  async uploadPhotos(spaceId, files) {
    await sleep(500);
    requireSpace(spaceId);
    const existing = photosFor(spaceId).length;
    if (existing + files.length > 30) throw new ApiError(413, "A space can hold at most 30 photos.");
    const out: Photo[] = [];
    for (const file of files) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) {
        throw new ApiError(415, `${file.name} isn't a JPG, PNG, WebP or HEIC image.`);
      }
      if (file.size > 20 * 1024 * 1024) throw new ApiError(413, `${file.name} is larger than 20 MB.`);
      const url = URL.createObjectURL(file);
      let width = 1600;
      let height = 1067;
      try {
        const bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        // HEIC and friends may not decode in the browser; keep the default size.
      }
      const row: PhotoRow = { id: uid(), space_id: spaceId, url, kind: "upload", approved: true, width, height, variant: null, style: null, created_at: now() };
      db().photos.set(row.id, row);
      out.push(photosFor(spaceId).find((p) => p.id === row.id)!);
    }
    return out;
  },
  async deletePhoto(id) {
    await latency();
    db().photos.delete(id);
    for (const [rid, r] of db().renders) if (r.photo_id === id) db().renders.delete(rid);
  },
  async generateBase(spaceId, { engine }) {
    await latency();
    requireSpace(spaceId);
    return newJob("generate_base", engineAvailable(engine), { spaceId });
  },
  async approvePhoto(id) {
    await latency();
    const row = db().photos.get(id) ?? notFound("Photo");
    row.approved = true;
    return photosFor(row.space_id).find((p) => p.id === id)!;
  },
  async chat(spaceId, { message, spec, brain }) {
    await sleep(700 + Math.random() * 500);
    const space = requireSpace(spaceId);
    const venue = requireVenue(space.venue_id);
    const base = spec ?? defaultSpec(space.name);
    const result = mockBrain(message, base, venue.rules);
    const ruled = applyRules(result.spec, venue.rules);
    const reply = ruled.warnings.length
      ? `${result.reply} I adjusted ${ruled.warnings.length === 1 ? "one thing" : `${ruled.warnings.length} things`} to fit ${venue.name}'s rules.`
      : result.reply;
    const history = db().chat.get(spaceId) ?? [];
    history.push({ id: uid(), role: "user", content: message, created_at: now() });
    history.push({ id: uid(), role: "assistant", content: reply, created_at: now() });
    db().chat.set(spaceId, history);
    return { reply, spec: ruled.spec, warnings: ruled.warnings, ambiguities: result.ambiguities, brain: brain ?? "mock" };
  },
  async chatHistory(spaceId) {
    await latency();
    return clone(db().chat.get(spaceId) ?? []);
  },
  async checkSpec({ spec, venue_id }) {
    await sleep(90);
    const venue = requireVenue(venue_id);
    return applyRules(spec, venue.rules as VenueRules);
  },
  async defaultSpec() {
    await latency();
    return defaultSpec();
  },
  async listLooks(spaceId) {
    await latency();
    await tick();
    return [...db().looks.values()]
      .filter((l) => l.space_id === spaceId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(lookOut);
  },
  async createLook(spaceId, { name, spec, parent_look_id }) {
    await latency();
    const space = requireSpace(spaceId);
    const venue = requireVenue(space.venue_id);
    const row: LookRow = {
      id: uid(),
      space_id: spaceId,
      name: name.trim() || "Untitled look",
      spec: applyRules(spec, venue.rules).spec,
      parent_look_id: parent_look_id ?? null,
      created_at: now(),
    };
    db().looks.set(row.id, row);
    return lookOut(row);
  },
  async getLook(id) {
    await sleep(80);
    await tick();
    return lookOut(requireLook(id));
  },
  async deleteLook(id) {
    await latency();
    db().looks.delete(id);
  },
  async renderLook(id, { photo_ids, engine }) {
    await latency();
    const look = requireLook(id);
    const engineId = engineAvailable(engine);
    const targets = photosFor(look.space_id).filter((p) => p.approved && (!photo_ids || photo_ids.includes(p.id)));
    if (targets.length === 0) throw new ApiError(400, "Add or approve a photo before rendering.");
    const jobs: Job[] = [];
    const renders: Render[] = [];
    for (const photo of targets) {
      const render: RenderRow = {
        id: uid(),
        look_id: id,
        photo_id: photo.id,
        engine: engineId,
        status: "queued",
        url: null,
        prompt: buildPrompt(look.spec),
        structure_score: null,
        qa: null,
        error: null,
        created_at: now(),
        attempt: 1,
      };
      db().renders.set(render.id, render);
      jobs.push(newJob("render", engineId, { renderId: render.id }));
      renders.push(clone(publicRender(render)));
    }
    return { jobs, renders };
  },
  async regenerateRender(id, { engine }) {
    await latency();
    const render = db().renders.get(id) ?? notFound("Render");
    const engineId = engineAvailable(engine ?? render.engine);
    render.status = "queued";
    render.url = null;
    render.error = null;
    render.structure_score = null;
    render.attempt += 1;
    return newJob("render", engineId, { renderId: id });
  },
  async getJob(id) {
    await sleep(60);
    await tick();
    const row = db().jobs.get(id) ?? notFound("Job");
    return clone(row.job);
  },
  async listJobs(spaceId) {
    await latency();
    await tick();
    const d = db();
    return [...d.jobs.values()]
      .filter((row) => {
        if (row.spaceId) return row.spaceId === spaceId;
        const render = row.renderId ? d.renders.get(row.renderId) : undefined;
        const look = render ? d.looks.get(render.look_id) : undefined;
        return look?.space_id === spaceId;
      })
      .slice(-100)
      .map((row) => clone(row.job));
  },
  async exportUrl(lookId) {
    await latency();
    const look = lookOut(requireLook(lookId));
    const space = requireSpace(look.space_id);
    const venue = requireVenue(space.venue_id);
    const rows = diffSpecs(look.spec, look.spec).map((r) => `${r.label}: ${r.a}`);
    const lines = [
      `${venue.name}, ${space.name}`,
      `Saved ${new Date(look.created_at).toDateString()}`,
      `${look.renders.filter((r) => r.status === "done").length} renders (images are included in the real export)`,
      "",
      ...rows,
    ];
    return URL.createObjectURL(buildTextPdf(look.name, lines));
  },
};
