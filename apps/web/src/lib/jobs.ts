"use client";

import { useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Job, JobStatus } from "@/lib/types";

/**
 * Client-side job tracker. Jobs started in this tab are polled every 1.5 s while queued or running
 * (see docs/api.md). Jobs started together form a group that resolves into a single toast.
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

type Group = JobGroupMeta & { id: string; jobIds: string[]; settled: Set<string>; failures: string[] };

const groups = new Map<string, Group>();
const groupOfJob = new Map<string, string>();
const jobOfRender = new Map<string, string>();
const jobOfSpaceBase = new Map<string, string>();
const notified = new Set<string>();
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

export const isActive = (status: JobStatus | undefined) => status === "queued" || status === "running";
const isTerminal = (status: JobStatus) => !isActive(status);

export function trackJobs(
  qc: QueryClient,
  jobs: Array<{ job: Job; renderId?: string; spaceId?: string }>,
  meta: JobGroupMeta,
) {
  if (jobs.length === 0) return;
  const id = crypto.randomUUID();
  groups.set(id, { ...meta, id, jobIds: jobs.map((j) => j.job.id), settled: new Set(), failures: [] });
  for (const { job, renderId, spaceId } of jobs) {
    groupOfJob.set(job.id, id);
    if (renderId) jobOfRender.set(renderId, job.id);
    if (spaceId) jobOfSpaceBase.set(spaceId, job.id);
    qc.setQueryData(qk.job(job.id), job);
  }
  toast.loading(meta.pending, { id });
  emit();
}

function settle(qc: QueryClient, job: Job) {
  if (notified.has(job.id)) return;
  notified.add(job.id);
  const groupId = groupOfJob.get(job.id);
  const group = groupId ? groups.get(groupId) : undefined;
  if (!group) return;

  group.settled.add(job.id);
  if (job.status === "failed") group.failures.push(job.error ?? "Unknown error");
  if (group.lookId) void qc.invalidateQueries({ queryKey: qk.look(group.lookId) });
  if (group.spaceId) {
    void qc.invalidateQueries({ queryKey: qk.looks(group.spaceId) });
    void qc.invalidateQueries({ queryKey: qk.space(group.spaceId) });
  }
  if (group.settled.size < group.jobIds.length) return;

  if (group.failures.length === 0) {
    toast.success(group.done, { id: group.id });
  } else if (group.failures.length === group.jobIds.length) {
    toast.error(group.failed, { id: group.id, description: group.failures[0] });
  } else {
    toast.warning(`${group.done}, with ${group.failures.length} failed`, {
      id: group.id,
      description: group.failures[0],
    });
  }
  emit();
}

function jobQuery(qc: QueryClient, id: string) {
  return {
    queryKey: qk.job(id),
    queryFn: async () => {
      const job = await api.getJob(id);
      if (isTerminal(job.status)) settle(qc, job);
      return job;
    },
    enabled: Boolean(id),
    refetchInterval: (q: { state: { data?: Job } }) => (isActive(q.state.data?.status) ? 1500 : false),
  };
}

export function useJob(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery(jobQuery(qc, id ?? ""));
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

/** Mounted once in the app shell so toasts arrive even after navigating away from the studio. */
export function JobWatcher() {
  const qc = useQueryClient();
  useTrackerVersion();
  useQueries({ queries: trackedIds.map((id) => jobQuery(qc, id)) });
  return null;
}
