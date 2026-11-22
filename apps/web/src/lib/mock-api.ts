/**
 * In-memory implementation of the HTTP API for `NEXT_PUBLIC_VV_MOCK=1`.
 * Seeds two venues with the photoreal demo images in `public/samples/photoreal/`; a render returns the
 * matching decorated photo for the photo and the Look. Renders finish about 2 s after they start; venue
 * research and video tours take about 3 s. Everything lives in browser memory and resets on reload.
 */
import { canBrowse } from "@/lib/backends";
import { ApiError } from "@/lib/errors";
import { venueSpecFromResearch } from "@/lib/import-payload";
import { buildPrompt, mockBrain } from "@/lib/mock-brain";
import { buildTextPdf } from "@/lib/mock-pdf";
import * as system from "@/lib/mock-system";
import { SAMPLE_SIZE, SAMPLES, type SampleLook, type SampleScene } from "@/lib/samples";
import { withoutNulls } from "@/lib/stable-json";
import { applyRules, colorFor, defaultRules, defaultSpec, diffSpecs, specEquals } from "@/lib/spec";
import type {
  ChatMessage,
  DesignSpec,
  Job,
  Look,
  Photo,
  Render,
  Space,
  SuggestedSpace,
  Venue,
  VenueResearch,
  VenueRules,
  VenueSpec,
  VideoFrame,
  VVApi,
} from "@/lib/types";

type PhotoRow = Omit<Photo, "source_url" | "source_page" | "credit"> &
  Partial<Pick<Photo, "source_url" | "source_page" | "credit">> & { sample: SampleScene | null; created_at: string };
type SpaceRow = Omit<Space, "photos" | "references" | "source" | "capacity_seated" | "capacity_standing"> &
  Partial<Pick<Space, "references" | "source" | "capacity_seated" | "capacity_standing">>;
type VenueRow = Omit<Venue, "spaces">;
type LookRow = Omit<Look, "renders" | "warnings">;
type RenderRow = Render & { attempt: number };
type JobRow = {
  job: Job;
  startedAt: number;
  durationMs: number;
  finalized: boolean;
  renderId?: string;
  spaceId?: string;
  /** generate_base from a reference photo: draw the empty room shown in it. */
  referenceUrl?: string;
  engine: string;
  /** Status lines shown while running, spread evenly over the duration. */
  messages?: string[];
  complete?: (row: JobRow) => Promise<void>;
};
type VideoIngest = { venueId: string; frames: VideoFrame[]; applied: boolean };

type DB = {
  venues: Map<string, VenueRow>;
  spaces: Map<string, SpaceRow>;
  photos: Map<string, PhotoRow>;
  looks: Map<string, LookRow>;
  renders: Map<string, RenderRow>;
  jobs: Map<string, JobRow>;
  chat: Map<string, ChatMessage[]>;
  research: Map<string, VenueResearch>;
  videos: Map<string, VideoIngest>;
};

const QUEUED_MS = 350;
const DONE_MS = 2000;
const AGENT_MS = 3200;

let state: DB | null = null;

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => sleep(120 + Math.random() * 220);
const clone = <T,>(v: T): T => structuredClone(v);

function notFound(what: string): never {
  throw new ApiError(404, `${what} not found`);
}

const GREEN = /green|sage|emerald|evergreen|olive|forest|moss|eucalyptus/i;

/** Which demo Look best matches a plan. Only the ballroom has two Looks to choose between. */
function sampleLookFor(spec: DesignSpec): "blush" | "evergreen" {
  const text = [...spec.palette, spec.linens.color, spec.linens.runner ?? ""].join(" ");
  return GREEN.test(text) ? "evergreen" : "blush";
}

/** The decorated demo photo for a base photo and plan, plus an honest note when it isn't an exact match. */
function sampleRender(scene: SampleScene, spec: DesignSpec): { url: string; note: string | null } {
  const looks = SAMPLES[scene].looks;
  const wanted: SampleLook = scene === "barn" ? "string-lights" : scene === "terrace" ? "cocktail" : sampleLookFor(spec);
  const exact = looks[wanted];
  if (exact) return { url: exact.url, note: null };
  const [fallbackKey, fallback] = Object.entries(looks)[0] as [SampleLook, { url: string }];
  return {
    url: fallback.url,
    note: `Mock engine: there's no ${wanted} demo photo for this angle, so this shows the ${fallbackKey} one.`,
  };
}

function sceneForStyle(style: string | null | undefined): SampleScene {
  const s = (style ?? "").toLowerCase();
  if (/barn|rustic|farm|loft|warehouse/.test(s)) return "barn";
  if (/terrace|garden|outdoor|patio|courtyard|lawn|rooftop/.test(s)) return "terrace";
  return "ballroom-a";
}

function accentFor(spec: DesignSpec): string {
  return colorFor(spec.palette[0] ?? spec.linens.color ?? "gold");
}

const BALLROOM_SPEC: VenueSpec = {
  style: "classic ballroom",
  length_ft: 90,
  width_ft: 60,
  ceiling_ft: 24,
  walls: "cream panelled walls with moulding",
  floor: "dark hardwood",
  windows: "tall arched windows along one wall",
  fixtures: ["crystal chandeliers"],
  notes: null,
};

const TERRACE_SPEC: VenueSpec = {
  style: "stone garden terrace",
  length_ft: 60,
  width_ft: 35,
  ceiling_ft: null,
  walls: "open air, stone balustrade with clipped hedges",
  floor: "bluestone pavers",
  windows: null,
  fixtures: ["stone balustrade", "lawn beyond"],
  notes: "Outdoors; best at dusk.",
};

