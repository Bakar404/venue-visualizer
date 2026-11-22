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

/** Applied to every `/api/system/backends` response before the UI sees it. */
export function normalizeBackends(data: Backends): Backends {
  const engines = userEngines(data.engines);
  // Never invent a default: no usable engine means `null`, and the UI shows how to install one.
  const usable = engines.filter((e) => e.available);
  const engine = usable.some((e) => e.id === data.defaults.engine) ? data.defaults.engine : (usable[0]?.id ?? null);
  return { ...data, engines, defaults: { ...data.defaults, engine } };
}
