"use client";

import { useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { ApiError, api } from "@/lib/api";
import { SETTLED_TTL_MS, isActive, isOverdue, isTerminal, lostJob, summarizeGroup } from "@/lib/job-logic";
import { qk } from "@/lib/queries";
import type { Job } from "@/lib/types";

export { isActive, isTerminal };

/**
 * Client-side job tracker. Jobs started in this tab are polled every 1.5 s while queued or running
 * (see docs/api.md). Jobs started together form a group that resolves into a single toast. Groups
 * that run past their kind's deadline offer a cancel button; settled groups are forgotten after 5 minutes.
 */
export type JobGroupMeta = {
  /** Shown while running, e.g. "Rendering 2 photos". */
  pending: string;
  /** Shown on success, e.g. "Renders ready". */
  done: string;
  /** Shown on failure, e.g. "Render failed". */
  failed: string;
  spaceId?: string;
  lookId?: string;
};

type Group = JobGroupMeta & {
  id: string;
  jobIds: string[];
  outcomes: Map<string, Pick<Job, "status" | "error">>;
  settled: boolean;
  overdue: boolean;
};

const groups = new Map<string, Group>();
const groupOfJob = new Map<string, string>();
const jobOfRender = new Map<string, string>();
const jobOfSpaceBase = new Map<string, string>();
/** When this tab first saw each job; the deadline runs from here. */
const seenAt = new Map<string, number>();
let trackedIds: string[] = [];
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  trackedIds = [...groupOfJob.keys()];
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function markSeen(id: string, at = Date.now()) {
  if (!seenAt.has(id)) seenAt.set(id, at);
}

export function trackJobs(
  qc: QueryClient,
  jobs: Array<{ job: Job; renderId?: string; spaceId?: string }>,
  meta: JobGroupMeta,
) {
  if (jobs.length === 0) return;
  const id = crypto.randomUUID();
  const group: Group = { ...meta, id, jobIds: jobs.map((j) => j.job.id), outcomes: new Map(), settled: false, overdue: false };
  groups.set(id, group);
  for (const { job, renderId, spaceId } of jobs) {
    groupOfJob.set(job.id, id);
    markSeen(job.id);
    if (renderId) jobOfRender.set(renderId, job.id);
    if (spaceId) jobOfSpaceBase.set(spaceId, job.id);
    qc.setQueryData(qk.job(job.id), job);
  }
  toast.loading(meta.pending, { id });
  emit();
  // Jobs can come back already finished (e.g. VV_INLINE_JOBS=1); settle them now rather than waiting for a poll.
  for (const { job } of jobs) if (isTerminal(job.status)) settle(qc, job);
}

function forget(group: Group) {
  const ids = new Set(group.jobIds);
  for (const jobId of ids) {
    groupOfJob.delete(jobId);
    seenAt.delete(jobId);
  }
  for (const [renderId, jobId] of jobOfRender) if (ids.has(jobId)) jobOfRender.delete(renderId);
  for (const [spaceId, jobId] of jobOfSpaceBase) if (ids.has(jobId)) jobOfSpaceBase.delete(spaceId);
  groups.delete(group.id);
  emit();
}

function settle(qc: QueryClient, job: Job) {
  const groupId = groupOfJob.get(job.id);
  const group = groupId ? groups.get(groupId) : undefined;
  if (!group || group.settled || group.outcomes.has(job.id)) return;

  group.outcomes.set(job.id, { status: job.status, error: job.error });
  if (group.lookId) void qc.invalidateQueries({ queryKey: qk.look(group.lookId) });
  if (group.spaceId) {
    void qc.invalidateQueries({ queryKey: qk.looks(group.spaceId) });
    void qc.invalidateQueries({ queryKey: qk.space(group.spaceId) });
  }
  const outcome = summarizeGroup(group.jobIds.length, group.outcomes.values());
  if (outcome.type === "pending") return;

  group.settled = true;
  const opts = { id: group.id, action: undefined, cancel: undefined };
  if (outcome.type === "done") toast.success(group.done, opts);
  else if (outcome.type === "cancelled") toast.info("Cancelled", { ...opts, description: group.pending });
  else if (outcome.type === "failed") toast.error(group.failed, { ...opts, description: outcome.error });
  else if (outcome.done === 0) toast.error(group.failed, { ...opts, description: outcome.error ?? `${outcome.cancelled} cancelled` });
  else {
    const parts = [outcome.failed && `${outcome.failed} failed`, outcome.cancelled && `${outcome.cancelled} cancelled`].filter(Boolean);
    toast.warning(`${group.done}, with ${parts.join(" and ")}`, { ...opts, description: outcome.error ?? undefined });
  }
  setTimeout(() => forget(group), SETTLED_TTL_MS);
  emit();
}

/** `POST /api/jobs/{id}/cancel`. Queued jobs cancel at once; running ones stop when the worker notices. */
export async function cancelJob(qc: QueryClient, id: string): Promise<Job> {
  const job = await api.cancelJob(id);
  qc.setQueryData(qk.job(id), job);
  if (isTerminal(job.status)) settle(qc, job);
  return job;
}

async function cancelGroup(qc: QueryClient, group: Group) {
  const active = group.jobIds.filter((id) => !group.outcomes.has(id));
  const results = await Promise.allSettled(active.map((id) => cancelJob(qc, id)));
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) toast.error("Couldn't cancel", { description: failure.reason instanceof Error ? failure.reason.message : String(failure.reason) });
}

