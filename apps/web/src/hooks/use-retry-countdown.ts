"use client";

import { useEffect, useState } from "react";

/** Whole seconds left until `until` (epoch ms), ticking down; 0 once it has passed, null when there's nothing to wait for. */
export function useSecondsLeft(until: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(t);
    };
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [until]);
  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
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
