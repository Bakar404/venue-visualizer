import type { Job, JobKind, JobStatus } from "@/lib/types";

/** After this long a queued/running job shows "Still working…" with a cancel button instead of spinning forever. */
export const JOB_DEADLINE_MS: Record<JobKind, number> = {
  render: 10 * 60_000,
  generate_base: 10 * 60_000,
  venue_research: 15 * 60_000,
  video_ingest: 20 * 60_000,
};

/** Settled jobs are forgotten by the tracker after this long. */
export const SETTLED_TTL_MS = 5 * 60_000;

export const isActive = (status: JobStatus | undefined) => status === "queued" || status === "running";
export const isTerminal = (status: JobStatus | undefined) => status === "done" || status === "failed" || status === "cancelled";

export function isOverdue(job: Pick<Job, "kind" | "status"> | undefined, startedAt: number, now: number): boolean {
  if (!job || !isActive(job.status)) return false;
  return now - startedAt >= (JOB_DEADLINE_MS[job.kind] ?? JOB_DEADLINE_MS.render);
}

export const LOST_JOB_ERROR = "This job no longer exists. The API may have restarted. Try again or start over.";

/** What a 404 from `GET /api/jobs/{id}` turns into, so every caller settles and offers a retry. */
export function lostJob(id: string, kind: JobKind = "render"): Job {
  return { id, kind, status: "failed", progress: 0, cancel_requested: false, error: LOST_JOB_ERROR, error_status: 404, message: null, result: null };
}

export type GroupOutcome =
  | { type: "pending" }
  | { type: "done" }
  | { type: "cancelled" }
  | { type: "failed"; error: string }
  | { type: "partial"; done: number; failed: number; cancelled: number; error: string | null };

/** Resolves a group of jobs started together into one outcome once every job has a terminal status. */
export function summarizeGroup(total: number, settled: Iterable<Pick<Job, "status" | "error">>): GroupOutcome {
  let done = 0;
  let failed = 0;
  let cancelled = 0;
  let error: string | null = null;
  for (const job of settled) {
    if (job.status === "done") done++;
    else if (job.status === "cancelled") cancelled++;
    else if (job.status === "failed") {
      failed++;
      error ??= job.error ?? "Unknown error";
    }
  }
  if (done + failed + cancelled < total) return { type: "pending" };
  if (done === total) return { type: "done" };
  if (cancelled === total) return { type: "cancelled" };
  if (done === 0 && cancelled === 0) return { type: "failed", error: error ?? "Unknown error" };
  return { type: "partial", done, failed, cancelled, error };
}
