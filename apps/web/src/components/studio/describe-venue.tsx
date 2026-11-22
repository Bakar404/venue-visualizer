"use client";

import NumberFlow from "@number-flow/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, RotateCcwIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BackendPicker } from "@/components/backend-picker";
import { JobOverdueNotice } from "@/components/job-overdue";
import { NoEngineNotice } from "@/components/no-engine-notice";
import { PhotoDropzone } from "@/components/studio/photo-strip";
import { VenueSpecFields } from "@/components/venue-spec-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { isActive, trackJobs, useBaseJobId, useJob, useJobOverdue } from "@/lib/jobs";
import { usePreferences } from "@/lib/preferences";
import { qk, useBackends } from "@/lib/queries";
import { progressFraction } from "@/lib/spec";
import type { BackendStatus, Photo, Space, VenueSpec } from "@/lib/types";

const canGenerate = (b: BackendStatus) => b.caps?.can_generate !== false;

/**
 * The no-photo path: describe the empty room, generate a base image, then approve it or try again.
 * Shown in place of the photo strip until the space has a usable photo.
 */
export function DescribeVenue({ space, onApproved }: { space: Space; onApproved: (photo: Photo) => void }) {
  const qc = useQueryClient();
  const backends = useBackends();
  const { engine: preferred, setEngine } = usePreferences();
  const [spec, setSpec] = useState<VenueSpec>(space.venue_spec ?? {});
  const [angle, setAngle] = useState("");
  const jobId = useBaseJobId(space.id);
  const job = useJob(jobId);
  const generating = isActive(job.data?.status);
  const overdue = useJobOverdue(job.data);
  const candidate = space.photos.find((p) => p.kind === "generated_base" && !p.approved);

  const engines = backends.data?.engines ?? [];
  const preferredEngine = engines.find((e) => e.id === preferred);
  // Never fall back to a made-up engine: null disables Generate and shows how to install one.
  const engine =
    preferredEngine && preferredEngine.available && canGenerate(preferredEngine)
      ? preferred
      : (engines.find((e) => e.available && canGenerate(e))?.id ?? null);
  const noEngine = backends.isSuccess && !engine;

  const generate = useMutation({
    mutationFn: async () => {
      if (candidate) await api.deletePhoto(candidate.id);
      if (!engine) throw new Error("No image engine found — install/log in to Copilot CLI, Codex CLI, or mflux.");
      await api.updateSpace(space.id, { venue_spec: spec });
      return api.generateBase(space.id, { engine, angle_hint: angle.trim() || undefined });
    },
    onSuccess: (job) => {
      void qc.invalidateQueries({ queryKey: qk.space(space.id) });
      trackJobs(qc, [{ job, spaceId: space.id }], {
        pending: "Generating a base image",
        done: "Base image ready to review",
        failed: "Couldn't generate the base image",
        spaceId: space.id,
      });
    },
    onError: (e) => toast.error("Couldn't start generating", { description: errorMessage(e) }),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.approvePhoto(id),
    onSuccess: (photo) => {
      void qc.invalidateQueries({ queryKey: qk.space(space.id) });
      void qc.invalidateQueries({ queryKey: qk.venues });
      toast.success("Base image approved", { description: "You can now design on it like a photo." });
      onApproved(photo);
    },
    onError: (e) => toast.error("Couldn't approve the image", { description: errorMessage(e) }),
  });

  const percent = progressFraction(job.data?.progress);

  return (
    <div className="flex flex-col gap-5">
      <PhotoDropzone spaceId={space.id} existing={space.photos.length} large onUploaded={(p) => p[0] && onApproved(p[0])} />

      <div id="describe-venue" className="scroll-mt-4 rounded-xl border bg-card p-4">
        <h2 className="font-display text-2xl leading-tight">No photos? Describe your venue</h2>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">
          We&apos;ll generate an empty room from your description. Approve it and design on it like a photo.
        </p>

        <div aria-live="polite" className="mt-4">
          {generating ? (
            <div className="rounded-lg bg-muted p-4">
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
            <figure className="space-y-3">
              <img src={candidate.url} alt="Generated base image of the empty room" className="aspect-[3/2] w-full rounded-lg bg-muted object-cover" />
              <figcaption className="text-sm text-muted-foreground">Does this look like your room? Approve it to start designing.</figcaption>
              <div className="flex gap-2">
                <Button onClick={() => approve.mutate(candidate.id)} disabled={approve.isPending} className="flex-1">
                  <CheckIcon />
                  Approve
                </Button>
                <Button variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending || !engine} className="flex-1">
                  <RotateCcwIcon />
                  Try again
                </Button>
              </div>
            </figure>
          ) : job.data?.status === "failed" ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {job.data.error ?? "Generation failed."} Adjust the description or pick another engine, then try again.
            </p>
          ) : job.data?.status === "cancelled" ? (
            <p role="status" className="rounded-lg bg-muted p-3 text-sm">Generation cancelled. Generate again when you&apos;re ready.</p>
          ) : null}
        </div>

        {!candidate && !generating && (
          <form
            className="mt-4 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              generate.mutate();
            }}
          >
            <VenueSpecFields value={spec} onChange={setSpec} idPrefix="describe" />
            <div className="grid gap-2">
              <Label htmlFor="describe-angle">Camera angle</Label>
              <Input id="describe-angle" value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="from the entrance, looking at the windows" />
            </div>
            {noEngine && <NoEngineNotice />}
            <div className="flex flex-wrap items-center gap-2">
              <BackendPicker
                kind="engine"
                options={engines}
                value={engine}
                onChange={setEngine}
                usable={canGenerate}
                unusableReason="This engine edits photos but can't create a room from scratch."
              />
              <Button type="submit" disabled={generate.isPending || !engine} className="ml-auto">
                <SparklesIcon />
                Generate base image
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
