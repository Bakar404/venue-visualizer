"use client";

import { useSyncExternalStore } from "react";

/** Actions the open Studio exposes to the ⌘K palette. Registered on mount, cleared on unmount. */
export type StudioActions = {
  spaceId: string;
  renderAll: () => void;
  saveLook: () => void;
  makeVariation: () => void;
  exportLook: (() => void) | null;
  compareHref: string;
};

let current: StudioActions | null = null;
const listeners = new Set<() => void>();

export function setStudioActions(actions: StudioActions | null) {
  current = actions;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStudioActions() {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