function jobQuery(qc: QueryClient, id: string) {
  return {
    queryKey: qk.job(id),
    queryFn: async () => {
      let job: Job;
      try {
        job = await api.getJob(id);
      } catch (e) {
        // The job is gone (API restart, deleted venue): settle it as failed so nothing spins forever.
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
        job = lostJob(id, qc.getQueryData<Job>(qk.job(id))?.kind);
      }
      if (isTerminal(job.status)) settle(qc, job);
      return job;
    },
    enabled: Boolean(id),
    refetchInterval: (q: { state: { data?: Job } }) => (isActive(q.state.data?.status) ? 1500 : false),
  };
}

export function useJob(id: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (id) markSeen(id);
  }, [id]);
  return useQuery(jobQuery(qc, id ?? ""));
}

/** True once an active job has run past its kind's deadline (render 10 min, research 15, video 20). */
export function useJobOverdue(job: Job | undefined, startedAt?: number): boolean {
  const active = isActive(job?.status);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [active]);
  if (!job) return false;
  return isOverdue(job, startedAt ?? seenAt.get(job.id) ?? now, now);
}

function useTrackerVersion() {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

export function useRenderJobId(renderId: string | undefined) {
  useTrackerVersion();
  return renderId ? jobOfRender.get(renderId) : undefined;
}

export function useBaseJobId(spaceId: string) {
  useTrackerVersion();
  return jobOfSpaceBase.get(spaceId);
}

/** Whether this tab is still waiting on any job group it started for the Look. */
export function useLookHasActiveJobs(lookId: string | undefined) {
  useTrackerVersion();
  if (!lookId) return false;
  for (const g of groups.values()) if (g.lookId === lookId && !g.settled) return true;
  return false;
}

/** Mounted once in the app shell so toasts arrive even after navigating away from the studio. */
export function JobWatcher() {
  const qc = useQueryClient();
  useTrackerVersion();
  useQueries({ queries: trackedIds.map((id) => jobQuery(qc, id)) });

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const group of groups.values()) {
        if (group.settled || group.overdue) continue;
        const late = group.jobIds.some((id) => isOverdue(qc.getQueryData<Job>(qk.job(id)), seenAt.get(id) ?? now, now));
        if (!late) continue;
        group.overdue = true;
        toast.loading("Still working…", {
          id: group.id,
          description: `${group.pending} is taking longer than usual.`,
          action: { label: "Cancel", onClick: () => void cancelGroup(qc, group) },
        });
      }
    };
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [qc]);

  return null;
}
