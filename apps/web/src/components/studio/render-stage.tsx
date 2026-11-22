"use client";

import NumberFlow from "@number-flow/react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { AnimatePresence, motion } from "motion/react";
import { MoveHorizontalIcon, RefreshCwIcon, ScanSearchIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { useRef } from "react";

import { CompareSlider } from "@/components/compare-slider";
import { JobOverdueNotice } from "@/components/job-overdue";
import { PhotoCredit } from "@/components/photo-credit";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { isActive, useJob, useJobOverdue, useRenderJobId } from "@/lib/jobs";
import { LOW_STRUCTURE_SCORE, progressFraction } from "@/lib/spec";
import { structureVerdict } from "@/lib/structure";
import type { Look, Photo, Render } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  photo: Photo;
  photoLabel: string;
  look: Look | undefined;
  render: Render | undefined;
  structureThreshold?: number;
  onRegenerate: () => void;
  regenerating: boolean;
  /** E.g. no image engine available. */
  regenerateDisabled?: boolean;
  /** Extra controls rendered under the image (engine picker etc.). */
  toolbar?: React.ReactNode;
  /** The plan on screen no longer matches the Look shown, so the render is out of date. */
  stale?: boolean;
  /** Renders the current plan (Render all photos). */
  onRenderLatest?: () => void;
  renderLatestDisabled?: boolean;
};

export function RenderStage({
  photo,
  photoLabel,
  look,
  render,
  structureThreshold = LOW_STRUCTURE_SCORE,
  onRegenerate,
  regenerating,
  regenerateDisabled,
  toolbar,
  stale = false,
  onRenderLatest,
  renderLatestDisabled,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const compareRequested = useRef(false);
  const jobId = useRenderJobId(render?.id);
  const job = useJob(jobId);
  // The job settles before the Look refetches; trust it over a stale "queued/running" render row.
  const status = job.data && (isActive(job.data.status) || isActive(render?.status)) ? job.data.status : render?.status;
  const overdue = useJobOverdue(job.data);
  const progress = job.data && isActive(job.data.status) ? progressFraction(job.data.progress) : status === "running" ? null : 0;
  const busy = status === "queued" || status === "running";
  const done = status === "done" && render?.url;
  // Trust the backend's verdict when present (renders scored by an older method keep their own warning state).
  const qaWarning = render?.qa ? Boolean(render.qa.structure_warning) : undefined;
  const lowScore = done && (qaWarning ?? (render.structure_score !== null && render.structure_score < structureThreshold));
  const verdict = lowScore ? structureVerdict(render.qa) : null;
  const showStale = Boolean(stale && done && onRenderLatest);
  const slider = () => frameRef.current?.querySelector<HTMLInputElement>('input[type="range"]') ?? null;

  const announcement = !look
    ? ""
    : !render
      ? `${photoLabel} has no render for ${look.name} yet.`
      : status === "queued"
        ? `${photoLabel} is queued.`
        : status === "running"
          ? `Rendering ${photoLabel}.`
          : status === "done"
            ? `${photoLabel} rendered.${verdict ? ` ${verdict.label}: ${verdict.text}` : ""}`
            : status === "failed"
              ? `Render of ${photoLabel} failed. ${render.error ?? ""}`
              : status === "cancelled"
                ? `Render of ${photoLabel} was cancelled.`
                : "";

  return (
    <div className="flex flex-col gap-3">
      <div ref={frameRef} className="relative overflow-hidden rounded-xl bg-muted ring-1 ring-border">
        <CompareSlider
          key={`${photo.id}:${render?.url ?? "none"}`}
          before={photo.url}
          after={done ? render.url : null}
          beforeAlt={`${photoLabel}, original`}
          afterAlt={`${photoLabel} with the ${look?.name ?? ""} Look applied`}
          className="aspect-[3/2] w-full"
        >
          <AnimatePresence>
            {showStale && !busy && (
              <motion.div
                key="stale"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none absolute inset-x-3 top-3 z-30 flex justify-center"
              >
                <div
                  role="status"
                  className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full bg-background/95 py-1.5 pr-1.5 pl-4 text-sm shadow-lg ring-1 ring-border backdrop-blur"
                >
                  <span className="min-w-0 truncate">Your plan changed since this render</span>
                  <Button
                    size="sm"
                    className="shrink-0 rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
                    onClick={onRenderLatest}
                    disabled={renderLatestDisabled}
                  >
                    <SparklesIcon />
                    Render to see it
                  </Button>
                </div>
              </motion.div>
            )}
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
        {verdict && (
          <Popover onOpenChange={(open) => open && (compareRequested.current = false)}>
            <PopoverTrigger
              data-level={verdict.level}
              className={cn(
                "absolute bottom-3 left-3 z-30 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]",
                verdict.level === "unverifiable"
                  ? "bg-background/90 text-foreground ring-1 ring-border hover:bg-background"
                  : "border border-warning-border bg-warning text-warning-foreground hover:brightness-[0.98]",
              )}
            >
              {verdict.level === "unverifiable" ? <ScanSearchIcon aria-hidden className="size-3.5" /> : <TriangleAlertIcon aria-hidden className="size-3.5" />}
              {verdict.label}
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              className="w-76"
              finalFocus={() => (compareRequested.current ? slider() : true)}
            >
              <PopoverTitle>{verdict.label}</PopoverTitle>
              <PopoverDescription className="text-pretty">{verdict.text}</PopoverDescription>
              <div className="flex items-center justify-between gap-3">
                {render?.structure_score != null && (
                  <span className="text-xs text-muted-foreground tabular">Structure score {render.structure_score.toFixed(2)}</span>
                )}
                <PopoverPrimitive.Close
                  onClick={() => {
                    compareRequested.current = true;
                  }}
                  render={<Button size="sm" variant="outline" className="ml-auto" />}
                >
                  <MoveHorizontalIcon />
                  Compare
                </PopoverPrimitive.Close>
              </div>
            </PopoverContent>
          </Popover>
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
