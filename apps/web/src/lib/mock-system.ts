/**
 * The mock's view of "this machine" for first-run setup (docs/onboarding-and-mobile.md): which AI tools are installed
 * and signed in, the saved settings, test results and LAN pairing. End-to-end tests steer it with `?vvScenario=` or
 * `window.__vvMock.setScenario()` / `.install()`. Unlike the rest of the mock database it lives in sessionStorage, so a
 * scenario survives navigation within a test (reloading re-detects the tools, like restarting the API).
 */
import { ApiError } from "@/lib/errors";
import { SAMPLES } from "@/lib/samples";
import { LOW_STRUCTURE_SCORE } from "@/lib/spec";
import type {
  Backends,
  BackendStatus,
  BackendTest,
  BackendTestResult,
  InstallCommands,
  LanInfo,
  Settings,
  SettingsPatch,
  SetupMissing,
  SetupStatus,
  UsedFor,
} from "@/lib/types";

export type MockScenario = "fresh" | "signed-out" | "ready" | "demo";
export type MockProvider = "claude" | "codex" | "copilot" | "kimi" | "mflux";
export type ToolState = "ready" | "signed-out" | "missing";

export const MOCK_SCENARIOS: readonly MockScenario[] = ["fresh", "signed-out", "ready", "demo"];
const PROVIDERS: readonly MockProvider[] = ["claude", "codex", "copilot", "kimi", "mflux"];

const MACHINES: Record<MockScenario, Record<MockProvider, ToolState>> = {
  fresh: { claude: "missing", codex: "missing", copilot: "missing", kimi: "missing", mflux: "missing" },
  "signed-out": { claude: "signed-out", codex: "signed-out", copilot: "signed-out", kimi: "signed-out", mflux: "missing" },
  ready: { claude: "ready", codex: "missing", copilot: "ready", kimi: "missing", mflux: "ready" },
  demo: { claude: "ready", codex: "missing", copilot: "ready", kimi: "signed-out", mflux: "missing" },
};

type Tool = {
  label: string;
  engineLabel?: string;
  brain: boolean;
  engine: boolean;
  bin: string;
  version: string;
  used_for: UsedFor[];
  cost_note: string;
  login: string | null;
  install: InstallCommands;
  caps?: BackendStatus["caps"];
  /** CLIs that can't report a login: the API returns `logged_in: null` ("Unknown, run a test"). */
  reportsLogin: boolean;
};

const TOOLS: Record<MockProvider, Tool> = {
  claude: {
    label: "Claude Code", brain: true, engine: false, bin: "claude", version: "2.4.0",
    used_for: ["chat", "web_research", "vision"],
    cost_note: "Uses your Claude subscription",
    login: "claude auth login",
    install: {
      macos: "npm install -g @anthropic-ai/claude-code",
      linux: "npm install -g @anthropic-ai/claude-code",
      docs_url: "https://docs.anthropic.com/en/docs/claude-code/setup",
    },
    reportsLogin: true,
  },
  codex: {
    label: "Codex", engineLabel: "Codex image", brain: true, engine: true, bin: "codex", version: "0.42.0",
    used_for: ["chat", "web_research", "vision", "images"],
    cost_note: "Uses your ChatGPT plan's quota",
    login: "codex login",
    install: { macos: "npm install -g @openai/codex", linux: "npm install -g @openai/codex", docs_url: "https://github.com/openai/codex" },
    caps: { can_generate: true, can_edit: true, typical_seconds: 40, cost_note: "Uses your ChatGPT plan quota", photoreal: true, max_refs: 3 },
    reportsLogin: true,
  },
  copilot: {
    label: "Copilot CLI", engineLabel: "Copilot image", brain: true, engine: true, bin: "copilot", version: "1.0.115",
    used_for: ["chat", "web_research", "vision", "images"],
    cost_note: "Uses your Copilot AI credits",
    login: "copilot login",
    install: {
      macos: "npm install -g @github/copilot",
      linux: "npm install -g @github/copilot",
      docs_url: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
    },
    caps: { can_generate: true, can_edit: true, typical_seconds: 30, cost_note: "Uses Copilot AI credits", photoreal: true, max_refs: 3 },
    reportsLogin: false,
  },
  kimi: {
    label: "Kimi Code", brain: true, engine: false, bin: "kimi", version: "0.9.2",
    used_for: ["chat", "web_research"],
    cost_note: "Uses your Kimi plan",
    login: "kimi login",
    install: { macos: "uv tool install kimi-cli", linux: "uv tool install kimi-cli", docs_url: "https://github.com/MoonshotAI/kimi-cli" },
    reportsLogin: false,
  },
  mflux: {
    label: "Local FLUX (mflux)", engineLabel: "Local FLUX (mflux)", brain: false, engine: true, bin: "mflux-generate", version: "0.11.0",
    used_for: ["images"],
    cost_note: "Free, runs on this Mac",
    login: null,
    install: {
      macos: "uv tool install mflux",
      linux: "mflux needs a Mac with Apple Silicon",
      docs_url: "https://github.com/filipstrand/mflux",
    },
    caps: { can_generate: true, can_edit: true, typical_seconds: 180, cost_note: "Free, runs on your Mac", photoreal: true, max_refs: 2 },
    reportsLogin: true,
  },
};

