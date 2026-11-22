"use client";

import { BuildingIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { PhotoCredit } from "@/components/photo-credit";
import { QueryError } from "@/components/query-error";
import { SpotlightCard } from "@/components/spotlight";
import { buttonVariants } from "@/components/ui/button";
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
  const venues = useVenues();
  const legacyNew = params.get("new") === "1";

  // Old links (`/venues?new=1`) now open the new-venue page.
  useEffect(() => {
    if (legacyNew) router.replace("/venues/new");
  }, [legacyNew, router]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl sm:text-6xl">Venues</h1>
          <p className="mt-2 text-muted-foreground">Each venue keeps its house rules and its rooms.</p>
        </div>
        <Link href="/venues/new" className={buttonVariants({ size: "lg" })}>
          <PlusIcon />
          New venue
        </Link>
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
                Find it by name, upload photos or a video tour, or describe it.
              </p>
            </div>
            <Link href="/venues/new" className={buttonVariants()}>
              <PlusIcon />
              New venue
            </Link>
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
                      <div className="relative aspect-[16/7] overflow-hidden rounded-t-2xl border-b bg-muted">
                        {cover ? (
                          <>
                            <img src={cover.url} alt="" className="size-full object-cover" />
                            <PhotoCredit photo={cover} asLink={false} className="absolute right-2 bottom-2 max-w-[70%]" />
                          </>
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
    </div>
  );
}
