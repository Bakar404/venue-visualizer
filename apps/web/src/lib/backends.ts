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

/** Installed and not known to be signed out. Copilot and Kimi can't report a login (null), so they count until a test fails. */
export function isUsable(b: Pick<BackendStatus, "available" | "logged_in">): boolean {
  return b.available && b.logged_in !== false;
}

export type SetupPill = "Not installed" | "Installed, not signed in" | "Ready" | "Unknown";

/** The status pill on the setup page (docs/onboarding-and-mobile.md). */
export function setupPill(b: Pick<BackendStatus, "available" | "logged_in" | "last_test">): SetupPill {
  if (!b.available) return "Not installed";
  if (b.logged_in === false) return "Installed, not signed in";
  if (b.logged_in === true || b.last_test?.ok) return "Ready";
  return "Unknown";
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

/** Applied to every `/api/system/backends` response before the UI sees it. */
export function normalizeBackends(data: Backends): Backends {
  const engines = userEngines(data.engines);
  // Never invent a default: no usable engine means `null`, and the UI shows how to install one.
  const usable = engines.filter(isUsable);
  const engine = usable.some((e) => e.id === data.defaults.engine) ? data.defaults.engine : (usable[0]?.id ?? null);
  return { ...data, engines, defaults: { ...data.defaults, engine } };
}