const BARN_SPEC: VenueSpec = {
  style: "rustic barn",
  length_ft: 80,
  width_ft: 40,
  ceiling_ft: 28,
  walls: "whitewashed plank walls",
  floor: "polished concrete",
  windows: "large sliding barn doors opening onto a field",
  fixtures: ["exposed timber beams and trusses"],
  notes: null,
};

function seed(): DB {
  const db: DB = {
    venues: new Map(),
    spaces: new Map(),
    photos: new Map(),
    looks: new Map(),
    renders: new Map(),
    jobs: new Map(),
    chat: new Map(),
    research: new Map(),
    videos: new Map(),
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
  db.venues.set("venue-hollow-creek", {
    id: "venue-hollow-creek",
    name: "Hollow Creek Barn",
    created_at: "2026-10-21T16:00:00Z",
    rules: {
      ...defaultRules(),
      live_candles: false,
      sparklers: true,
      provided_items: ["Farm tables", "Cross-back chairs"],
      notes: "Candles must be in glass hurricanes or flameless.",
    },
  });

  // Imported from the web in reference mode: the room has reference photos but no base photo yet (UT6).
  db.venues.set("venue-wren-hall", {
    id: "venue-wren-hall",
    name: "Wren Hall",
    created_at: "2026-10-12T15:00:00Z",
    rules: { ...defaultRules(), provided_items: ["Round tables", "White folding chairs"] },
  });

  const blush: DesignSpec = {
    ...defaultSpec("Grand Ballroom"),
    guest_count: 140,
    palette: ["blush", "ivory", "gold"],
    tables: { count: 14, shape: "round", size_in: 60, seats: 10 },
    linens: { color: "ivory", pattern: null, length: "floor", runner: null },
    chairs: { style: "chiavari", color: "gold", cushion: "ivory", sash: null },
    centerpieces: {
      height: "low",
      flowers: ["garden roses", "spray roses"],
      colors: ["blush", "ivory"],
      greenery: null,
      container: "gold compote",
      candles: "flameless",
    },
    lighting: { uplighting: "warm amber", pin_spots: false, string_lights: false, ambient: "evening_warm" },
    extras: ["dance floor"],
  };
  const evergreen: DesignSpec = {
    ...blush,
    guest_count: 80,
    palette: ["sage", "ivory", "gold"],
    tables: { count: 8, shape: "round", size_in: 60, seats: 10 },
    linens: { color: "sage green", pattern: null, length: "floor", runner: null },
    chairs: { style: "chiavari", color: "gold", cushion: "ivory", sash: null },
    centerpieces: {
      height: "tall",
      flowers: ["white garden roses", "peonies"],
      colors: ["white", "ivory"],
      greenery: "trailing eucalyptus",
      container: "gold stand",
      candles: "flameless",
    },
    lighting: { uplighting: "warm white", pin_spots: false, string_lights: false, ambient: "evening_warm" },
    extras: [],
  };
  const cocktail: DesignSpec = {
    ...defaultSpec("Garden Terrace"),
    event_type: "wedding",
    guest_count: 90,
    palette: ["blush", "ivory", "warm white"],
    tables: { count: 10, shape: "cocktail", size_in: 30, seats: null },
    linens: { color: "white", pattern: "spandex", length: "floor", runner: null },
    chairs: { style: "lounge sofa", color: "ivory", cushion: null, sash: null },
    centerpieces: { height: "low", flowers: ["blush roses"], colors: ["blush"], greenery: null, container: "bud vases", candles: "flameless" },
    lighting: { uplighting: null, pin_spots: false, string_lights: true, ambient: "evening_warm" },
    extras: ["lounge vignette", "lanterns"],
  };
  const stringLights: DesignSpec = {
    ...defaultSpec("Hayloft"),
    guest_count: 110,
    palette: ["natural wood", "white", "wildflower"],
    tables: { count: 6, shape: "banquet", size_in: 96, seats: 18 },
    linens: { color: "natural wood", pattern: null, length: "none", runner: "linen" },
    chairs: { style: "cross-back", color: "walnut", cushion: null, sash: null },
    centerpieces: {
      height: "low",
      flowers: ["wildflowers"],
      colors: ["white", "lavender", "yellow"],
      greenery: "garland",
      container: "glass hurricanes",
      candles: "flameless",
    },
    lighting: { uplighting: null, pin_spots: false, string_lights: true, ambient: "evening_warm" },
    extras: [],
  };

  const spaces: SpaceRow[] = [
    { id: "space-ballroom", venue_id: "venue-larkspur", name: "Grand Ballroom", venue_spec: BALLROOM_SPEC, current_spec: blush },
    { id: "space-terrace", venue_id: "venue-larkspur", name: "Garden Terrace", venue_spec: TERRACE_SPEC, current_spec: cocktail },
    { id: "space-hayloft", venue_id: "venue-hollow-creek", name: "Hayloft", venue_spec: BARN_SPEC, current_spec: stringLights },
    {
      id: "space-wren-long-room",
      venue_id: "venue-wren-hall",
      name: "Long Room",
      venue_spec: { ...BALLROOM_SPEC, style: "georgian assembly room" },
      current_spec: null,
      references: [
        {
          url: SAMPLES["ballroom-a"].empty,
          source_page: "https://wrenhall.example/spaces/long-room",
          caption: "The Long Room from the entrance",
          credit: "Wren Hall (demo image)",
        },
        {
          url: SAMPLES["ballroom-b"].empty,
          source_page: "https://wrenhall.example/gallery",
          caption: "Looking back toward the windows",
          credit: "Wren Hall gallery (demo image)",
        },
      ],
    },
  ];
  for (const s of spaces) db.spaces.set(s.id, clone(s));

  const photo = (id: string, space_id: string, sample: SampleScene, minute: number): PhotoRow => ({
    id,
    space_id,
    sample,
    url: SAMPLES[sample].empty,
    kind: "upload",
    approved: true,
    created_at: `2026-11-02T18:${String(minute).padStart(2, "0")}:00Z`,
    ...SAMPLE_SIZE,
  });
  const photos = [
    photo("photo-ballroom-a", "space-ballroom", "ballroom-a", 1),
    photo("photo-ballroom-b", "space-ballroom", "ballroom-b", 2),
    photo("photo-terrace", "space-terrace", "terrace", 3),
    photo("photo-hayloft", "space-hayloft", "barn", 4),
  ];
  for (const p of photos) db.photos.set(p.id, p);

  const looks: Array<[LookRow, Array<[string, number]>]> = [
    [
      { id: "look-blush", space_id: "space-ballroom", name: "Blush, gold & ivory", spec: blush, parent_look_id: null, created_at: "2026-11-18T20:00:00Z" },
      [["photo-ballroom-a", 0.88], ["photo-ballroom-b", 0.81]],
    ],
    [
      { id: "look-evergreen", space_id: "space-ballroom", name: "Evergreen", spec: evergreen, parent_look_id: "look-blush", created_at: "2026-11-19T21:30:00Z" },
      [["photo-ballroom-a", 0.86]],
    ],
    [
      { id: "look-cocktail", space_id: "space-terrace", name: "Cocktail hour", spec: cocktail, parent_look_id: null, created_at: "2026-11-19T18:10:00Z" },
      [["photo-terrace", 0.84]],
    ],
    [
      { id: "look-string-lights", space_id: "space-hayloft", name: "String lights", spec: stringLights, parent_look_id: null, created_at: "2026-10-22T19:00:00Z" },
      [["photo-hayloft", 0.83]],
    ],
  ];
  // Structure-check outcomes seen in real renders (UT7): heavy relighting that couldn't be verified, and a changed room.
  const seededQa: Record<string, Partial<NonNullable<Render["qa"]>>> = {
    "render-look-cocktail-photo-terrace": {
      structure: {
        score: 0.42, method: "misaligned", aligned: false, inliers: 9, scale: null, rotation: null, coverage: null,
        brightness_delta: 0.46, reason: "no consistent match with the photo",
      },
      structure_warning: "This render may have altered the room or changed the framing.",
      structure_message: {
        level: "unverified",
        text: "Lighting changed a lot, so we couldn't confirm the room matches; compare with the slider.",
      },
    },
    "render-look-string-lights-photo-hayloft": {
      structure: {
        score: 0.38, method: "misaligned", aligned: true, inliers: 64, scale: 1, rotation: 0, coverage: 0.94,
        reason: "the render lost the room's structure",
      },
      structure_warning: "This render may have altered the room or changed the framing.",
      structure_message: { level: "changed", text: "This render may have changed the room's architecture." },
    },
  };
  for (const [look, targets] of looks) {
    db.looks.set(look.id, { ...look, spec: withoutNulls(look.spec) });
    for (const [photoId, score] of targets) {
      const p = db.photos.get(photoId)!;
      const out = sampleRender(p.sample!, look.spec);
      const id = `render-${look.id}-${photoId}`;
      db.renders.set(id, {
        id,
        look_id: look.id,
        photo_id: photoId,
        engine: "mock",
        status: "done",
        url: out.url,
        prompt: buildPrompt(look.spec),
        structure_score: seededQa[id]?.structure?.score ?? score,
        qa: {
          tables_seen: look.spec.tables.count,
          notes: out.note ?? "Demo photograph; counts come from the plan.",
          structure_message: null,
          ...seededQa[id],
        },
        error: null,
        created_at: look.created_at,
        attempt: 1,
      });
    }
  }

  db.chat.set("space-ballroom", [
    { id: uid(), role: "user", content: "About 140 guests. Ivory linens, gold chairs, low blush and ivory flowers, warm lighting.", created_at: "2026-11-18T19:55:00Z" },
    { id: uid(), role: "assistant", content: "Set 14 round tables of 10 with ivory floor-length linens, gold chiavari chairs, low blush and ivory centerpieces and warm amber uplighting. Candles are flameless because Larkspur House doesn't allow open flames.", created_at: "2026-11-18T19:55:05Z" },
  ]);
  return db;
}

function db(): DB {
  if (!state) state = seed();
  return state;
}

type GateName = "chat" | "renderLook" | "deletePhoto" | "getJob" | "setupStatus" | "pairDevice" | "testBackend";
const gates = new Map<GateName, { promise: Promise<void>; release: () => void; waiting: number }>();
const failNext = new Map<GateName, string>();

/** Lets an end-to-end test hold a request mid-flight (`hold`/`release`) or make the next one fail. A no-op otherwise. */
async function gate(name: GateName) {
  const held = gates.get(name);
  if (held) {
    held.waiting++;
    try {
      await held.promise;
    } finally {
      held.waiting--;
    }
  }
  const message = failNext.get(name);
  if (message !== undefined) {
    failNext.delete(name);
    throw new ApiError(500, message);
  }
}

function hold(name: GateName) {
  if (gates.has(name)) return;
  let release = () => {};
  const promise = new Promise<void>((resolve) => (release = resolve));
  gates.set(name, { promise, release, waiting: 0 });
}

/** Peek at the mock database and steer requests, for end-to-end tests (`window.__vvMock`). Mock mode only. */
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_VV_MOCK === "1") {
  // `?vvHold=setupStatus,…` holds those requests from the first one, before a test could call `hold()`.
  for (const name of new URLSearchParams(window.location.search).get("vvHold")?.split(",") ?? []) hold(name as GateName);
  Object.assign(window, {
    __vvMock: {
      looks: () => clone([...db().looks.values()]),
      renders: () => [...db().renders.values()].map((r) => clone(publicRender(r))),
      chat: (spaceId: string) => clone(db().chat.get(spaceId) ?? []),
      space: (spaceId: string) => clone(db().spaces.get(spaceId) ?? null),
      photos: (spaceId: string) => photosFor(spaceId),
      hold,
      release: (name: GateName) => {
        gates.get(name)?.release();
        gates.delete(name);
      },
      waiting: (name: GateName) => gates.get(name)?.waiting ?? 0,
      failNext: (name: GateName, message: string) => failNext.set(name, message),
      ...system.systemHooks,
    },
  });
}

