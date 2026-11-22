"use client";

import NumberFlow from "@number-flow/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FilmIcon, ImagePlusIcon, PencilLineIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { JobOverdueNotice } from "@/components/job-overdue";
import { PhotoCredit } from "@/components/photo-credit";
import { BaseCandidate } from "@/components/studio/base-candidate";
import { ACCEPT, filterFiles, useUploadPhotos } from "@/components/studio/photo-strip";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { isActive, trackJobs, useBaseJobId, useJob, useJobOverdue } from "@/lib/jobs";
import { usePreferences } from "@/lib/preferences";
import { qk, useBackends } from "@/lib/queries";
import { progressFraction } from "@/lib/spec";
import type { BackendStatus, Photo, Space, SpaceReference } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Generating from a reference photo needs an engine that can generate and takes reference images. */
const canGenerateFromReference = (b: BackendStatus) => b.caps?.can_generate !== false && (b.caps?.max_refs ?? 0) > 0;
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * A space imported in reference mode has the venue's own photos as references only. This is the studio's empty state
 * for it: show those references with their credits and every way to get a base photo to design on.
 */
export function ReferencePhotos({ space, onReady, onDescribe }: { space: Space; onReady: (photo: Photo) => void; onDescribe: () => void }) {
  const qc = useQueryClient();
  const backends = useBackends();
  const { engine: preferred } = usePreferences();
  const fileId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [personal, setPersonal] = useState(false);

  const jobId = useBaseJobId(space.id);
  const job = useJob(jobId);
  const generating = isActive(job.data?.status);
  const overdue = useJobOverdue(job.data);
  const candidate = space.photos.find((p) => p.kind === "generated_base" && !p.approved);
  const percent = progressFraction(job.data?.progress);

  const engines = backends.data?.engines ?? [];
  const preferredEngine = engines.find((e) => e.id === preferred);
  const engine =
    preferredEngine && preferredEngine.available && canGenerateFromReference(preferredEngine)
      ? preferred
      : (engines.find((e) => e.available && canGenerateFromReference(e))?.id ?? null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.space(space.id) });
    void qc.invalidateQueries({ queryKey: qk.venues });
  };

  const upload = useUploadPhotos(space.id, (photos) => photos[0] && onReady(photos[0]));

  const useAsBase = useMutation({
    mutationFn: (url: string) => api.importReference(space.id, { url, rights_confirmed: true }),
    onSuccess: (photo) => {
      refresh();
      setConfirming(null);
      toast.success("Base photo added", { description: "Design on it like any photo. Its credit stays with it." });
      onReady(photo);
    },
    onError: (e) => toast.error("Couldn't use that photo", { description: errorMessage(e) }),
  });

  const generate = useMutation({
    mutationFn: async (ref: SpaceReference) => {
      if (!engine) throw new Error("No image engine found — install/log in to Copilot CLI, Codex CLI, or mflux.");
      if (candidate) await api.deletePhoto(candidate.id);
      return api.generateBase(space.id, { engine, reference_url: ref.url });
    },
    onSuccess: (job) => {
      void qc.invalidateQueries({ queryKey: qk.space(space.id) });
      trackJobs(qc, [{ job, spaceId: space.id }], {
        pending: "Generating an empty base view",
        done: "Base view ready to review",
        failed: "Couldn't generate the base view",
        spaceId: space.id,
      });
    },
    onError: (e) => toast.error("Couldn't start generating", { description: errorMessage(e) }),
  });

  const references = space.references ?? [];
  const busy = generating || generate.isPending;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h2 className="font-display text-3xl leading-tight">Pick a photo to design on</h2>
        <p className="mt-1 max-w-prose text-sm text-pretty text-muted-foreground">
          We found these photos of {space.name} on the web. They&apos;re saved as references. Use one as your base photo, have us
          generate an empty view from it, or bring your own.
        </p>
      </div>

      <div aria-live="polite">
        {generating ? (
          <div className="rounded-xl bg-muted p-4">
            <p className="text-sm font-medium">{job.data?.status === "queued" ? "Waiting for the engine" : "Generating the room"}</p>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-background">
                <div className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out" style={{ width: `${percent * 100}%` }} />
              </div>
              <NumberFlow value={percent} format={{ style: "percent" }} className="text-sm tabular text-muted-foreground" />
            </div>
            {overdue && job.data && <JobOverdueNotice job={job.data} className="mt-3" />}
          </div>
        ) : candidate ? (
          <BaseCandidate key={candidate.id} photo={candidate} spaceId={space.id} onApproved={onReady} />
        ) : job.data?.status === "failed" ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {job.data.error ?? "Generation failed."} Try another photo or engine.
          </p>
        ) : null}
      </div>

      <ul aria-label="Reference photos" className="grid gap-4 sm:grid-cols-2">
        {references.map((ref, i) => {
          const open = confirming === ref.url;
          const checkId = `${fileId}-personal-${i}`;
          return (
            <li key={ref.url} className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <div className="relative">
                <img
                  src={ref.url}
                  alt={ref.caption ?? `Reference photo ${i + 1}`}
                  referrerPolicy="no-referrer"
                  className="aspect-[3/2] w-full bg-muted object-cover"
                />
                <PhotoCredit photo={{ credit: ref.credit ?? null, source_page: ref.source_page }} className="absolute bottom-2 left-2" />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                {ref.caption && <p className="line-clamp-2 text-sm text-muted-foreground">{ref.caption}</p>}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={open ? "secondary" : "outline"}
                    aria-expanded={open}
                    onClick={() => {
                      setConfirming(open ? null : ref.url);
                      setPersonal(false);
                    }}
                    // A base photo would hide this screen mid-generation; wait for the generated view first.
                    disabled={useAsBase.isPending || busy}
                  >
                    <ImagePlusIcon />
                    Use as my base photo
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => generate.mutate(ref)} disabled={busy || !engine || Boolean(candidate)}>
                    <SparklesIcon />
                    Generate an empty base view from this
                  </Button>
                </div>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      key="confirm"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, transition: { duration: 0.1 } }}
                      transition={{ duration: 0.18, ease: EASE_OUT }}
                      className="grid gap-2 rounded-lg bg-muted/60 p-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <Checkbox id={checkId} className="mt-0.5" checked={personal} onCheckedChange={setPersonal} />
                        <Label htmlFor={checkId} className="font-normal leading-snug">
                          I&apos;m using this for personal planning and will keep the credit
                        </Label>
                      </div>
                      <Button size="sm" className="justify-self-start" disabled={!personal || useAsBase.isPending || busy} onClick={() => useAsBase.mutate(ref.url)}>
                        {useAsBase.isPending ? "Adding…" : "Use this photo"}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <span className="mr-1 text-sm text-muted-foreground">Or start from your own:</span>
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
          <ImagePlusIcon />
          {upload.isPending ? "Uploading…" : "Upload photos"}
        </Button>
        <input
          ref={fileInput}
          id={fileId}
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden
          accept={ACCEPT.join(",") + ",.heic,.heif"}
          className="sr-only"
          onChange={(e) => {
            const files = e.target.files ? filterFiles(e.target.files, space.photos.length) : [];
            if (files.length) upload.mutate(files);
            e.target.value = "";
          }}
        />
        <Link href={`/venues/new?tab=video`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <FilmIcon />
          Video tour
        </Link>
        <Button variant="outline" size="sm" onClick={onDescribe}>
          <PencilLineIcon />
          Describe it
        </Button>
      </div>
    </div>
  );
}
