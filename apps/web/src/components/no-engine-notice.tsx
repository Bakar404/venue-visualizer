"use client";

import { ArrowUpRightIcon, ImageOffIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useBackends } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Install guides for the engines listed in the README's "Bring your own AI: no API keys" section. */
const ENGINE_LINKS = [
  { label: "Copilot CLI", href: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli" },
  { label: "Codex CLI", href: "https://github.com/openai/codex" },
  { label: "mflux", href: "https://github.com/mflux-community/mflux" },
];

/** Shown instead of a render button when `/api/system/backends` reports no usable image engine. */
export function NoEngineNotice({ className }: { className?: string }) {
  const backends = useBackends();
  return (
    <div role="status" className={cn("rounded-xl border border-dashed p-4 text-sm", className)}>
      <p className="flex items-center gap-2 font-medium">
        <ImageOffIcon aria-hidden className="size-4 text-muted-foreground" />
        No image engine found — install/log in to Copilot CLI, Codex CLI, or mflux
      </p>
      <p className="mt-1 text-muted-foreground">
        See <span className="font-medium text-foreground">Bring your own AI: no API keys</span> in the README, then recheck.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {ENGINE_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
          >
            {l.label}
            <ArrowUpRightIcon aria-hidden className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ))}
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => void backends.refetch()} disabled={backends.isFetching}>
          <RefreshCwIcon aria-hidden />
          Recheck
        </Button>
      </div>
    </div>
  );
}