function photosFor(spaceId: string): Photo[] {
  return [...db().photos.values()]
    .filter((p) => p.space_id === spaceId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(({ id, space_id, url, kind, approved, width, height, source_url, source_page, credit }) => ({
      id, space_id, url, kind, approved, width, height,
      source_url: source_url ?? null,
      source_page: source_page ?? null,
      credit: credit ?? null,
    }));
}

function spaceOut(row: SpaceRow): Space {
  return clone({
    source: null, capacity_seated: null, capacity_standing: null, references: [], ...row, photos: photosFor(row.id),
  });
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
  const space = db().spaces.get(row.space_id);
  const venue = space && db().venues.get(space.venue_id);
  return clone({ ...row, renders, warnings: venue ? applyRules(row.spec, venue.rules).warnings : [] });
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Uploaded photos have no demo match, so the mock engine warms them slightly and says so in a corner label. */
async function tintUpload(url: string, spec: DesignSpec): Promise<string> {
  if (typeof document === "undefined") return url;
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return url;
  ctx.drawImage(img, 0, 0);
  ctx.globalAlpha = 0.18;
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = accentFor(spec);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  const size = Math.max(12, Math.round(canvas.height * 0.022));
  const label = "Mock engine: your photo, lightly tinted";
  ctx.font = `${size}px system-ui, sans-serif`;
  const w = ctx.measureText(label).width + size * 1.4;
  ctx.fillStyle = "rgba(20,18,15,.6)";
  ctx.fillRect(size, canvas.height - size * 3, w, size * 2);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, size * 1.7, canvas.height - size * 1.65);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** Crops a region (fractions of the frame) to fake the corner and detail frames of a video tour. */
async function cropFrame(url: string, rect: { x: number; y: number; w: number; h: number }, blur = 0): Promise<string> {
  if (typeof document === "undefined") return url;
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 640;
    const ctx = canvas.getContext("2d");
    if (!ctx) return url;
    if (blur) ctx.filter = `blur(${blur}px)`;
    const sw = img.naturalWidth * rect.w;
    const sh = img.naturalHeight * rect.h;
    ctx.drawImage(img, img.naturalWidth * rect.x, img.naturalHeight * rect.y, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    return url;
  }
}

async function finalize(row: JobRow) {
  const d = db();
  row.finalized = true;
  if (row.complete) {
    try {
      await row.complete(row);
    } catch (e) {
      row.job = { ...row.job, status: "failed", progress: 1, error: e instanceof Error ? e.message : String(e) };
    }
    return;
  }
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
    const sample = photo.sample ? sampleRender(photo.sample, look.spec) : null;
    render.url = sample ? sample.url : await tintUpload(photo.url, look.spec);
    render.status = "done";
    render.engine = row.engine;
    render.structure_score = 0.78 + ((render.attempt * 7) % 10) / 100;
    render.qa = {
      tables_seen: look.spec.tables.count,
      notes: sample?.note ?? (sample ? "Demo photograph; counts come from the plan." : "Mock engine output; counts come from the plan."),
      structure_message: null,
    };
    row.job = { ...row.job, status: "done", progress: 1, result: { render_id: render.id } };
  } else if (row.spaceId) {
    const space = d.spaces.get(row.spaceId);
    if (!space) {
      row.job = { ...row.job, status: "failed", progress: 1, error: "The space was deleted." };
      return;
    }
    const sample =
      (Object.keys(SAMPLES) as SampleScene[]).find((k) => row.referenceUrl && SAMPLES[k].empty === row.referenceUrl) ??
      sceneForStyle(space.venue_spec.style);
    const photo: PhotoRow = {
      id: uid(),
      space_id: space.id,
      url: SAMPLES[sample].empty,
      kind: "generated_base",
      approved: false,
      sample,
      created_at: now(),
      ...SAMPLE_SIZE,
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
    if (elapsed >= row.durationMs) {
      await finalize(row);
    } else if (elapsed >= QUEUED_MS) {
      const progress = Math.min(0.99, (elapsed - QUEUED_MS) / (row.durationMs - QUEUED_MS));
      const message = row.messages?.[Math.min(row.messages.length - 1, Math.floor(progress * row.messages.length))] ?? null;
      row.job = { ...row.job, status: "running", progress, message };
      const render = row.renderId ? db().renders.get(row.renderId) : undefined;
      if (render) render.status = "running";
    }
  }
}

function newJob(
  kind: Job["kind"],
  engine: string,
  target: Pick<JobRow, "renderId" | "spaceId" | "referenceUrl" | "messages" | "complete"> & { durationMs?: number } = {},
): Job {
  const job: Job = {
    id: uid(), kind, status: "queued", progress: 0, cancel_requested: false, error: null, error_status: null,
    message: null, created_at: now(), result: null,
  };
  const { durationMs = DONE_MS, ...rest } = target;
  db().jobs.set(job.id, { job, startedAt: Date.now(), durationMs, finalized: false, engine, ...rest });
  return clone(job);
}

/** The fictional venue every mock search finds. URLs use the reserved `.example` domain. */
function larkspurResearch(query: string): VenueResearch {
  const site = "https://larkspurhouse.example";
  return {
    query,
    matches: [
      {
        name: "Larkspur House",
        address: "14 Orchard Lane, Larkspur Hollow",
        website: site,
        confidence: 0.92,
        summary: "A restored 1890s manor that hosts weddings in a cream-and-gilt ballroom and on a stone garden terrace.",
        style: "classic manor",
        spaces: [
          {
            name: "Grand Ballroom",
            description: "Cream panelled ballroom with arched windows and crystal chandeliers.",
            capacity_seated: 180,
            capacity_standing: 250,
            length_ft: 90,
            width_ft: 60,
            ceiling_ft: 24,
            walls: "cream panelled walls with moulding",
            floor: "dark hardwood",
            windows: "tall arched windows along one wall",
            fixtures: ["crystal chandeliers"],
            photos: [
              { url: SAMPLES["ballroom-a"].empty, source_page: `${site}/spaces/grand-ballroom`, caption: "The ballroom from the entrance", credit: "Larkspur House (demo image)" },
              { url: SAMPLES["ballroom-b"].empty, source_page: `${site}/gallery`, caption: "Looking back toward the windows", credit: "Larkspur House gallery (demo image)" },
            ],
            source: `${site}/spaces/grand-ballroom`,
          },
          {
            name: "Garden Terrace",
            description: "Stone terrace above the lawn, used for ceremonies and cocktail hour.",
            capacity_seated: 80,
            capacity_standing: 140,
            length_ft: 60,
            width_ft: 35,
            ceiling_ft: null,
            walls: "open air, stone balustrade with clipped hedges",
            floor: "bluestone pavers",
            windows: null,
            fixtures: ["stone balustrade"],
            photos: [
              { url: SAMPLES.terrace.empty, source_page: `${site}/spaces/terrace`, caption: "The terrace at dusk", credit: "Larkspur House (demo image)" },
            ],
            source: `${site}/spaces/terrace`,
          },
        ],
        rules_found: [
          { text: "Only flameless candles are permitted indoors.", maps_to: "live_candles", allowed: false, source: `${site}/faq#decor` },
          { text: "Confetti, glitter and rice may not be thrown inside or on the terrace.", maps_to: "confetti", allowed: false, source: `${site}/planning-guide.pdf` },
        ],
        provided_items: ["Ivory floor-length linens", "Gold chiavari chairs", "60-inch round tables", "Dance floor"],
        sources: [site, `${site}/spaces/grand-ballroom`, `${site}/spaces/terrace`, `${site}/faq`, `${site}/planning-guide.pdf`],
      },
      {
        name: "Larkspur Hall Conference Centre",
        address: "220 Market Street, Larkspur",
        website: "https://larkspurhall.example",
        confidence: 0.34,
        summary: "A business conference venue with a similar name. Probably not the one you mean.",
        style: "modern conference",
        spaces: [{ name: "Hall A", description: "Divisible conference hall.", capacity_seated: 300, fixtures: [], photos: [], source: "https://larkspurhall.example/rooms" }],
        rules_found: [],
        provided_items: [],
        sources: ["https://larkspurhall.example"],
      },
    ],
    notes: "Demo mode: this is a fictional venue built from the sample photographs.",
  };
}

const RESEARCH_STEPS = [
  "Looking up the official site…",
  "Reading the venue's spaces and capacities…",
  "Collecting photos of each space…",
  "Checking published decor policies…",
  "Linking every fact to its source…",
];

const VIDEO_STEPS = [
  "Reading the video…",
  "Picking sharp, well-lit frames…",
  "Removing near-duplicate views…",
  "Grouping frames into spaces…",
  "Describing each space…",
];

async function buildFrames(): Promise<VideoFrame[]> {
  const a = SAMPLES["ballroom-a"].empty;
  const b = SAMPLES["ballroom-b"].empty;
  const t = SAMPLES.terrace.empty;
  const plan: Array<Omit<VideoFrame, "photo_id" | "url"> & { src: string; rect?: { x: number; y: number; w: number; h: number }; blur?: number }> = [
    { src: a, t: 4, space_guess: "Ballroom", view: "wide", description: "Wide view from the entrance toward the arched windows.", usable: true, sharpness: 0.91, fixtures: ["crystal chandeliers"] },
    { src: b, t: 21, space_guess: "Ballroom", view: "wide", description: "From the far corner, looking back along the windows.", usable: true, sharpness: 0.86 },
    { src: a, t: 12, rect: { x: 0.45, y: 0.2, w: 0.55, h: 0.7 }, space_guess: "Ballroom", view: "corner", description: "Right-hand corner with two windows.", usable: true, sharpness: 0.74 },
    { src: a, t: 16, rect: { x: 0.3, y: 0, w: 0.4, h: 0.4 }, space_guess: "Ballroom", view: "detail", description: "Chandelier and ceiling moulding.", usable: false, sharpness: 0.68, fixtures: ["crystal chandeliers"] },
    { src: b, t: 28, rect: { x: 0.1, y: 0.35, w: 0.5, h: 0.6 }, blur: 3, space_guess: "Ballroom", view: "corner", description: "Panning past the side wall; motion blur.", usable: false, sharpness: 0.21 },
    { src: t, t: 47, space_guess: "Terrace", view: "wide", description: "Terrace and balustrade with the lawn beyond.", usable: true, sharpness: 0.88, fixtures: ["stone balustrade"] },
    { src: t, t: 55, rect: { x: 0, y: 0.25, w: 0.6, h: 0.75 }, space_guess: "Terrace", view: "corner", description: "Left end of the terrace by the hedges.", usable: true, sharpness: 0.79 },
    { src: t, t: 61, rect: { x: 0.45, y: 0.45, w: 0.45, h: 0.45 }, space_guess: "Terrace", view: "detail", description: "Bluestone pavers and balustrade detail.", usable: false, sharpness: 0.72 },
  ];
  return Promise.all(
    plan.map(async ({ src, rect, blur, ...f }) => ({
      ...f,
      photo_id: uid(),
      url: rect ? await cropFrame(src, rect, blur) : src,
    })),
  );
}

function probeDuration(file: File): Promise<number | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 1500);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    video.src = url;
  });
}

