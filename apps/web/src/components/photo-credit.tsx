import { GlobeIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Credited = { credit?: string | null; source_url?: string | null };

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Credit for a photo found on the web: who took or published it, linked to the page it came from.
 * Use `asLink={false}` inside another link (cards) so anchors aren't nested; the source is still named.
 */
export function PhotoCredit({ photo, asLink = true, className }: { photo: Credited; asLink?: boolean; className?: string }) {
  if (!photo.credit && !photo.source_url) return null;
  const label = photo.credit ?? hostOf(photo.source_url!);
  const chip = "inline-flex max-w-full items-center gap-1 truncate rounded-full bg-black/55 px-2 py-0.5 text-[11px] leading-4 text-white backdrop-blur-sm";
  if (!asLink || !photo.source_url) {
    return (
      <span className={cn(chip, className)} title={photo.source_url ? `Source: ${photo.source_url}` : undefined}>
        <GlobeIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">
          <span className="sr-only">Photo credit: </span>
          {label}
        </span>
      </span>
    );
  }
  return (
    <a
      href={photo.source_url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        chip,
        "underline-offset-2 transition-colors hover:bg-black/70 hover:underline focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
        className,
      )}
    >
      <GlobeIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">
        <span className="sr-only">Photo credit: </span>
        {label}
        <span className="sr-only"> (opens the source page in a new tab)</span>
      </span>
    </a>
  );
}