/** The demo's CLIs report their login (the seed data predates the spec's "Copilot and Kimi report null"). */
const DEMO_LOGIN: Partial<Record<MockProvider, boolean>> = { copilot: true, kimi: false };

const MOCK_BRAIN: BackendStatus = {
  id: "mock", label: "Mock brain", kind: "brain", available: true, logged_in: null, version: null,
  detail: "Keyword parser for offline use. In demo mode it also returns a sample venue.",
  used_for: ["chat"], cost_note: "Free, for testing", login: null, last_test: null,
};
const MOCK_ENGINE: BackendStatus = {
  id: "mock", label: "Mock (dev)", kind: "engine", available: true, logged_in: null, version: null,
  detail: "Returns the matching demo photograph. Nothing is generated.",
  caps: { can_generate: true, can_edit: true, typical_seconds: 2, cost_note: "Free, for testing", photoreal: true, max_refs: 0 },
  used_for: ["images"], cost_note: "Free, for testing", login: null, last_test: null,
};
const LAYOUT_GUIDE: BackendStatus = {
  id: "scene3d", label: "Layout guide", kind: "engine", available: true, logged_in: null, version: null,
  detail: "Places each table exactly before the photo edit.",
};

const BRAIN_ORDER = ["claude", "copilot", "codex", "kimi", "mock"];
const ENGINE_ORDER = ["copilot", "codex", "mflux", "mock"];

type SystemState = {
  scenario: MockScenario;
  /** What's really on the machine; `install()` changes it. */
  machine: Record<MockProvider, ToolState>;
  /** What the API last detected; Check again (or a restart) copies `machine` into it. */
  detected: Record<MockProvider, ToolState>;
  settings: Settings;
  tests: Record<string, BackendTest>;
  pairingCode: string | null;
};

const KEY = "vv:mock-system";

function freshSettings(scenario: MockScenario): Settings {
  const demo = scenario === "demo";
  return {
    default_brain: demo ? "claude" : null,
    default_engine: demo ? "mock" : null,
    allow_web_research: true,
    setup_completed_at: demo ? "2026-11-01T09:00:00Z" : null,
    providers: {},
    lan: { enabled: false },
  };
}

