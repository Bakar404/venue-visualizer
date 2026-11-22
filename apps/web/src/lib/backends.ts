import type { Backends, BackendStatus } from "@/lib/types";

/** Output is always a photograph. Internal helpers (the layout guide) are never offered as an engine. */
const INTERNAL_ENGINES = new Set(["scene3d"]);

export const ENGINE_LABELS: Record<string, string> = {
  copilot: "Copilot image",
  codex: "Codex image",
  mflux: "Local FLUX (mflux)",
  mock: "Mock (dev)",
};

/** Brains that ship with web search/fetch tools (docs/architecture.md, "Find a real venue"). */
const WEB_BRAINS = new Set(["claude", "copilot", "codex", "kimi"]);

export function userEngines(engines: BackendStatus[]): BackendStatus[] {
  return engines
    .filter((e) => !INTERNAL_ENGINES.has(e.id) && (e.id === "mock" || e.caps?.photoreal !== false))
    .map((e) => ({ ...e, label: ENGINE_LABELS[e.id] ?? e.label }));
}

export function canBrowse(brain: BackendStatus): boolean {
  return WEB_BRAINS.has(brain.id);
}

type Readiness = Pick<BackendStatus, "available" | "logged_in"> & { last_test?: BackendStatus["last_test"] };

export type BackendState = "ready" | "likely" | "failed" | "signed_out" | "missing";

/**
 * The one readiness rule, mirroring services/api/readiness.py (used by `GET /api/system/setup` and `make doctor`).
 * ready: installed and signed in, or its last test passed. likely: installed, sign-in unknown and no failed test.
 */
export function backendState(b: Readiness): BackendState {
  if (!b.available) return "missing";
  if (b.logged_in === false) return "signed_out";
  const ok = b.last_test?.ok;
  if (b.logged_in === true || ok === true) return "ready";
  return ok === false ? "failed" : "likely";
}

/** Can be offered as a choice (defaults, Studio pickers, the default engine). */
export const isReady = (b: Readiness) => backendState(b) === "ready";
/** Will probably work, but nobody has checked: shown, never offered, with "Run Test first". */
export const isLikely = (b: Readiness) => backendState(b) === "likely";

export type SetupPill = "Not installed" | "Installed, not signed in" | "Ready" | "Unknown";

/** The status pill on the setup page (docs/onboarding-and-mobile.md). Likely and failed both read "Unknown". */
export function setupPill(b: Readiness): SetupPill {
  const state = backendState(b);
  if (state === "missing") return "Not installed";
  if (state === "signed_out") return "Installed, not signed in";
  return state === "ready" ? "Ready" : "Unknown";
}

const SHORT_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  copilot: "Copilot",
  kimi: "Kimi Code",
  mflux: "Local FLUX",
  mock: "Mock",
};

/** "Claude Code", "Copilot", … for the header chip. */
export function shortName(id: string): string {
  return SHORT_NAMES[id] ?? id;
}

/** "Copilot will probably work. Run Test to be sure." for likely tools; null when there are none. */
export function likelyNote(ids: readonly string[]): string | null {
  const names = [...new Set(ids)].filter((id) => id !== "mock").map(shortName);
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list} will probably work. Run Test to be sure.`;
}

/** Applied to every `/api/system/backends` response before the UI sees it. */
export function normalizeBackends(data: Backends): Backends {
  const engines = userEngines(data.engines);
  // Never invent a default: no READY engine means `null`, and the UI shows how to get one ready.
  const ready = engines.filter(isReady);
  const engine = ready.some((e) => e.id === data.defaults.engine) ? data.defaults.engine : (ready[0]?.id ?? null);
  return { ...data, engines, defaults: { ...data.defaults, engine } };
}
