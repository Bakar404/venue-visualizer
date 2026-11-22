"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { FilmIcon, ImagesIcon, PencilLineIcon, SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { DescribeIt } from "@/components/new-venue/describe-it";
import { FindVenue } from "@/components/new-venue/find-venue";
import { UploadVenue } from "@/components/new-venue/upload-venue";
import { VideoTour } from "@/components/new-venue/video-tour";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "find", label: "Find my venue", hint: "Search the web by name", icon: SearchIcon },
  { id: "upload", label: "Upload photos", hint: "Photos you already have", icon: ImagesIcon },
  { id: "video", label: "Video tour", hint: "A walk-through video", icon: FilmIcon },
  { id: "describe", label: "Describe it", hint: "I don't have photos", icon: PencilLineIcon },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function NewVenue() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : "find";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
      <h1 className="font-display text-5xl sm:text-6xl">New venue</h1>
      <p className="mt-2 max-w-2xl text-pretty text-muted-foreground">
        Every way in ends the same: photos of the empty room, a short description of it, and the house rules you confirm.
      </p>

      <TabsPrimitive.Root value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })} className="mt-8">
        <TabsPrimitive.List aria-label="How to add the venue" className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {TABS.map(({ id, label, hint, icon: Icon }) => (
            <TabsPrimitive.Tab
              key={id}
              value={id}
              className={cn(
                "group flex min-h-16 items-start gap-3 rounded-xl border bg-card p-3 text-left outline-none transition-[border-color,background-color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] sm:p-4",
                "data-active:border-brand data-active:bg-brand-soft [@media(hover:hover)]:hover:border-foreground/25",
              )}
            >
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground group-data-active:text-brand" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </TabsPrimitive.Tab>
          ))}
        </TabsPrimitive.List>

        {/* Panels stay mounted so a running search or upload survives switching tabs. */}
        <TabsPrimitive.Panel value="find" keepMounted className="mt-8 outline-none">
          <FindVenue />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="upload" keepMounted className="mt-8 outline-none">
          <UploadVenue />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="video" keepMounted className="mt-8 outline-none">
          <VideoTour />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="describe" keepMounted className="mt-8 outline-none">
          <DescribeIt />
        </TabsPrimitive.Panel>
      </TabsPrimitive.Root>
    </div>
  );
}
