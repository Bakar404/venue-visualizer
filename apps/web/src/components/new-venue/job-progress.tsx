"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Ticks once a second while `active`. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

type Props = {
  title: string;
  job: Job | undefined;
  startedAt: number;
  /** Rotated every 8 s when the worker doesn't send its own status line. */
  steps: string[];
  /** Honest expectation, e.g. "This usually takes 2 to 5 minutes." */
  expectation: string;
  onCancel?: () => void;
  className?: string;
};

/**
 * Calm progress for long agent jobs: the worker's status line (or a rotating one), real elapsed time,
 * and a determinate bar only when the job reports progress. Status changes are announced politely.
 */
export function JobProgress({ title, job, startedAt, steps, expectation, onCancel, className }: Props) {
  const running = !job || job.status === "queued" || job.status === "running";
  const now = useNow(running);
  const elapsed = now - startedAt;
  const line = job?.message || (job?.status === "queued" ? "Waiting for the brain to start…" : steps[Math.floor(elapsed / 8000) % steps.length]);
  const progress = job && job.progress > 0 ? job.progress : null;

  return (
    <div className={cn("rounded-2xl border bg-card p-6 sm:p-8", className)} aria-busy={running}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-3xl">{title}</h2>
        <p className="text-sm text-muted-foreground tabular">
          <span className="sr-only">Elapsed time </span>
          {formatElapsed(elapsed)}
        </p>
      </div>
      <div
        className="relative mt-5 h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
      >
        {progress === null ? (
          <div className="absolute inset-y-0 left-0 w-2/5 animate-indeterminate rounded-full bg-brand/70 motion-reduce:w-full motion-reduce:animate-none motion-reduce:bg-brand/25" />
        ) : (
          <div
            className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-brand transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${progress})` }}
          />
        )}
      </div>
      <p className="mt-4 min-h-6" aria-live="polite" aria-atomic>
        {line}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{expectation} You can keep this tab open and come back.</p>
      {onCancel && (
        <Button variant="ghost" size="sm" className="mt-4 -ml-2.5" onClick={onCancel}>
          Start over
        </Button>
      )}
    </div>
  );
}
