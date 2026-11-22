"use client";

import {
  ArrowLeftRightIcon,
  BuildingIcon,
  CpuIcon,
  DownloadIcon,
  GitBranchIcon,
  LayoutGridIcon,
  MoonIcon,
  PlusIcon,
  SaveIcon,
  SparklesIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { usePreferences } from "@/lib/preferences";
import { useBackends, useVenues } from "@/lib/queries";
import { useStudioActions } from "@/lib/studio-actions";

let open = false;
const listeners = new Set<() => void>();
function setOpen(next: boolean) {
  open = next;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function openCommandPalette() {
  setOpen(true);
}

export function CommandPalette() {
  const isOpen = useSyncExternalStore(subscribe, () => open, () => false);
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const studio = useStudioActions();
  const { engine, setEngine } = usePreferences();
  const venues = useVenues();
  const backends = useBackends();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const needsStudio = (label: string) => () => toast.info(`${label} works from a space's studio`, { description: "Open a space first." });

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to a venue or space, or run a studio action."
      className="sm:max-w-lg"
    >
      <CommandInput placeholder="Search venues, spaces and actions" />
      <CommandList>
        <CommandEmpty>Nothing matches that.</CommandEmpty>
        <CommandGroup heading="Studio">
          <CommandItem onSelect={run(studio?.renderAll ?? needsStudio("Render all"))}>
            <SparklesIcon />
            Render all photos
          </CommandItem>
          <CommandItem onSelect={run(studio?.saveLook ?? needsStudio("Save as Look"))}>
            <SaveIcon />
            Save as Look
          </CommandItem>
          <CommandItem onSelect={run(studio?.makeVariation ?? needsStudio("Make a variation"))}>
            <GitBranchIcon />
            Make a variation
          </CommandItem>
          <CommandItem onSelect={run(studio ? () => router.push(studio.compareHref) : needsStudio("Compare"))}>
            <ArrowLeftRightIcon />
            Compare Looks
          </CommandItem>
          <CommandItem onSelect={run(studio?.exportLook ?? needsStudio("Export"))}>
            <DownloadIcon />
            Export Look as PDF
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem onSelect={run(() => router.push("/venues?new=1"))}>
            <PlusIcon />
            New venue
          </CommandItem>
          <CommandItem onSelect={run(() => router.push("/venues"))}>
            <LayoutGridIcon />
            All venues
          </CommandItem>
          {venues.data?.map((venue) => (
            <CommandItem key={venue.id} value={`venue ${venue.name} ${venue.id}`} onSelect={run(() => router.push(`/venues/${venue.id}`))}>
              <BuildingIcon />
              {venue.name}
            </CommandItem>
          ))}
          {venues.data?.flatMap((venue) =>
            venue.spaces.map((space) => (
              <CommandItem
                key={space.id}
                value={`space ${venue.name} ${space.name} ${space.id}`}
                onSelect={run(() => router.push(`/spaces/${space.id}`))}
              >
                <SparklesIcon />
                <span>
                  {space.name}
                  <span className="text-muted-foreground">, {venue.name}</span>
                </span>
              </CommandItem>
            )),
          )}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Engine">
          {backends.data?.engines.map((e) => (
            <CommandItem
              key={e.id}
              value={`engine switch ${e.label} ${e.id}`}
              disabled={!e.available}
              data-checked={engine === e.id}
              onSelect={run(() => {
                setEngine(e.id);
                toast.success(`Engine set to ${e.label}`);
              })}
            >
              <CpuIcon />
              Switch engine to {e.label}
              {!e.available && <CommandShortcut>Unavailable</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem onSelect={run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
            <MoonIcon />
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
