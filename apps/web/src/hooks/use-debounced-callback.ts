"use client";

import { useEffect, useState } from "react";

import { createDebouncer, type Debounced } from "@/hooks/debouncer";

export type { Debounced };

/**
 * Returns a stable debounced function with `cancel()` and `flush()`.
 *
 * By default a pending call is dropped on unmount. With `flushOnUnmount` (use it for anything that
 * persists user work) it runs instead, and also when the page is hidden or unloaded, so the last
 * edit isn't lost when the user navigates away or closes the tab.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
  { flushOnUnmount = false }: { flushOnUnmount?: boolean } = {},
): Debounced<A> {
  const [debounced] = useState(() => createDebouncer<A>(fn, delay));

  useEffect(() => {
    debounced.setFn(fn);
  }, [debounced, fn]);

  useEffect(() => {
    if (!flushOnUnmount) return () => debounced.cancel();
    const onHide = () => {
      if (document.visibilityState === "hidden") debounced.flush();
    };
    const onPageHide = () => debounced.flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      debounced.flush();
    };
  }, [debounced, flushOnUnmount]);

  return debounced;
}
