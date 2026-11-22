"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { ImageIcon, ListChecksIcon, MessageCircleIcon, PanelsTopLeftIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StudioTab = "photos" | "canvas" | "chat" | "plan";

/** Ids that tie each tab to its panel. Chat and Plan share the right-hand pane, which shows the chat or the plan. */
export const studioTabId = (tab: StudioTab) => `studio-tab-${tab}`;
export const studioPanelId = (tab: StudioTab) => `studio-panel-${tab === "chat" ? "plan" : tab}`;

const TABS: { value: StudioTab; label: string; icon: typeof ImageIcon }[] = [
  { value: "photos", label: "Photos", icon: PanelsTopLeftIcon },
  { value: "canvas", label: "Preview", icon: ImageIcon },
  { value: "chat", label: "Chat", icon: MessageCircleIcon },
  { value: "plan", label: "Plan", icon: ListChecksIcon },
];

type Props = {
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
  onRender: () => void;
  renderDisabled: boolean;
  rendering: boolean;
  busy: boolean;
  photoCount: number;
  className?: string;
};

/** The phone Studio's bottom bar: the four panes as tabs, with Render always one thumb away. */
export function StudioTabBar({ tab, onTab, onRender, renderDisabled, rendering, busy, photoCount, className }: Props) {
  return (
    <div
      data-testid="studio-tab-bar"
      className={cn(
        "flex items-stretch gap-1 border-t bg-background/95 px-2 pt-1.5 pb-1.5 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))] backdrop-blur supports-backdrop-filter:bg-background/80",
        className,
      )}
    >
      <TabsPrimitive.Root value={tab} onValueChange={(v) => onTab(v as StudioTab)} className="min-w-0 flex-1">
        <TabsPrimitive.List aria-label="Studio" className="grid h-full grid-cols-4">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsPrimitive.Tab
              key={value}
              value={value}
              id={studioTabId(value)}
              aria-controls={studioPanelId(value)}
              className="group flex min-h-12 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[0.8125rem] font-medium text-muted-foreground outline-none transition-[color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96] data-active:text-foreground"
            >
              <Icon aria-hidden className="size-5 transition-colors group-data-active:text-brand" strokeWidth={1.75} />
              {label}
            </TabsPrimitive.Tab>
          ))}
        </TabsPrimitive.List>
      </TabsPrimitive.Root>
      <Button
        onClick={onRender}
        disabled={renderDisabled}
        aria-busy={busy || undefined}
        aria-label={rendering ? "Rendering…" : `Render all photos${photoCount ? ` (${photoCount})` : ""}`}
        className="h-auto min-h-12 shrink-0 self-center bg-brand px-3.5 text-brand-foreground hover:bg-brand/90"
      >
        <SparklesIcon aria-hidden />
        {rendering ? "Rendering…" : "Render"}
      </Button>
    </div>
  );
}
