"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowUpRightIcon, ChevronDownIcon, LinkIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ChipsInput } from "@/components/chips-input";
import { PhotoCredit, hostOf } from "@/components/photo-credit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { VenueSpecFields } from "@/components/venue-spec-fields";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import { RULE_LABELS } from "@/lib/spec";
import type { ImportVenueBody, ResearchMatch, ResearchPhoto, ResearchRule, ResearchSpace, VenueSpec } from "@/lib/types";
import { cn } from "@/lib/utils";

type DraftSpace = {
  source: ResearchSpace;
  include: boolean;
  name: string;
  spec: VenueSpec;
  photos: { photo: ResearchPhoto; use: boolean }[];
};
type DraftRule = { rule: ResearchRule; accepted: boolean; allowed: boolean };

function specFrom(space: ResearchSpace, style: string | null | undefined): VenueSpec {
  return {
    style: style ?? null,
    length_ft: space.length_ft ?? null,
    width_ft: space.width_ft ?? null,
    ceiling_ft: space.ceiling_ft ?? null,
    walls: space.walls ?? null,
    floor: space.floor ?? null,
    windows: space.windows ?? null,
    fixtures: space.fixtures ?? [],
    notes: space.description ?? null,
  };
}

function SourceLink({ href, className }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline", className)}
    >
      <LinkIcon aria-hidden className="size-3" />
      {hostOf(href)}
      <span className="sr-only">(source, opens in a new tab)</span>
    </a>
  );
}

