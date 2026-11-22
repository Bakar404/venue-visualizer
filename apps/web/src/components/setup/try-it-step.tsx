"use client";

import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { useVenues } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Step 3: somewhere to go once the defaults are saved. */
export function TryItStep({ ready }: { ready: boolean }) {
  const venues = useVenues();
  if (!ready) {
    return <p className="text-pretty text-muted-foreground">Finish the two steps above and this opens up.</p>;
  }
  // The sample venue the app ships with, or the landing page's samples when there is none yet.
  const demo = venues.data?.[0];
  return (
    <div className="grid gap-4">
      <p className="text-pretty">You&apos;re set up. Start with the sample venue to see how it works, or bring your own photos.</p>
      <div className="flex flex-wrap gap-3">
        <Link href={demo ? `/venues/${demo.id}` : "/"} className={cn(buttonVariants({ size: "lg" }), "h-11 px-5")}>
          Open the demo venue
          <ArrowRightIcon aria-hidden />
        </Link>
        <Link href="/venues/new" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-5")}>
          Add my venue
        </Link>
      </div>
    </div>
  );
}
