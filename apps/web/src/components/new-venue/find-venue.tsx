"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowUpRightIcon, MapPinIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BackendPicker } from "@/components/backend-picker";
import { hostOf } from "@/components/photo-credit";
import { ImportReview } from "@/components/new-venue/import-review";
import { JobProgress } from "@/components/new-venue/job-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { canBrowse } from "@/lib/backends";
import { useJob } from "@/lib/jobs";
import { useBackends } from "@/lib/queries";
import type { ResearchMatch } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS = [
  "Looking up the official site…",
  "Reading the venue's event pages…",
  "Collecting photos of each space…",
  "Checking room sizes and capacities…",
  "Looking for published decor policies…",
  "Cross-checking what it found…",
];

export function FindVenue() {
  const backends = useBackends();
  const brains = backends.data?.brains;
  const [query, setQuery] = useState("");
  const [touched, setTouched] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [run, setRun] = useState<{ jobId: string; startedAt: number } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);

  const usableBrains = (brains ?? []).filter((b) => b.available && canBrowse(b));
  const fallback =
    usableBrains.find((b) => b.id === backends.data?.defaults.brain)?.id ?? usableBrains[0]?.id ?? backends.data?.defaults.brain ?? "";
  const brain = picked ?? fallback;
  const noBrain = backends.isSuccess && usableBrains.length === 0;

  const job = useJob(run?.jobId).data;
  const research = job?.status === "done" ? job.result?.research : undefined;

  const start = useMutation({
    mutationFn: () => api.research({ query: query.trim(), brain: brain || undefined }),
    onSuccess: (j) => {
      setChosen(null);
      setRun({ jobId: j.id, startedAt: j.created_at ? Date.parse(j.created_at) : Date.now() });
    },
    onError: (e) => toast.error("Couldn't start the search", { description: errorMessage(e) }),
  });

  const reset = () => {
    setRun(null);
    setChosen(null);
  };

  if (run && research && chosen !== null && research.matches[chosen]) {
    return (
      <ImportReview
        key={`${run.jobId}-${chosen}`}
        jobId={run.jobId}
        matchIndex={chosen}
        match={research.matches[chosen]}
        onBack={() => setChosen(null)}
      />
    );
  }

  if (run && research) {
    return (
      <section aria-labelledby="matches-heading" className="grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="matches-heading" className="font-display text-3xl">
              {research.matches.length ? "Is it one of these?" : "Nothing found"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Results for <span className="text-foreground">“{research.query}”</span>. Pick your venue to review what was found.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            <ArrowLeftIcon aria-hidden /> Search again
          </Button>
        </div>
        {research.notes && <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{research.notes}</p>}
        <ul className="grid gap-3">
          {research.matches.map((m, i) => (
            <li key={`${m.name}-${i}`}>
              <MatchCard match={m} onChoose={() => setChosen(i)} />
            </li>
          ))}
        </ul>
        {research.matches.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Try adding the city or the room name, or use photos or a video tour instead.
          </p>
        )}
      </section>
    );
  }

  if (run && job?.status === "failed") {
    return (
      <div role="alert" className="rounded-2xl border border-destructive/40 bg-card p-6 sm:p-8">
        <h2 className="font-display text-3xl">The search stopped</h2>
        <p className="mt-2 text-sm text-muted-foreground">{job.error ?? "The brain couldn't finish researching this venue."}</p>
        <Button className="mt-4" onClick={reset}>
          Try again
        </Button>
      </div>
    );
  }

  if (run) {
    return (
      <JobProgress
        title="Finding your venue"
        job={job}
        startedAt={run.startedAt}
        steps={STEPS}
        expectation="Research usually takes 2 to 5 minutes."
        onCancel={reset}
      />
    );
  }

  const invalid = touched && !query.trim();
  return (
    <form
      className="grid max-w-2xl gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (query.trim() && brain && !noBrain) start.mutate();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="find-query">Venue name, wing/room, city</Label>
        <div className="relative">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="find-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. The Larkspur House, Grand Ballroom, Hudson NY"
            className="h-11 pl-9 text-base"
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={invalid ? "find-query-error" : "find-query-hint"}
          />
        </div>
        {invalid ? (
          <p id="find-query-error" className="text-sm text-destructive">
            Type the venue&apos;s name, and the city if you know it.
          </p>
        ) : (
          <p id="find-query-hint" className="text-sm text-muted-foreground">
            A brain on this machine searches the venue&apos;s own site and listings for photos, room details and decor policies. Nothing is saved until you review it.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <BackendPicker
          kind="brain"
          options={brains}
          value={brain}
          onChange={setPicked}
          usable={canBrowse}
          unusableReason="This brain can't browse the web."
        />
        <Button type="submit" disabled={start.isPending || noBrain}>
          {start.isPending ? "Starting…" : "Find my venue"}
        </Button>
      </div>
      {noBrain && (
        <p role="status" className="text-sm text-muted-foreground">
          No brain with web access is available. Sign in to Claude, Copilot or Codex on this machine, or add the venue from photos.
        </p>
      )}
    </form>
  );
}

function MatchCard({ match, onChoose }: { match: ResearchMatch; onChoose: () => void }) {
  const pct = Math.round(match.confidence * 100);
  const photos = (match.spaces ?? []).flatMap((s) => s.photos ?? []);
  return (
    <article className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:p-5">
      {photos[0] && (
        <img src={photos[0].url} alt="" className="aspect-[3/2] w-full shrink-0 rounded-lg bg-muted object-cover sm:w-48" loading="lazy" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="font-display text-2xl">{match.name}</h3>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs tabular",
              pct >= 70 ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground",
            )}
          >
            {pct}% match
          </span>
        </div>
        {match.address && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPinIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {match.address}
          </p>
        )}
        {match.summary && <p className="text-sm text-pretty">{match.summary}</p>}
        <p className="text-xs text-muted-foreground">
          {(match.spaces ?? []).length} space{(match.spaces ?? []).length === 1 ? "" : "s"} · {photos.length} photo{photos.length === 1 ? "" : "s"} ·{" "}
          {(match.rules_found ?? []).length} policy note{(match.rules_found ?? []).length === 1 ? "" : "s"}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
          <Button onClick={onChoose}>This is my venue</Button>
          {match.website && (
            <a
              href={match.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {hostOf(match.website)}
              <ArrowUpRightIcon aria-hidden className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
