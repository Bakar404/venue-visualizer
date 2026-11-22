"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { openCommandPalette } from "@/components/command-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isMockMode } from "@/lib/api";
import { shortName } from "@/lib/backends";
import { usePreferences } from "@/lib/preferences";
import { useSetupStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

const navLink =
  "inline-flex items-center rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11";

/** Green "Claude Code + Copilot" when setup is done, amber "Set up AI" when not. Either way it opens /setup. */
function AiStatusChip() {
  const setup = useSetupStatus();
  const { brain, engine } = usePreferences();
  if (!setup.data) return null;
  const ready = setup.data.complete && brain && engine;
  const names = ready ? `${shortName(brain)} + ${shortName(engine)}` : "";
  return (
    <Link
      href="/setup"
      aria-label={ready ? `AI ready: ${names}` : "Set up AI"}
      title={ready ? `AI ready: ${names}. Open setup.` : "Finish setting up your AI tools"}
      className={cn(
        "inline-flex h-8 min-w-0 items-center gap-2 rounded-full px-3 text-sm ring-1 ring-inset transition-colors pointer-coarse:h-11",
        ready
          ? "text-muted-foreground ring-border hover:text-foreground max-sm:px-0 max-sm:ring-0 pointer-coarse:max-sm:w-11 pointer-coarse:max-sm:justify-center"
          : "bg-warning font-medium text-warning-foreground ring-warning-border",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          ready ? "bg-brand shadow-[0_0_0_3px_var(--brand-soft)]" : "bg-amber-500 shadow-[0_0_0_3px_oklch(0.8_0.15_80/0.25)]",
        )}
      />
      {ready ? <span className="truncate max-sm:sr-only">{names}</span> : <span className="whitespace-nowrap">Set up AI</span>}
    </Link>
  );
}

function VenuesLink() {
  const pathname = usePathname();
  const inVenues = pathname.startsWith("/venues") || pathname.startsWith("/spaces") || pathname.startsWith("/compare");
  return (
    <Link href="/venues" aria-current={inVenues ? "true" : undefined} className={cn(navLink, inVenues && "text-foreground")}>
      Venues
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 pt-[var(--safe-top,env(safe-area-inset-top,0px))] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] backdrop-blur-md supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <Link href="/" className="flex min-h-11 min-w-0 shrink items-center gap-2 rounded-sm">
          <span className="truncate font-display text-[1.3rem] leading-none tracking-tight sm:text-[1.45rem]">Venue Visualizer</span>
        </Link>
        {isMockMode && (
          <Badge variant="outline" className="hidden text-muted-foreground sm:inline-flex" title="Showing sample data from NEXT_PUBLIC_VV_MOCK=1">
            Demo data
          </Badge>
        )}
        <nav aria-label="Main" className="ml-auto flex shrink-0 items-center gap-1">
          <AiStatusChip />
          <Suspense
            fallback={
              <Link href="/venues" className={navLink}>
                Venues
              </Link>
            }
          >
            <VenuesLink />
          </Suspense>
          <Button variant="outline" size="sm" className="gap-2 text-muted-foreground pointer-coarse:max-sm:w-11" onClick={openCommandPalette}>
            <SearchIcon />
            <span className="hidden sm:inline">Search or run</span>
            <kbd className="pointer-events-none hidden rounded border bg-muted px-1 text-[0.7rem] text-muted-foreground sm:inline">⌘K</kbd>
            <span className="sr-only sm:hidden">Open command palette</span>
          </Button>
          {/* On phones the theme lives in the command palette, to leave room for the AI chip. */}
          <div className="max-sm:hidden">
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  );
}
