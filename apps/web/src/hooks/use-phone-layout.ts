"use client";

import { useSyncExternalStore } from "react";

/** Below Tailwind's `lg` breakpoint (64rem) the Studio shows one pane at a time behind a tab bar. */
const QUERY = "(width < 64rem)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