const VIDEO_TYPES = /^video\/(mp4|quicktime|webm|x-m4v|hevc|h265)$/;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v|hevc)$/i;
const MAX_VIDEO_BYTES = 1024 ** 3;

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
  const backends = system.currentBackends();
  if (!id) {
    if (!backends.defaults.engine) throw new ApiError(409, "No image engine is available.");
    return backends.defaults.engine;
  }
  const engine = backends.engines.find((e) => e.id === id);
  if (!engine) throw new ApiError(400, `Unknown engine “${id}”.`);
  if (!engine.available || engine.logged_in === false) {
    throw new ApiError(409, `${engine.label} isn't available: ${engine.detail ?? "not detected"}`);
  }
  return id;
}

const endpoints: VVApi = {
  async backends() {
    await latency();
    return system.currentBackends();
  },
  async refreshBackends() {
    await sleep(500 + Math.random() * 300);
    return system.refreshBackends();
  },
  async testBackend(kind, id, { confirm_credits }) {
    await gate("testBackend");
    // Claim the slot first, like the API: a second click while this one runs answers 409.
    const run = system.beginTest(kind, id, confirm_credits === true);
    await sleep(700 + Math.random() * 400);
    return system.finishTest(run);
  },
  async getSettings() {
    await latency();
    return system.getSettings();
  },
  async updateSettings(body) {
    await latency();
    return system.updateSettings(body);
  },
  async setupStatus() {
    await latency();
    await gate("setupStatus");
    return system.setupStatus();
  },
  async lanInfo() {
    await latency();
    return system.lanInfo();
  },
  async rotateLanCode() {
    await latency();
    return system.rotateLanCode();
  },
  async pairDevice(code) {
    await latency();
    await gate("pairDevice");
    system.pairDevice(code, system.deviceLabel(typeof navigator === "undefined" ? "" : navigator.userAgent));
  },
  async lanDevices() {
    await latency();
    return system.lanDevices();
  },
  async forgetLanDevice(id) {
    await latency();
    system.forgetDevice(id);
  },
  async forgetAllLanDevices() {
    await latency();
    system.forgetAllDevices();
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
      const row: PhotoRow = { id: uid(), space_id: spaceId, url, kind: "upload", approved: true, width, height, sample: null, created_at: now() };
      db().photos.set(row.id, row);
      out.push(photosFor(spaceId).find((p) => p.id === row.id)!);
    }
    return out;
  },
  async deletePhoto(id) {
    await latency();
    await gate("deletePhoto");
    db().photos.delete(id);
    for (const [rid, r] of db().renders) if (r.photo_id === id) db().renders.delete(rid);
  },
  async generateBase(spaceId, { engine, reference_url }) {
    await latency();
    const space = requireSpace(spaceId);
    if (reference_url && !(space.references ?? []).some((r) => r.url === reference_url)) {
      throw new ApiError(422, "That photo isn't one of this space's references.");
    }
    const engineId = engineAvailable(engine);
    const info = system.currentBackends().engines.find((e) => e.id === engineId);
    // Same check as the API: only engines that take reference images can work from a reference photo.
    if (reference_url && (info?.caps?.max_refs ?? 0) < 1) {
      throw new ApiError(422, `${info?.label ?? engineId} can't use a reference photo; pick Copilot, Codex or mflux.`);
    }
    return newJob("generate_base", engineId, { spaceId, referenceUrl: reference_url });
  },
  async importReference(spaceId, { url, rights_confirmed }) {
    await sleep(500);
    const space = requireSpace(spaceId);
    if (rights_confirmed !== true) throw new ApiError(422, "Confirm you're using this photo for personal planning before importing it.");
    const ref = (space.references ?? []).find((r) => r.url === url);
    if (!ref) throw new ApiError(422, "That photo isn't one of this space's references.");
    const sample = (Object.keys(SAMPLES) as SampleScene[]).find((k) => SAMPLES[k].empty === url) ?? null;
    const id = uid();
    db().photos.set(id, {
      id, space_id: space.id, url, kind: "web", approved: true, sample, created_at: now(),
      source_url: url, source_page: ref.source_page, credit: ref.credit ?? null, ...SAMPLE_SIZE,
    });
    return photosFor(space.id).find((p) => p.id === id)!;
  },
  async approvePhoto(id) {
    await latency();
    const row = db().photos.get(id) ?? notFound("Photo");
    row.approved = true;
    return photosFor(row.space_id ?? "").find((p) => p.id === id)!;
  },
  async chat(spaceId, { message, spec, brain }) {
    await sleep(700 + Math.random() * 500);
    await gate("chat");
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
    return {
      reply,
      spec: ruled.spec,
      warnings: ruled.warnings,
      rule_notes: ruled.warnings.map((w) => `${w.message} ${w.fix}`),
      intent: result.intent,
      spec_changed: !specEquals(ruled.spec, base),
      look_name: result.look_name,
      ambiguities: result.ambiguities,
      brain: brain ?? "mock",
    };
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
      // The API stores `spec.to_dict()`, which drops None fields.
      spec: withoutNulls(applyRules(spec, venue.rules).spec),
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
    await gate("renderLook");
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
  async research({ query, brain }) {
    await latency();
    if (!query.trim()) throw new ApiError(422, "Type the venue's name, and the room and city if you know them.");
    const backends = system.currentBackends();
    const b = backends.brains.find((x) => x.id === (brain ?? backends.defaults.brain));
    if (!b) throw new ApiError(400, `Unknown brain “${brain}”.`);
    if (!b.available || b.logged_in === false) throw new ApiError(409, `${b.label} isn't ready: ${b.detail ?? "not detected"}`);
    if (!canBrowse(b)) throw new ApiError(409, `${b.label} can't search the web.`);
    return newJob("venue_research", b.id, {
      durationMs: AGENT_MS,
      messages: RESEARCH_STEPS,
      complete: async (row) => {
        const research = larkspurResearch(query.trim());
        db().research.set(row.job.id, research);
        row.job = { ...row.job, status: "done", progress: 1, message: null, result: { research } };
      },
    });
  },
  async importVenue(body) {
    await sleep(600);
    const research = db().research.get(body.research_job_id) ?? notFound("Research");
    const match = research.matches[body.match_index] ?? notFound("Match");
    const suggested = new Map((match.spaces ?? []).map((s) => [s.name, s]));
    if (body.space_names.length === 0) throw new ApiError(422, "Pick at least one space to import.");
    if (new Set(body.space_names).size !== body.space_names.length) throw new ApiError(422, "Space names must be unique.");
    const unknownSpace = body.space_names.find((n) => !suggested.has(n));
    if (unknownSpace) throw new ApiError(422, `“${unknownSpace}” isn't one of the suggested spaces.`);
    const unknownItem = body.accepted_provided_items.find((i) => !(match.provided_items ?? []).includes(i));
    if (unknownItem) throw new ApiError(422, `“${unknownItem}” isn't one of the suggested provided items.`);
    if (body.photos.some((p) => p.mode === "import" && !p.rights_confirmed)) {
      throw new ApiError(422, "Confirm you're using these photos for personal planning before importing them.");
    }
    const rules: VenueRules = { ...defaultRules(), provided_items: [...body.accepted_provided_items] };
    const sourced: string[] = [];
    for (const key of body.accepted_rules) {
      const found = (match.rules_found ?? []).filter((r) => r.maps_to === key && r.allowed !== null);
      const values = new Set(found.map((r) => r.allowed));
      if (values.size !== 1) throw new ApiError(422, `The published rules for ${key} are ambiguous.`);
      rules[key] = found[0].allowed as boolean;
      sourced.push(...found.map((r) => `${r.text} (${r.source})`));
    }
    if (sourced.length) rules.notes = `From the venue's published policies:\n${sourced.join("\n")}`;
    const venue: VenueRow = { id: uid(), name: match.name, rules, created_at: now() };
    db().venues.set(venue.id, venue);
    const byUrl = new Map(body.photos.map((p) => [p.url, p]));
    for (const name of body.space_names) {
      const source = suggested.get(name)!;
      const space: SpaceRow = { id: uid(), venue_id: venue.id, name, venue_spec: venueSpecFromResearch(source, match.style), current_spec: null };
      db().spaces.set(space.id, space);
      const mine = (source.photos ?? []).flatMap((p) => {
        const picked = byUrl.get(p.url);
        return picked ? [{ ...p, mode: picked.mode }] : [];
      });
      for (const p of mine.filter((x) => x.mode === "import")) {
        const sample = (Object.keys(SAMPLES) as SampleScene[]).find((k) => SAMPLES[k].empty === p.url) ?? null;
        const id = uid();
        db().photos.set(id, {
          id,
          space_id: space.id, url: p.url, kind: "web", approved: true, sample, created_at: now(),
          source_url: p.url, source_page: p.source_page, credit: p.credit ?? null, ...SAMPLE_SIZE,
        });
      }
      // Reference photos stay on the space; the studio offers to import one or draw a base view from it.
      const refs = mine.filter((x) => x.mode === "reference");
      if (refs.length) {
        space.references = refs.map(({ url, source_page, caption, credit }) => ({ url, source_page, caption, credit }));
      }
    }
    return { ...venueOut(venue), skipped_photos: [] };
  },
  async uploadVideo(venueId, file, { onProgress, signal } = {}) {
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    requireVenue(venueId);
    if (!VIDEO_TYPES.test(file.type) && !VIDEO_EXT.test(file.name)) {
      throw new ApiError(415, `${file.name} isn't an MP4, MOV, WebM or HEVC video.`);
    }
    if (file.size > MAX_VIDEO_BYTES) throw new ApiError(413, `${file.name} is larger than 1 GB.`);
    const duration = await probeDuration(file);
    if (duration && duration > 5 * 60 + 1) throw new ApiError(413, "Videos can be up to 5 minutes long.");
    // Simulated upload speed: about 80 MB/s, at least a second so the bar is visible.
    const total = Math.max(1000, Math.min(6000, file.size / 80_000));
    const started = Date.now();
    while (Date.now() - started < total) {
      if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
      onProgress?.((Date.now() - started) / total);
      await sleep(100);
    }
    onProgress?.(1);
    return newJob("video_ingest", "mock", {
      durationMs: AGENT_MS,
      messages: VIDEO_STEPS,
      complete: async (row) => {
        const frames = await buildFrames();
        db().videos.set(row.job.id, { venueId, frames, applied: false });
        const spaces_suggested: SuggestedSpace[] = [
          { name: "Ballroom", venue_spec: { ...BALLROOM_SPEC, notes: "Size estimated from the video; approximate." }, photo_ids: frames.filter((f) => f.space_guess === "Ballroom").map((f) => f.photo_id) },
          { name: "Terrace", venue_spec: { ...TERRACE_SPEC, notes: "Size estimated from the video; approximate." }, photo_ids: frames.filter((f) => f.space_guess === "Terrace").map((f) => f.photo_id) },
        ];
        row.job = { ...row.job, status: "done", progress: 1, message: null, result: { frames, spaces_suggested, duration_s: duration ? Math.round(duration) : 68 } };
      },
    });
  },
  async applyVideo(venueId, { job_id, spaces }) {
    await sleep(400);
    const venue = requireVenue(venueId);
    const ingest = db().videos.get(job_id) ?? notFound("Video");
    if (ingest.venueId !== venueId) throw new ApiError(400, "That video belongs to another venue.");
    if (ingest.applied) throw new ApiError(409, "These frames were already added.");
    const byId = new Map(ingest.frames.map((f) => [f.photo_id, f]));
    const kept = spaces.filter((sp) => sp.photo_ids.length > 0);
    if (kept.length === 0) throw new ApiError(422, "Keep at least one frame.");
    for (const sp of kept) {
      const name = sp.name.trim() || "Untitled space";
      let space = [...db().spaces.values()].find((x) => x.venue_id === venueId && x.name.toLowerCase() === name.toLowerCase());
      if (!space) {
        space = { id: uid(), venue_id: venueId, name, venue_spec: clone(sp.venue_spec ?? { fixtures: [] }), current_spec: null };
        db().spaces.set(space.id, space);
      }
      for (const [i, pid] of sp.photo_ids.entries()) {
        const f = byId.get(pid);
        if (!f) continue;
        const sample = (Object.keys(SAMPLES) as SampleScene[]).find((k) => SAMPLES[k].empty === f.url) ?? null;
        db().photos.set(pid, {
          id: pid, space_id: space.id, url: f.url, kind: "video_frame", approved: true, sample,
          created_at: new Date(Date.now() + i).toISOString(),
          ...(f.url.startsWith("data:") ? { width: 960, height: 640 } : SAMPLE_SIZE),
        });
      }
    }
    ingest.applied = true;
    return venueOut(venue);
  },
  async getJob(id) {
    await sleep(60);
    await gate("getJob");
    await tick();
    const row = db().jobs.get(id) ?? notFound("Job");
    return clone(row.job);
  },
  async cancelJob(id) {
    await latency();
    const row = db().jobs.get(id) ?? notFound("Job");
    if (!row.finalized && (row.job.status === "queued" || row.job.status === "running")) {
      row.finalized = true;
      row.job = { ...row.job, status: "cancelled", message: null };
      const render = row.renderId ? db().renders.get(row.renderId) : undefined;
      if (render) render.status = "cancelled";
    }
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
    const photoIds = new Set(look.renders.map((r) => r.photo_id));
    const credits = [...db().photos.values()]
      .filter((p) => photoIds.has(p.id) && (p.credit || p.source_url))
      .map((p) => `${p.credit ?? "Photo"}${p.source_url ? `, ${p.source_url}` : ""}`);
    const lines = [
      `${venue.name}, ${space.name}`,
      `Saved ${new Date(look.created_at).toDateString()}`,
      `${look.renders.filter((r) => r.status === "done").length} renders (images are included in the real export)`,
      "",
      ...rows,
      "",
      "Photo credits",
      ...(credits.length ? credits : ["Your own photos"]),
    ];
    return URL.createObjectURL(buildTextPdf(look.name, lines));
  },
};

/**
 * Like services/api/main.py: a phone on the LAN gets 403 "Pair this device…" from everything but pairing until it
 * has paired. (Owner-only endpoints check the client themselves, in mock-system.)
 */
export const mockApi = Object.fromEntries(
  Object.entries(endpoints).map(([name, fn]) => [
    name,
    name === "pairDevice"
      ? fn
      : async (...args: unknown[]) => {
          system.requirePaired();
          return (fn as (...a: unknown[]) => unknown)(...args);
        },
  ]),
) as unknown as VVApi;
