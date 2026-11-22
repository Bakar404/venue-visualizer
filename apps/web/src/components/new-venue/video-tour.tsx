"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, FilmIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CameraCapture } from "@/components/camera-capture";
import { FrameReview } from "@/components/new-venue/frame-review";
import { JobProgress, formatElapsed } from "@/components/new-venue/job-progress";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RulesFields } from "@/components/venues/rules-fields";
import { api, errorMessage } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { usePreferences } from "@/lib/preferences";
import { qk } from "@/lib/queries";
import { defaultRules } from "@/lib/spec";
import type { VenueRules } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_SECONDS = 5 * 60;
const VIDEO_TYPES = /^video\/(mp4|quicktime|webm|x-m4v)$/;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;

const STEPS = [
  "Pulling frames from your video…",
  "Dropping blurry and near-duplicate frames…",
  "Grouping frames by space…",
  "Describing each space…",
  "Picking the best wide shots…",
];

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

type Picked = { file: File; url: string; duration: number | null; probing: boolean };

function validate(p: Picked): string | null {
  if (!VIDEO_TYPES.test(p.file.type) && !VIDEO_EXT.test(p.file.name)) return "Use an MP4, MOV or WebM video (iPhone HEVC .mov is fine).";
  if (p.file.size > MAX_BYTES) return `This video is ${formatBytes(p.file.size)}; the limit is 1 GB.`;
  if (p.duration !== null && p.duration > MAX_SECONDS + 1) return `This video is ${formatElapsed(p.duration * 1000)} long; keep it under 5 minutes.`;
  return null;
}

