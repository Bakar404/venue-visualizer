"use client";

import { CheckIcon, ImageIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";

import { PhotoCredit } from "@/components/photo-credit";
import { QueryError } from "@/components/query-error";
import { SpotlightCard } from "@/components/spotlight";
import { hasVenueSpec } from "@/components/venue-spec-fields";
import { SpaceDialog } from "@/components/venues/space-dialog";
import { VenueDialog } from "@/components/venues/venue-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useVenue } from "@/lib/queries";
import { RULE_KEYS, RULE_LABELS, isAllowed } from "@/lib/spec";
import type { Space } from "@/lib/types";
import { cn } from "@/lib/utils";

function spaceSummary(space: Space) {
  const parts = [space.venue_spec.style, space.venue_spec.length_ft && space.venue_spec.width_ft ? `${space.venue_spec.length_ft} by ${space.venue_spec.width_ft} ft` : null].filter(Boolean);
  return parts.join(", ");
}

export function VenueDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const venue = useVenue(id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  if (venue.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-14 w-72" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (venue.error) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6">
        <QueryError error={venue.error} onRetry={() => venue.refetch()} what="venue" />
      </div>
    );
  }

  const v = venue.data;
  const provided = v.rules.provided_items ?? [];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6 lg:py-14">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/venues" className="rounded-sm hover:text-foreground">
          Venues
        </Link>
      </nav>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-5xl text-balance sm:text-6xl">{v.name}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon />
            Edit venue
          </Button>
          <Button onClick={() => setAdding(true)}>
            <PlusIcon />
            Add a room
          </Button>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)] lg:gap-14">
        <section aria-labelledby="rules-heading" className="lg:sticky lg:top-24 lg:self-start">
          <h2 id="rules-heading" className="font-display text-3xl">
            House rules
          </h2>
          <ul className="mt-4 divide-y border-y">
            {RULE_KEYS.map((key) => {
              const ok = isAllowed(v.rules, key);
              return (
                <li key={key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className={cn(!ok && "text-foreground", ok && "text-muted-foreground")}>{RULE_LABELS[key].label}</span>
                  <span className={cn("inline-flex items-center gap-1.5", ok ? "text-muted-foreground" : "font-medium text-warning-foreground")}>
                    {ok ? <CheckIcon className="size-3.5" /> : <XIcon className="size-3.5" />}
                    {ok ? "Allowed" : "Not allowed"}
                  </span>
                </li>
              );
            })}
          </ul>
          {provided.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium">Provided by the venue</h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {provided.map((item) => (
                  <li key={item} className="rounded-md bg-secondary px-2 py-0.5 text-sm">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {v.rules.notes && <p className="mt-6 text-sm leading-relaxed text-pretty text-muted-foreground">{v.rules.notes}</p>}
        </section>

        <section aria-labelledby="rooms-heading">
          <h2 id="rooms-heading" className="font-display text-3xl">
            Rooms
          </h2>
          {v.spaces.length === 0 ? (
            <div className="mt-4 flex flex-col items-start gap-4 rounded-2xl border border-dashed p-8">
              <p className="max-w-md text-muted-foreground">
                Add the first room you&apos;ll decorate. Photos make the best renders, but a written description works too.
              </p>
              <Button onClick={() => setAdding(true)}>
                <PlusIcon />
                Add a room
              </Button>
            </div>
          ) : (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {v.spaces.map((space) => {
                const usable = space.photos.filter((p) => p.kind === "upload" || p.approved);
                return (
                  <li key={space.id}>
                    <SpotlightCard className="h-full transition-colors hover:border-foreground/20">
                      <Link href={`/spaces/${space.id}`} className="flex h-full flex-col rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                        <div className="grid aspect-[16/9] grid-cols-3 gap-px overflow-hidden rounded-t-2xl border-b bg-border">
                          {usable.length ? (
                            <>
                              <div className={cn("relative", usable.length > 1 ? "col-span-2" : "col-span-3")}>
                                <img src={usable[0].url} alt="" className="size-full bg-muted object-cover" />
                                <PhotoCredit photo={usable[0]} asLink={false} className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]" />
                              </div>
                              {usable.length > 1 && (
                                <div className="grid gap-px">
                                  {usable.slice(1, 3).map((p) => (
                                    <img key={p.id} src={p.url} alt="" className="size-full bg-muted object-cover" />
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="col-span-3 flex flex-col items-center justify-center gap-2 bg-muted text-sm text-muted-foreground">
                              <ImageIcon className="size-5" />
                              {hasVenueSpec(space.venue_spec) ? "Described, no photos yet" : "No photos yet"}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col gap-1 p-5">
                          <h3 className="font-display text-2xl leading-tight">{space.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {usable.length === 1 ? "1 photo" : `${usable.length} photos`}
                            {spaceSummary(space) ? `, ${spaceSummary(space)}` : ""}
                          </p>
                          <span className="mt-auto pt-3 text-sm font-medium text-brand">Open studio</span>
                        </div>
                      </Link>
                    </SpotlightCard>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <VenueDialog open={editing} onOpenChange={setEditing} venue={v} />
      <SpaceDialog venueId={v.id} open={adding} onOpenChange={setAdding} />
    </div>
  );
}