function initial(scenario: MockScenario): SystemState {
  return {
    scenario,
    machine: { ...MACHINES[scenario] },
    detected: { ...MACHINES[scenario] },
    settings: freshSettings(scenario),
    tests: {},
    pairingCode: null,
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function load(): SystemState {
  const fromUrl = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("vvScenario");
  if (fromUrl && (MOCK_SCENARIOS as readonly string[]).includes(fromUrl)) return initial(fromUrl as MockScenario);
  try {
    const saved = storage()?.getItem(KEY);
    if (saved) {
      const state = JSON.parse(saved) as SystemState;
      // Starting up re-detects, like restarting the API.
      return { ...state, detected: { ...state.machine } };
    }
  } catch {
    // Corrupt or unavailable storage: start from the demo.
  }
  return initial("demo");
}

let system: SystemState | null = null;

function sys(): SystemState {
  if (!system) {
    system = load();
    save();
  }
  return system;
}

function save() {
  try {
    storage()?.setItem(KEY, JSON.stringify(system));
  } catch {
    // Private windows can refuse storage; the scenario then lasts until the next reload.
  }
}

const clone = <T,>(v: T): T => structuredClone(v);

// Read `?vvScenario=` before any client-side redirect drops it.
if (typeof window !== "undefined") sys();

function loggedIn(id: MockProvider, state: ToolState): boolean | null {
  if (state === "missing") return null;
  if (sys().scenario === "demo" && id in DEMO_LOGIN) return DEMO_LOGIN[id]!;
  if (!TOOLS[id].reportsLogin) return null;
  return state === "ready";
}

function detail(id: MockProvider, state: ToolState): string | null {
  const tool = TOOLS[id];
  if (state === "missing") {
    return id === "mflux" ? "mflux is not installed. It runs on Apple Silicon: `uv tool install mflux`." : `\`${tool.bin}\` was not found on your PATH.`;
  }
  if (state === "signed-out" && loggedIn(id, state) === false) return `Installed but signed out. Run \`${tool.login}\`.`;
  return null;
}

function status(id: MockProvider, kind: "brain" | "engine"): BackendStatus {
  const tool = TOOLS[id];
  const state = sys().detected[id];
  const available = state !== "missing";
  return {
    id,
    label: kind === "engine" ? (tool.engineLabel ?? tool.label) : tool.label,
    kind,
    available,
    logged_in: loggedIn(id, state),
    version: available ? tool.version : null,
    detail: detail(id, state),
    ...(kind === "engine" ? { caps: tool.caps ?? null } : {}),
    install: tool.install,
    login: tool.login,
    used_for: tool.used_for,
    cost_note: tool.cost_note,
    last_test: sys().tests[`${kind}:${id}`] ?? null,
  };
}

const usable = (b: BackendStatus) => b.available && b.logged_in !== false;

function pick(list: BackendStatus[], preferred: string | null, order: string[]) {
  const ready = list.filter(usable).map((b) => b.id);
  if (preferred && ready.includes(preferred)) return preferred;
  return order.find((id) => ready.includes(id)) ?? null;
}

/** `GET /api/system/backends`, from the last detection. */
export function currentBackends(): Backends {
  const demo = sys().scenario === "demo";
  const brains = PROVIDERS.filter((p) => TOOLS[p].brain).map((p) => status(p, "brain"));
  const engines = PROVIDERS.filter((p) => TOOLS[p].engine).map((p) => status(p, "engine"));
  if (demo) {
    brains.push({ ...MOCK_BRAIN, last_test: sys().tests["brain:mock"] ?? null });
    engines.push({ ...MOCK_ENGINE, last_test: sys().tests["engine:mock"] ?? null });
  }
  const { default_brain, default_engine } = sys().settings;
  return {
    brains,
    engines,
    defaults: { brain: pick(brains, default_brain, BRAIN_ORDER), engine: pick(engines, default_engine, ENGINE_ORDER) },
    thresholds: { structure_ok: LOW_STRUCTURE_SCORE },
    internal: { layout_guide: LAYOUT_GUIDE },
  };
}

export function refreshBackends(): Backends {
  sys().detected = { ...sys().machine };
  save();
  return currentBackends();
}

export function getSettings(): Settings {
  return clone(sys().settings);
}

export function updateSettings(patch: SettingsPatch): Settings {
  const s = sys().settings;
  const { providers, lan, ...rest } = patch;
  Object.assign(s, rest);
  if (providers) {
    for (const [key, value] of Object.entries(providers) as [keyof Settings["providers"], object][]) {
      s.providers[key] = { ...s.providers[key], ...value };
    }
  }
  if (lan) {
    s.lan = { ...s.lan, ...lan };
    sys().pairingCode = s.lan.enabled ? (sys().pairingCode ?? newCode()) : null;
  }
  save();
  return getSettings();
}

/** Image engines that cost money ask first; the mock engine and local mflux are free. */
const FREE_ENGINES = new Set(["mock", "mflux"]);

export function testBackend(kind: "brain" | "engine", id: string, confirmCredits: boolean): BackendTestResult {
  const list = kind === "brain" ? currentBackends().brains : currentBackends().engines;
  const backend = list.find((b) => b.id === id);
  if (!backend) throw new ApiError(404, `Unknown ${kind} “${id}”.`);
  if (kind === "engine" && !FREE_ENGINES.has(id) && !confirmCredits) {
    throw new ApiError(422, "An image test uses credits. Send confirm_credits: true to run it.");
  }
  const provider = PROVIDERS.find((p) => p === id);
  const state = provider ? sys().machine[provider] : "ready";
  const tool = provider ? TOOLS[provider] : null;
  let result: BackendTestResult;
  if (state === "missing") {
    result = { ok: false, seconds: 0.1, detail: `\`${tool?.bin ?? id}\` isn't installed on this computer.` };
  } else if (state === "signed-out") {
    result = { ok: false, seconds: 1.4, detail: `Not signed in. Run \`${tool?.login ?? "login"}\`, then test again.` };
  } else if (kind === "brain") {
    result = { ok: true, seconds: 1.2, detail: '{"ok": true}' };
  } else {
    result = { ok: true, seconds: id === "mflux" ? 48.3 : 6.4, detail: "Made a small test image.", sample_url: SAMPLES["ballroom-a"].looks.blush!.url };
  }
  sys().tests[`${kind}:${id}`] = { ok: result.ok, at: new Date().toISOString(), seconds: result.seconds, detail: result.detail };
  save();
  return result;
}

export function setupStatus(): SetupStatus {
  const backends = currentBackends();
  const brain = backends.brains.some(usable);
  const engine = backends.engines.some(usable);
  const defaults = Boolean(sys().settings.setup_completed_at);
  const missing: SetupMissing[] = [];
  if (!brain) missing.push("brain");
  if (!engine) missing.push("engine");
  if (!defaults) missing.push("defaults");
  return { complete: missing.length === 0, missing, steps: { tools: brain && engine, defaults, try_it: defaults } };
}

const LAN_URL = "http://192.168.1.24:3000";

function newCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

export function lanInfo(): LanInfo {
  const { enabled } = sys().settings.lan;
  if (!enabled) return { enabled: false, url: null, qr_svg: null, pairing_required: true, pairing_code: null };
  return { enabled: true, url: LAN_URL, qr_svg: fakeQr(LAN_URL), pairing_required: true, pairing_code: sys().pairingCode };
}

export function pairDevice(code: string) {
  if (!sys().settings.lan.enabled) throw new ApiError(409, "Phone access is off. Turn it on in Setup on the computer.");
  if (code.trim() !== sys().pairingCode) throw new ApiError(403, "That code didn't match.");
  // One-time: the next phone gets a new code.
  sys().pairingCode = newCode();
  save();
}

/** A QR-looking SVG (finder squares plus a pattern seeded by the URL). The real API sends a scannable one. */
function fakeQr(text: string) {
  const n = 25;
  let seed = [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 1;
  const cells: string[] = [];
  const finder = (x: number, y: number) =>
    `<path d="M${x} ${y}h7v7h-7z M${x + 1} ${y + 1}v5h5v-5z" fill-rule="evenodd"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!inFinder(x, y) && rand()) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><g fill="#111">${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}${cells.join("")}</g></svg>`;
}

/** `window.__vvMock` hooks for end-to-end tests. */
export const systemHooks = {
  setScenario(name: MockScenario) {
    if (!MOCK_SCENARIOS.includes(name)) throw new Error(`Unknown scenario ${name}`);
    system = initial(name);
    save();
  },
  install(provider: MockProvider, state: ToolState = "ready") {
    sys().machine[provider] = state;
    save();
  },
  settings: getSettings,
};
