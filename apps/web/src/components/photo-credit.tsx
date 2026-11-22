import { GlobeIcon } from "lucide-react";

import { safeHttpUrl } from "@/lib/url";
import { cn } from "@/lib/utils";

/** `source_page` is where the photo was found; `source_url` (the image itself) is the fallback. */
type Credited = { credit?: string | null; source_url?: string | null; source_page?: string | null };

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
  const source = photo.source_page || photo.source_url;
  if (!photo.credit && !source) return null;
  const label = photo.credit ?? hostOf(source!);
  const href = safeHttpUrl(source);
  const chip = "inline-flex max-w-full items-center gap-1 truncate rounded-full bg-black/55 px-2 py-0.5 text-[11px] leading-4 text-white backdrop-blur-sm";
  if (!asLink || !href) {
    return (
      <span className={cn(chip, className)} title={source ? `Source: ${source}` : undefined}>
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
      href={href}
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