/** Everything the finder found is a suggestion: the user picks spaces, photos and rules before anything is saved. */
export function ImportReview({ jobId, matchIndex, match, onBack }: { jobId: string; matchIndex: number; match: ResearchMatch; onBack: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState(match.name);
  const [spaces, setSpaces] = useState<DraftSpace[]>(() =>
    (match.spaces ?? []).map((s) => ({
      source: s,
      include: true,
      name: s.name,
      spec: specFrom(s, match.style),
      photos: (s.photos ?? []).map((photo) => ({ photo, use: true })),
    })),
  );
  const [rules, setRules] = useState<DraftRule[]>(() =>
    (match.rules_found ?? []).map((rule) => ({ rule, accepted: false, allowed: rule.allowed ?? true })),
  );
  const [provided, setProvided] = useState<string[]>(match.provided_items ?? []);
  const [rights, setRights] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const included = spaces.filter((s) => s.include);
  const importing = included.reduce((n, s) => n + s.photos.filter((p) => p.use).length, 0);
  const needsRights = importing > 0;
  const errors = {
    name: !name.trim() ? "Give the venue a name." : null,
    spaces: included.length === 0 ? "Pick at least one space." : null,
    rights: needsRights && !rights ? "Confirm how you'll use the photos, or switch them off." : null,
  };
  const valid = !errors.name && !errors.spaces && !errors.rights;

  const patchSpace = (i: number, patch: Partial<DraftSpace>) => setSpaces((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const patchRule = (i: number, patch: Partial<DraftRule>) => setRules((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () => {
      const body: ImportVenueBody = {
        research_job_id: jobId,
        match_index: matchIndex,
        name: name.trim(),
        spaces: included.map((s) => ({ name: s.name.trim() || s.source.name, source_name: s.source.name, venue_spec: s.spec })),
        accepted_rules: rules
          .filter((r) => r.accepted)
          .map((r) => ({ text: r.rule.text, maps_to: r.rule.maps_to ?? null, allowed: r.rule.maps_to ? r.allowed : null, source: r.rule.source })),
        provided_items: provided,
        photos: included.flatMap((s) =>
          s.photos.map((p) => ({
            url: p.photo.url,
            space: s.source.name,
            mode: p.use ? ("import" as const) : ("reference" as const),
            source_page: p.photo.source_page,
            credit: p.photo.credit ?? null,
          })),
        ),
        rights_confirmed: needsRights && rights,
      };
      return api.importVenue(body);
    },
    onSuccess: (venue) => {
      void qc.invalidateQueries({ queryKey: qk.venues });
      qc.setQueryData(qk.venue(venue.id), venue);
      toast.success("Venue added", { description: venue.name });
      router.push(`/venues/${venue.id}`);
    },
    onError: (e) => toast.error("Couldn't import the venue", { description: errorMessage(e) }),
  });

  return (
    <form
      className="grid gap-10"
      aria-labelledby="review-heading"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (valid) save.mutate();
      }}
    >
      <header className="grid gap-3">
        <Button type="button" variant="ghost" size="sm" className="-ml-2.5 w-fit" onClick={onBack}>
          <ArrowLeftIcon aria-hidden /> Other matches
        </Button>
        <h2 id="review-heading" className="font-display text-4xl">
          Review before importing
        </h2>
        <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
          Every fact links to its source. Keep what&apos;s right, fix what isn&apos;t; nothing is saved until you import.
        </p>
        <div className="grid max-w-md gap-2">
          <Label htmlFor="review-name">Venue name</Label>
          <Input
            id="review-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            aria-invalid={submitted && Boolean(errors.name)}
            aria-describedby={submitted && errors.name ? "review-name-error" : undefined}
          />
          {submitted && errors.name && (
            <p id="review-name-error" className="text-sm text-destructive">
              {errors.name}
            </p>
          )}
        </div>
        {match.sources.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Sources:</span>
            {match.sources.map((s) => (
              <SourceLink key={s} href={s} />
            ))}
          </p>
        )}
      </header>

      <section aria-labelledby="review-spaces" className="grid gap-4">
        <div>
          <h3 id="review-spaces" className="text-lg font-medium">
            Spaces
          </h3>
          <p className="text-sm text-muted-foreground">Untick spaces you won&apos;t use. Photos switched off are kept as reference only, never as the base.</p>
          {submitted && errors.spaces && <p className="mt-1 text-sm text-destructive">{errors.spaces}</p>}
        </div>
        {spaces.map((s, i) => {
          const id = `review-space-${i}`;
          return (
            <fieldset key={s.source.name} className={cn("rounded-2xl border bg-card p-4 transition-opacity duration-200 sm:p-5", !s.include && "opacity-60")}>
              <legend className="sr-only">{s.source.name}</legend>
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox
                  id={`${id}-include`}
                  checked={s.include}
                  onCheckedChange={(checked) => patchSpace(i, { include: checked })}
                  aria-label={`Import ${s.name || s.source.name}`}
                />
                <Label htmlFor={`${id}-name`} className="sr-only">
                  Space name
                </Label>
                <Input
                  id={`${id}-name`}
                  value={s.name}
                  onChange={(e) => patchSpace(i, { name: e.target.value })}
                  disabled={!s.include}
                  className="h-9 max-w-xs flex-1 font-medium"
                  autoComplete="off"
                />
                {s.source.source && <SourceLink href={s.source.source} />}
              </div>
              {s.source.description && <p className="mt-3 text-sm text-pretty text-muted-foreground">{s.source.description}</p>}
              {(s.source.capacity_seated || s.source.capacity_standing) && (
                <p className="mt-1 text-xs text-muted-foreground tabular">
                  {s.source.capacity_seated ? `${s.source.capacity_seated} seated` : null}
                  {s.source.capacity_seated && s.source.capacity_standing ? " · " : null}
                  {s.source.capacity_standing ? `${s.source.capacity_standing} standing` : null}
                </p>
              )}

              {s.photos.length > 0 ? (
                <ul className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
                  {s.photos.map((p, k) => {
                    const pid = `${id}-photo-${k}`;
                    return (
                      <li key={p.photo.url} className="overflow-hidden rounded-xl border bg-background">
                        <div className="relative">
                          <img
                            src={p.photo.url}
                            alt={p.photo.caption ?? `Photo of ${s.name}`}
                            className={cn("aspect-[3/2] w-full bg-muted object-cover transition-opacity duration-200", !p.use && "opacity-50")}
                            loading="lazy"
                          />
                          <PhotoCredit
                            photo={{ credit: p.photo.credit, source_url: p.photo.source_page }}
                            className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]"
                          />
                        </div>
                        <div className="grid gap-1 p-3">
                          {p.photo.caption && <p className="line-clamp-2 text-xs text-muted-foreground">{p.photo.caption}</p>}
                          <div className="flex items-center justify-between gap-3">
                            <Label htmlFor={pid} className="text-sm font-normal">
                              Use as base photo
                            </Label>
                            <Switch
                              id={pid}
                              checked={p.use}
                              disabled={!s.include}
                              onCheckedChange={(use) => patchSpace(i, { photos: s.photos.map((x, j) => (j === k ? { ...x, use } : x)) })}
                            />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  No photos found for this space. You can add your own or generate a starting image later.
                </p>
              )}

              <Collapsible className="mt-4">
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-1 text-left text-sm font-medium">
                  Room details
                  <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-data-panel-open:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <VenueSpecFields value={s.spec} onChange={(spec) => patchSpace(i, { spec })} idPrefix={`${id}-spec`} />
                </CollapsibleContent>
              </Collapsible>
            </fieldset>
          );
        })}
      </section>

      {rules.length > 0 && (
        <section aria-labelledby="review-rules" className="grid gap-4">
          <div>
            <h3 id="review-rules" className="text-lg font-medium">
              Suggested house rules
            </h3>
            <p className="text-sm text-muted-foreground">
              Found in the venue&apos;s published policies. They aren&apos;t applied until you tick them; check with your coordinator.
            </p>
          </div>
          <ul className="grid gap-2">
            {rules.map((r, i) => {
              const id = `review-rule-${i}`;
              const mapped = r.rule.maps_to ? RULE_LABELS[r.rule.maps_to] : null;
              return (
                <li key={`${r.rule.text}-${i}`} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="flex items-start gap-3">
                    <Checkbox id={id} className="mt-0.5" checked={r.accepted} onCheckedChange={(accepted) => patchRule(i, { accepted })} />
                    <div className="grid gap-1">
                      <Label htmlFor={id} className="font-normal leading-snug">
                        “{r.rule.text}”
                      </Label>
                      <SourceLink href={r.rule.source} />
                    </div>
                  </div>
                  {mapped && (
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 sm:justify-end">
                      <Label htmlFor={`${id}-allowed`} className="text-sm font-normal">
                        {mapped.label}
                        <span className="text-muted-foreground">{r.allowed ? " allowed" : " not allowed"}</span>
                      </Label>
                      <Switch
                        id={`${id}-allowed`}
                        checked={r.allowed}
                        disabled={!r.accepted}
                        onCheckedChange={(allowed) => patchRule(i, { allowed })}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="review-provided" className="grid gap-2">
        <h3 id="review-provided" className="text-lg font-medium">
          Provided by the venue
        </h3>
        <ChipsInput id="review-provided-items" label="Add an item the venue provides" value={provided} onChange={setProvided} placeholder="e.g. gold chiavari chairs" />
      </section>

      <footer className="grid gap-4 border-t pt-6">
        {needsRights && (
          <div className="flex items-start gap-3">
            <Checkbox
              id="review-rights"
              className="mt-0.5"
              checked={rights}
              onCheckedChange={setRights}
              aria-invalid={submitted && Boolean(errors.rights)}
              aria-describedby={submitted && errors.rights ? "review-rights-error" : undefined}
            />
            <div className="grid gap-1">
              <Label htmlFor="review-rights" className="font-normal leading-snug">
                I&apos;m using these photos for personal planning and will credit the source
              </Label>
              <p className="text-xs text-muted-foreground">
                {importing} photo{importing === 1 ? "" : "s"} will be saved with their credit, which is shown on the photo and in PDF exports.
              </p>
              {submitted && errors.rights && (
                <p id="review-rights-error" className="text-sm text-destructive">
                  {errors.rights}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={save.isPending}>
            {save.isPending ? "Importing…" : `Import ${included.length} space${included.length === 1 ? "" : "s"}`}
          </Button>
          {match.website && (
            <a
              href={match.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Venue website <ArrowUpRightIcon aria-hidden className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      </footer>
    </form>
  );
}
