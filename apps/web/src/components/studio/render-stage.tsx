"use client";

import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion } from "motion/react";
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { CompareSlider } from "@/components/compare-slider";
import { JobOverdueNotice } from "@/components/job-overdue";
import { PhotoCredit } from "@/components/photo-credit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isActive, useJob, useJobOverdue, useRenderJobId } from "@/lib/jobs";
import { LOW_STRUCTURE_SCORE, progressFraction } from "@/lib/spec";
import type { Look, Photo, Render } from "@/lib/types";

type Props = {
  photo: Photo;
  photoLabel: string;
  look: Look | undefined;
  render: Render | undefined;
  onRegenerate: () => void;
  regenerating: boolean;
  /** E.g. no image engine available. */
  regenerateDisabled?: boolean;
  /** Extra controls rendered under the image (engine picker etc.). */
  toolbar?: React.ReactNode;
};

export function RenderStage({ photo, photoLabel, look, render, onRegenerate, regenerating, regenerateDisabled, toolbar }: Props) {
  const jobId = useRenderJobId(render?.id);
  const job = useJob(jobId);
  // The job settles before the Look refetches; trust it over a stale "queued/running" render row.
  const status = job.data && (isActive(job.data.status) || isActive(render?.status)) ? job.data.status : render?.status;
  const overdue = useJobOverdue(job.data);
  const progress = job.data && isActive(job.data.status) ? progressFraction(job.data.progress) : status === "running" ? null : 0;
  const busy = status === "queued" || status === "running";
  const done = status === "done" && render?.url;
  const lowScore = done && render.structure_score !== null && render.structure_score < LOW_STRUCTURE_SCORE;

  const announcement = !look
    ? ""
    : !render
      ? `${photoLabel} has no render for ${look.name} yet.`
      : status === "queued"
        ? `${photoLabel} is queued.`
        : status === "running"
          ? `Rendering ${photoLabel}.`
          : status === "done"
            ? `${photoLabel} rendered.${lowScore ? " It may have altered the room." : ""}`
            : status === "failed"
              ? `Render of ${photoLabel} failed. ${render.error ?? ""}`
              : status === "cancelled"
                ? `Render of ${photoLabel} was cancelled.`
                : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl bg-muted ring-1 ring-border">
        <CompareSlider
          key={`${photo.id}:${render?.url ?? "none"}`}
          before={photo.url}
          after={done ? render.url : null}
          beforeAlt={`${photoLabel}, original`}
          afterAlt={`${photoLabel} with the ${look?.name ?? ""} Look applied`}
          className="aspect-[3/2] w-full"
        >
          <AnimatePresence>
            {busy && (
              <motion.div
                key="busy"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="absolute inset-0 z-30 flex items-end bg-background/35 p-4 backdrop-blur-[2px] sm:p-6"
              >
                <div className="w-full max-w-sm rounded-xl bg-background/90 p-4 shadow-lg ring-1 ring-border backdrop-blur">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium">{status === "queued" ? "Queued" : "Rendering"}</p>
                    {progress !== null && (
                      <NumberFlow value={progress} format={{ style: "percent" }} className="font-display text-3xl leading-none tabular" />
                    )}
                  </div>
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                    {progress === null ? (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-brand/70" />
                    ) : (
                      <div className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out" style={{ width: `${Math.max(progress, 0.02) * 100}%` }} />
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{render?.engine ? `Engine: ${render.engine}` : null}</p>
                  {overdue && job.data && <JobOverdueNotice job={job.data} className="mt-3" />}
                </div>
              </motion.div>
            )}
            {(status === "failed" || status === "cancelled") && (
              <motion.div
                key="failed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="absolute inset-0 z-30 flex items-end bg-background/40 p-4 backdrop-blur-[2px] sm:p-6"
              >
                <div role="alert" className="w-full max-w-md rounded-xl bg-background/95 p-4 shadow-lg ring-1 ring-destructive/30">
                  {status === "cancelled" ? (
                    <p className="text-sm font-medium">This render was cancelled</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-destructive">This render failed</p>
                      <p className="mt-1 text-sm text-pretty text-muted-foreground">
                        {render?.error ?? job.data?.error ?? "The engine returned an error."}
                      </p>
                    </>
                  )}
                  <Button size="sm" variant="outline" className="mt-3" onClick={onRegenerate} disabled={regenerating || regenerateDisabled}>
                    <RefreshCwIcon />
                    Try again
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CompareSlider>
        {lowScore && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge
                  tabIndex={0}
                  className="absolute bottom-3 left-3 z-30 h-auto gap-1.5 border border-warning-border bg-warning px-2 py-1 text-warning-foreground"
                />
              }
            >
              <TriangleAlertIcon className="size-3.5" />
              May have altered the room
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64">
              The walls, windows or fixtures differ from your photo (structure score {render.structure_score?.toFixed(2)}). Check
              it before sharing, or regenerate.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <PhotoCredit photo={photo} className="bg-muted text-muted-foreground backdrop-blur-none hover:bg-accent hover:text-foreground" />
        <Button variant="outline" size="sm" className="ml-auto" onClick={onRegenerate} disabled={!look || busy || regenerating || regenerateDisabled}>
          <RefreshCwIcon />
          Regenerate this photo
        </Button>
      </div>
      {!look ? (
        <p className="text-sm text-muted-foreground">Describe the look in the chat, then render all photos to see it here.</p>
      ) : !render ? (
        <p className="text-sm text-muted-foreground">No render of this photo for {look.name} yet. Regenerate it, or render all photos.</p>
      ) : render.qa?.notes ? (
        <p className="text-sm text-muted-foreground">{render.qa.notes}</p>
      ) : null}
    </div>
  );
}