/** Create the venue, upload a walk-through, then review the frames the vision pass picked. */
export function VideoTour() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [rules, setRules] = useState<VenueRules>(defaultRules);
  const [video, setVideo] = useState<Picked | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [over, setOver] = useState(false);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [run, setRun] = useState<{ venueId: string; jobId: string; startedAt: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { brain } = usePreferences();
  // Every preview URL this screen created, so none outlive it.
  const objectUrls = useRef(new Set<string>());

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      abort.current?.abort();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const revoke = (url: string) => {
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  };

  const job = useJob(run?.jobId).data;

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (video) revoke(video.url);
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    setVideo({ file, url, duration: null, probing: true });
    // Read duration client-side from the metadata; HEVC may not decode in every browser, which is fine.
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () =>
      setVideo((v) => (v?.url === url ? { ...v, duration: Number.isFinite(probe.duration) ? probe.duration : null, probing: false } : v));
    probe.onerror = () => setVideo((v) => (v?.url === url ? { ...v, probing: false } : v));
    probe.src = url;
  };

  const clear = () => {
    if (video) revoke(video.url);
    setVideo(null);
  };

  const errors = {
    name: !name.trim() ? "Give the venue a name." : null,
    video: !video ? "Choose a video." : validate(video),
  };

  const upload = useMutation({
    mutationFn: async () => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      const { signal } = ctrl;
      setProgress(0);
      signal.throwIfAborted();
      // Reuse the venue on retry so a failed upload doesn't leave duplicates behind.
      const id = venueId ?? (await api.createVenue({ name: name.trim(), rules })).id;
      setVenueId(id);
      // Cancelling while the venue was being created must not start the upload.
      signal.throwIfAborted();
      const j = await api.uploadVideo(id, video!.file, { brain, onProgress: setProgress, signal });
      return { venueId: id, job: j };
    },
    onSuccess: ({ venueId: id, job: j }) => {
      void qc.invalidateQueries({ queryKey: qk.venues });
      setRun({ venueId: id, jobId: j.id, startedAt: Date.now() });
      // The preview is no longer shown; the server has the file now.
      if (video) revoke(video.url);
      setVideo(null);
    },
    onError: (e) => {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast("Upload cancelled");
        return;
      }
      toast.error("Couldn't upload the video", { description: errorMessage(e) });
    },
    onSettled: () => {
      abort.current = null;
    },
  });

  const restart = () => {
    setRun(null);
    setProgress(0);
  };

  if (run && job?.status === "done" && job.result?.frames) {
    return (
      <FrameReview
        key={run.jobId}
        venueId={run.venueId}
        jobId={run.jobId}
        frames={job.result.frames}
        suggested={job.result.spaces_suggested ?? []}
        durationS={job.result.duration_s ?? null}
      />
    );
  }

  if (run && job && (job.status === "failed" || job.status === "cancelled" || job.status === "done")) {
    return (
      <div role="alert" className="rounded-2xl border border-destructive/40 bg-card p-6 sm:p-8">
        <h2 className="font-display text-3xl">{job.status === "cancelled" ? "Video processing cancelled" : "We couldn\u2019t read that video"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {job.status === "cancelled" ? "No frames were added." : (job.error ?? "Frame extraction stopped.")}
        </p>
        <Button className="mt-4" onClick={restart}>
          Try another video
        </Button>
      </div>
    );
  }

  if (run) {
    return (
      <JobProgress
        title="Watching your video tour"
        job={job}
        startedAt={run.startedAt}
        steps={STEPS}
        expectation="This usually takes a minute or two for a short walk-through."
      />
    );
  }

  const pct = Math.round(progress * 100);
  return (
    <form
      className="grid max-w-3xl gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!errors.name && !errors.video && !upload.isPending) upload.mutate();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="video-name">Venue name</Label>
        <Input
          id="video-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. The Larkspur House"
          autoComplete="off"
          disabled={Boolean(venueId)}
          aria-invalid={submitted && Boolean(errors.name)}
          aria-describedby={submitted && errors.name ? "video-name-error" : venueId ? "video-name-saved" : undefined}
        />
        {submitted && errors.name && (
          <p id="video-name-error" className="text-sm text-destructive">
            {errors.name}
          </p>
        )}
        {venueId && (
          <p id="video-name-saved" className="text-sm text-muted-foreground">
            Venue created. Rename it later from the venue page.
          </p>
        )}
      </div>

      <section aria-labelledby="video-heading" className="grid gap-3">
        <div>
          <h2 id="video-heading" className="text-lg font-medium">
            Walk-through video
          </h2>
          <p className="text-sm text-muted-foreground">
            Walk slowly through each space, pausing in the corners. We pull sharp frames, group them by space and let you choose which become base photos.
          </p>
        </div>
        {video ? (
          <div className={cn("flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row", submitted && errors.video && "border-destructive")}>
            <video
              src={video.url}
              className="aspect-video w-full shrink-0 rounded-lg bg-black object-contain sm:w-56"
              muted
              playsInline
              controls
              preload="metadata"
              aria-label={`Preview of ${video.file.name}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate font-medium">{video.file.name}</p>
              <p className="text-sm text-muted-foreground tabular">
                {formatBytes(video.file.size)} ·{" "}
                {video.probing ? "reading length…" : video.duration !== null ? formatElapsed(video.duration * 1000) : "length unknown until processed"}
              </p>
              {errors.video && (
                <p className="text-sm text-destructive" role={submitted ? "alert" : undefined}>
                  {errors.video}
                </p>
              )}
              {!upload.isPending && (
                <Button type="button" variant="ghost" size="sm" className="mt-auto -ml-2.5 w-fit" onClick={clear}>
                  <XIcon aria-hidden /> Choose a different video
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={cn(
              "grid place-items-center gap-3 rounded-2xl border border-dashed px-4 py-10 text-center transition-colors duration-150",
              over ? "border-brand bg-brand-soft" : submitted && errors.video ? "border-destructive" : "border-border",
            )}
          >
            <FilmIcon aria-hidden className="size-6 text-muted-foreground" />
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" onClick={() => input.current?.click()}>
                Choose a video
              </Button>
              <CameraCapture kind="video" onFiles={(files) => pick(files?.[0])} />
            </div>
            <p className="text-sm text-muted-foreground sm:text-xs">Or drop it here. MP4, MOV or WebM (including iPhone HEVC), up to 1 GB and 5 minutes.</p>
            {submitted && errors.video && <p className="text-sm text-destructive">{errors.video}</p>}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/hevc,video/x-m4v,.mp4,.mov,.webm,.m4v,.hevc"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </section>

      {!venueId && (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-1 pointer-coarse:min-h-11 text-left text-lg font-medium">
            <span>
              House rules <span className="text-sm font-normal text-muted-foreground">(optional, editable later)</span>
            </span>
            <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-data-panel-open:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <RulesFields value={rules} onChange={setRules} idPrefix="video-rule" />
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="grid gap-3 border-t pt-6">
        {upload.isPending && (
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span id="video-upload-label">Uploading {video?.file.name}</span>
              <span className="text-muted-foreground tabular" aria-hidden>
                {pct}%
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-labelledby="video-upload-label"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div className="h-full w-full origin-left rounded-full bg-brand transition-transform duration-150 ease-linear" style={{ transform: `scaleX(${progress})` }} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={upload.isPending}>
            {upload.isPending ? "Uploading…" : venueId ? "Upload video" : "Create venue and upload"}
          </Button>
          {upload.isPending && (
            <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}>
              Cancel upload
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
