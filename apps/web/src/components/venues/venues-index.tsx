"use client";

import { BuildingIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { QueryError } from "@/components/query-error";
import { SpotlightCard } from "@/components/spotlight";
import { VenueDialog } from "@/components/venues/venue-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useVenues } from "@/lib/queries";
import { RULE_KEYS, RULE_LABELS, formatDate } from "@/lib/spec";
import type { Venue } from "@/lib/types";

function restrictions(venue: Venue) {
  return RULE_KEYS.filter((k) => venue.rules[k] === false).map((k) => RULE_LABELS[k].label.toLowerCase());
}

export function VenuesIndex() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const venues = useVenues();
  const dialogOpen = open || params.get("new") === "1";

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && params.get("new")) router.replace(pathname, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl sm:text-6xl">Venues</h1>
          <p className="mt-2 text-muted-foreground">Each venue keeps its house rules and its rooms.</p>
        </div>
        <Button size="lg" onClick={() => setOpen(true)}>
          <PlusIcon />
          New venue
        </Button>
      </div>

      <div className="mt-10">
        {venues.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44 rounded-2xl" />
            ))}
          </div>
        ) : venues.error ? (
          <QueryError error={venues.error} onRetry={() => venues.refetch()} what="venues" />
        ) : venues.data.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed p-8 sm:p-12">
            <BuildingIcon className="size-6 text-muted-foreground" />
            <div>
              <p className="font-display text-3xl">Add your first venue</p>
              <p className="mt-1 max-w-md text-muted-foreground">
                Start with its name and house rules. Rooms and photos come next.
              </p>
            </div>
            <Button onClick={() => setOpen(true)}>
              <PlusIcon />
              New venue
            </Button>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {venues.data.map((venue) => {
              const limits = restrictions(venue);
              const cover = venue.spaces.flatMap((s) => s.photos).find((p) => p.approved || p.kind === "upload");
              return (
                <li key={venue.id}>
                  <SpotlightCard className="h-full transition-colors focus-within:border-ring hover:border-foreground/20">
                    <Link href={`/venues/${venue.id}`} className="flex h-full flex-col rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                      <div className="aspect-[16/7] overflow-hidden rounded-t-2xl border-b bg-muted">
                        {cover ? (
                          <img src={cover.url} alt="" className="size-full object-cover" />
                        ) : (
                          <div className="flex size-full items-center justify-center text-sm text-muted-foreground">No photos yet</div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-1 p-5">
                        <h2 className="font-display text-3xl leading-tight">{venue.name}</h2>
                        <p className="text-sm text-muted-foreground">
                          {venue.spaces.length === 1 ? "1 room" : `${venue.spaces.length} rooms`}, added {formatDate(venue.created_at)}
                        </p>
                        <p className="mt-auto pt-3 text-sm text-pretty">
                          {limits.length ? `No ${limits.join(", ")}` : "No restrictions noted"}
                        </p>
                      </div>
                    </Link>
                  </SpotlightCard>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <VenueDialog open={dialogOpen} onOpenChange={onOpenChange} />
    </div>
  );
}
