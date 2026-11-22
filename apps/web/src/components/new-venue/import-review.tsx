"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowUpRightIcon, ChevronDownIcon, LinkIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PhotoCredit, hostOf } from "@/components/photo-credit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { VenueSpecFields } from "@/components/venue-spec-fields";
import { api, errorMessage } from "@/lib/api";
import { acceptableRuleKeys, buildImportPayload, selectablePhotos, spacePatches, venueSpecFromResearch } from "@/lib/import-payload";
import { qk } from "@/lib/queries";
import { RULE_LABELS } from "@/lib/spec";
import type { ResearchMatch, ResearchPhoto, ResearchSpace, RuleKey, VenueSpec } from "@/lib/types";
import { safeHttpUrl } from "@/lib/url";
import { cn } from "@/lib/utils";

type DraftSpace = {
  source: ResearchSpace;
  include: boolean;
  name: string;
  spec: VenueSpec;
  initialSpec: VenueSpec;
  photos: { photo: ResearchPhoto; use: boolean }[];
};

function SourceLink({ href: raw, className }: { href: string; className?: string }) {
  const href = safeHttpUrl(raw);
  if (!href) return <span className={cn("text-xs break-all text-muted-foreground", className)}>{raw}</span>;
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
  const website = safeHttpUrl(match.website);
  const [name, setName] = useState(match.name);
  const [spaces, setSpaces] = useState<DraftSpace[]>(() => {
    // Same filtering as the payload: unsafe URLs, duplicates across spaces and anything past the per-space cap are never shown.
    const taken = new Set<string>();
    return (match.spaces ?? []).map((s) => {
      const spec = venueSpecFromResearch(s, match.style);
      return {
        source: s,
        include: true,
        name: s.name,
        spec,
        initialSpec: spec,
        // Default on: people want to decorate the real venue photos. Nothing is downloaded until the rights box is ticked.
        photos: selectablePhotos(s.photos ?? [], taken).map((photo) => ({ photo, use: true })),
      };
    });
  });
  const rulesFound = match.rules_found ?? [];
  const acceptable = useMemo(() => acceptableRuleKeys(match.rules_found ?? []), [match.rules_found]);
  const [acceptedRules, setAcceptedRules] = useState<Set<RuleKey>>(() => new Set());
  const providedItems = useMemo(() => [...new Set(match.provided_items ?? [])], [match.provided_items]);
  const [provided, setProvided] = useState<Set<string>>(() => new Set());
  const [rights, setRights] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const included = spaces.filter((s) => s.include);
  const wanted = included.reduce((n, s) => n + s.photos.filter((p) => p.use).length, 0);
  const importing = rights ? wanted : 0;
  const errors = {
    name: !name.trim() ? "Give the venue a name." : null,
    spaces: included.length === 0 ? "Pick at least one space." : null,
  };
  const valid = !errors.name && !errors.spaces;

  const patchSpace = (i: number, patch: Partial<DraftSpace>) => setSpaces((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggle = <T,>(set: Set<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  const save = useMutation({
    mutationFn: async () => {
      const drafts = spaces.map((s) => ({
        sourceName: s.source.name,
        include: s.include,
        name: s.name,
        spec: s.spec,
        initialSpec: s.initialSpec,
        photos: s.photos.map((p) => ({ url: p.photo.url, use: p.use })),
        suggestedUrls: (s.source.photos ?? []).map((p) => p.url),
      }));
      const { skipped_photos: skippedPhotos = [], ...importedVenue } = await api.importVenue(
        buildImportPayload({
          researchJobId: jobId,
          matchIndex: matchIndex,
          spaces: drafts,
          acceptedRules: [...acceptedRules].filter((k) => acceptable.has(k)),
          acceptedProvidedItems: providedItems.filter((item) => provided.has(item)),
          rightsConfirmed: rights,
        }),
      );
      let venue = importedVenue;
      // The import uses the suggested names and details; apply the review edits on top.
      const followUps: Promise<unknown>[] = spacePatches(drafts, venue.spaces).map((p) => api.updateSpace(p.id, p.body));
      const wantedName = name.trim();
      if (wantedName && wantedName !== venue.name) followUps.push(api.updateVenue(venue.id, { name: wantedName }));
      const failed = (await Promise.allSettled(followUps)).find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (followUps.length) venue = await api.getVenue(venue.id).catch(() => venue);
      return { venue, skippedPhotos, failed: failed ? (failed.reason as unknown) : null };
    },
    onSuccess: ({ venue, skippedPhotos, failed }) => {
      void qc.invalidateQueries({ queryKey: qk.venues });
      qc.setQueryData(qk.venue(venue.id), venue);
      if (failed) {
        toast.warning("Venue added, but some edits weren't saved", {
          description: `${errorMessage(failed)} You can rename spaces and fix room details from the venue page.`,
        });
      } else if (!skippedPhotos.length) {
        toast.success("Venue added", { description: venue.name });
      }
      if (skippedPhotos.length) {
        toast.warning("Venue added, but some photos were skipped", {
          description: (
            <ul className="grid max-h-48 gap-1 overflow-y-auto break-all">
              {skippedPhotos.map(({ url, reason }) => <li key={url}>{url}: {reason}</li>)}
            </ul>
          ),
          duration: 10_000,
        });
      }
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
          <p className="text-sm text-muted-foreground">
            Untick spaces you won&apos;t use. Photos switched off, or imported without the confirmation below, are kept as reference only, never
            as the base.
          </p>
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
                            src={safeHttpUrl(p.photo.url) ?? undefined}
                            alt={p.photo.caption ?? `Photo of ${s.name}`}
                            className={cn("aspect-[3/2] w-full bg-muted object-cover transition-opacity duration-200", !p.use && "opacity-50")}
                            referrerPolicy="no-referrer"
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

      {rulesFound.length > 0 && (
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
            {rulesFound.map((rule, i) => {
              const id = `review-rule-${i}`;
              const key = rule.maps_to ?? null;
              const mapped = key ? RULE_LABELS[key] : null;
              const canAccept = key !== null && acceptable.has(key);
              const reason = !key
                ? "Not a rule the app can check; keep it in mind."
                : !canAccept
                  ? "The venue's sources disagree on this one, so it can't be applied automatically."
                  : null;
              return (
                <li key={`${rule.text}-${i}`} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      checked={canAccept && acceptedRules.has(key)}
                      disabled={!canAccept}
                      onCheckedChange={(accepted) => key && setAcceptedRules((all) => toggle(all, key, accepted))}
                      aria-describedby={reason ? `${id}-reason` : undefined}
                    />
                    <div className="grid gap-1">
                      <Label htmlFor={id} className="font-normal leading-snug">
                        “{rule.text}”
                      </Label>
                      <SourceLink href={rule.source} />
                      {reason && (
                        <p id={`${id}-reason`} className="text-xs text-muted-foreground">
                          {reason}
                        </p>
                      )}
                    </div>
                  </div>
                  {mapped && canAccept && (
                    <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                      {mapped.label}
                      <span className="text-muted-foreground">{rule.allowed ? " allowed" : " not allowed"}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {providedItems.length > 0 && (
        <section aria-labelledby="review-provided" className="grid gap-3">
          <div>
            <h3 id="review-provided" className="text-lg font-medium">
              Provided by the venue
            </h3>
            <p className="text-sm text-muted-foreground">Tick what the venue confirmed it provides. You can add more later.</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {providedItems.map((item, i) => {
              const id = `review-provided-${i}`;
              return (
                <li key={item} className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3">
                  <Checkbox id={id} className="mt-0.5" checked={provided.has(item)} onCheckedChange={(on) => setProvided((all) => toggle(all, item, on))} />
                  <Label htmlFor={id} className="font-normal leading-snug">
                    {item}
                  </Label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <footer className="grid gap-4 border-t pt-6">
        {wanted > 0 && (
          <div className="flex items-start gap-3">
            <Checkbox id="review-rights" className="mt-0.5" checked={rights} onCheckedChange={setRights} aria-describedby="review-rights-hint" />
            <div className="grid gap-1">
              <Label htmlFor="review-rights" className="font-normal leading-snug">
                I&apos;m using these photos for personal planning and will credit the source
              </Label>
              <p id="review-rights-hint" className="text-xs text-muted-foreground">
                {rights
                  ? `${importing} photo${importing === 1 ? "" : "s"} will be saved as base photos with their credit, which is shown on the photo and in PDF exports.`
                  : "Until you tick this, every photo is kept as reference only and nothing is downloaded."}
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={save.isPending}>
            {save.isPending ? "Importing…" : `Import ${included.length} space${included.length === 1 ? "" : "s"}`}
          </Button>
          {website && (
            <a
              href={website}
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
