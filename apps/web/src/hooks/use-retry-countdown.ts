"use client";

import { useEffect, useState } from "react";

/** Whole seconds left until `until` (epoch ms), ticking down; 0 once it has passed, null when there's nothing to wait for. */
export function useSecondsLeft(until: number | null): number | null {
  // The clock is read only in effects: reading it during render makes Next refuse to prerender the page.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const t0 = Date.now();
      setNow(t0);
      if (t0 >= until) clearInterval(t);
    };
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [until]);
  if (until === null || now === null) return null;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * After a 429 the API's `Retry-After` says how long to wait; this counts it down and returns null when it's over.
 * `start` begins a wait of `seconds`.
 */
export function useRetryCountdown() {
  const [wait, setWait] = useState<{ until: number; left: number; total: number } | null>(null);
  const waiting = wait !== null;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      setWait((w) => {
        if (!w) return null;
        const left = Math.ceil((w.until - Date.now()) / 1000);
        if (left <= 0) return null;
        return left === w.left ? w : { ...w, left };
      });
    }, 250);
    return () => clearInterval(t);
  }, [waiting]);
  const start = (seconds: number) => {
    const total = Math.max(1, Math.ceil(seconds));
    setWait({ until: Date.now() + total * 1000, left: total, total });
  };
  return { wait, start };
}
