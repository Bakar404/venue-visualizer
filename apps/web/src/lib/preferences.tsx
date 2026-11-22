"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

import { useBackends } from "@/lib/queries";

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
  engine: string;
  brain: string;
  setEngine: (id: string) => void;
  setBrain: (id: string) => void;
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

/** Engine and brain choice, persisted in localStorage and falling back to the API's defaults. */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const stored = useSyncExternalStore(subscribe, read, () => EMPTY);
  const { data } = useBackends();

  const engine = useMemo(() => {
    const available = data?.engines.filter((e) => e.available).map((e) => e.id) ?? [];
    if (stored.engine && (!data || available.includes(stored.engine))) return stored.engine;
    return data?.defaults.engine ?? "mock";
  }, [data, stored.engine]);

  const brain = useMemo(() => {
    const available = data?.brains.filter((b) => b.available).map((b) => b.id) ?? [];
    if (stored.brain && (!data || available.includes(stored.brain))) return stored.brain;
    return data?.defaults.brain ?? "mock";
  }, [data, stored.brain]);

  const setEngine = useCallback((id: string) => write({ ...read(), engine: id }), []);
  const setBrain = useCallback((id: string) => write({ ...read(), brain: id }), []);

  const value = useMemo(() => ({ engine, brain, setEngine, setBrain }), [engine, brain, setEngine, setBrain]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside PreferencesProvider");
  return ctx;
}
