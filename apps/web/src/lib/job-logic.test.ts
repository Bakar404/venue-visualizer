import { describe, expect, it } from "vitest";

import { isOverdue, JOB_DEADLINE_MS, LOST_JOB_ERROR, lostJob, summarizeGroup } from "@/lib/job-logic";

describe("summarizeGroup", () => {
  it("waits until every job has settled", () => {
    expect(summarizeGroup(2, [{ status: "done", error: null }])).toEqual({ type: "pending" });
  });

  it("settles on already-finished jobs", () => {
    expect(summarizeGroup(2, [{ status: "done", error: null }, { status: "done", error: null }])).toEqual({ type: "done" });
  });

  it("treats all-cancelled as cancelled, not success", () => {
    expect(summarizeGroup(1, [{ status: "cancelled", error: null }])).toEqual({ type: "cancelled" });
  });

  it("reports the first failure", () => {
    expect(summarizeGroup(2, [{ status: "failed", error: "boom" }, { status: "failed", error: "again" }])).toEqual({ type: "failed", error: "boom" });
  });

  it("reports mixed outcomes as partial", () => {
    expect(
      summarizeGroup(3, [
        { status: "done", error: null },
        { status: "failed", error: null },
        { status: "cancelled", error: null },
      ]),
    ).toEqual({ type: "partial", done: 1, failed: 1, cancelled: 1, error: "Unknown error" });
  });
});

describe("isOverdue", () => {
  it("uses the deadline for the job kind", () => {
    const research = { kind: "venue_research", status: "running" } as const;
    expect(isOverdue(research, 0, JOB_DEADLINE_MS.render)).toBe(false);
    expect(isOverdue(research, 0, 15 * 60_000)).toBe(true);
    expect(isOverdue({ kind: "video_ingest", status: "queued" }, 0, 19 * 60_000)).toBe(false);
  });

  it("never flags settled jobs", () => {
    expect(isOverdue({ kind: "render", status: "done" }, 0, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("lostJob", () => {
  it("turns a 404 into a failed job with a retry message", () => {
    expect(lostJob("j1", "venue_research")).toMatchObject({ id: "j1", kind: "venue_research", status: "failed", error: LOST_JOB_ERROR });
  });
});
