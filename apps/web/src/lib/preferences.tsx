"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

import { isReady } from "@/lib/backends";
import { useBackends, useSettings } from "@/lib/queries";
import type { BackendStatus } from "@/lib/types";

type Prefs = { engine: string | null; brain: string | null };
const KEY = "vv:prefs";
const EMPTY: Prefs = { engine: null, brain: null };

let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function read(): Prefs {
  if (cache) return cache;
  try {
    cache = { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    cache = EMPTY;
  }
  return cache!;
}

function write(next: Prefs) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private windows; the choice still applies for this tab.
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

type PreferencesValue = {
  /** Null while backends load, or when no usable engine exists. Never falls back to "mock". */
  engine: string | null;
  /** Null while backends load, or when no brain is available. */
  brain: string | null;
  setEngine: (id: string) => void;
  setBrain: (id: string) => void;
  /** The chosen engine or brain when it has stopped working, so the UI can explain why and link to setup. */
  unavailable: { engine: BackendStatus | null; brain: BackendStatus | null };
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

/** Engine and brain choice, persisted in localStorage and falling back to the API's defaults. */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const stored = useSyncExternalStore(subscribe, read, () => EMPTY);
  const { data } = useBackends();
  const { data: settings } = useSettings();

  const engine = useMemo(() => {
    if (!data) return null;
    const available = data.engines.filter(isReady).map((e) => e.id);
    if (stored.engine && available.includes(stored.engine)) return stored.engine;
    return data.defaults.engine && available.includes(data.defaults.engine) ? data.defaults.engine : null;
  }, [data, stored.engine]);

  const brain = useMemo(() => {
    if (!data) return null;
    const available = data.brains.filter(isReady).map((b) => b.id);
    if (stored.brain && available.includes(stored.brain)) return stored.brain;
    const preferred = data.defaults.brain;
    return preferred && available.includes(preferred) ? preferred : (available[0] ?? null);
  }, [data, stored.brain]);

  const setEngine = useCallback((id: string) => write({ ...read(), engine: id }), []);
  const setBrain = useCallback((id: string) => write({ ...read(), brain: id }), []);

  const unavailable = useMemo(() => {
    const broken = (list: BackendStatus[] | undefined, ...chosen: (string | null | undefined)[]) => {
      const id = chosen.find(Boolean);
      const b = id ? list?.find((x) => x.id === id) : undefined;
      return b && !isReady(b) ? b : null;
    };
    return {
      engine: broken(data?.engines, stored.engine, settings?.default_engine),
      brain: broken(data?.brains, stored.brain, settings?.default_brain),
    };
  }, [data, settings, stored.engine, stored.brain]);

  const value = useMemo(
    () => ({ engine, brain, setEngine, setBrain, unavailable }),
    [engine, brain, setEngine, setBrain, unavailable],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside PreferencesProvider");
  return ctx;
}
