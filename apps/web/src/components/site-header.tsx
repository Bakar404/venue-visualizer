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
import { cn } from "@/lib/utils";

const navLink = "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground";

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
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2 rounded-sm">
          <span className="font-display text-[1.45rem] leading-none tracking-tight">Venue Visualizer</span>
        </Link>
        {isMockMode && (
          <Badge variant="outline" className="hidden text-muted-foreground sm:inline-flex" title="Showing sample data from NEXT_PUBLIC_VV_MOCK=1">
            Demo data
          </Badge>
        )}
        <nav aria-label="Main" className="ml-auto flex items-center gap-1">
          <Suspense
            fallback={
              <Link href="/venues" className={navLink}>
                Venues
              </Link>
            }
          >
            <VenuesLink />
          </Suspense>
          <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" onClick={openCommandPalette}>
            <SearchIcon />
            <span className="hidden sm:inline">Search or run</span>
            <kbd className="pointer-events-none hidden rounded border bg-muted px-1 text-[0.7rem] text-muted-foreground sm:inline">⌘K</kbd>
            <span className="sr-only sm:hidden">Open command palette</span>
          </Button>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
