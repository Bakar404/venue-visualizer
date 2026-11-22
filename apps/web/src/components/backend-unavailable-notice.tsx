"use client";

import { ArrowRightIcon, CircleAlertIcon } from "lucide-react";
import Link from "next/link";

import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/**
 * Explains, in plain words, that the brain or image engine chosen earlier has stopped working (signed out,
 * uninstalled), and that the Studio is using a ready one meanwhile. Links to /setup to fix it.
 */
export function BackendUnavailableNotice({ className }: { className?: string }) {
  const { unavailable } = usePreferences();
  const broken = [unavailable.engine, unavailable.brain].filter((b) => b !== null);
  if (!broken.length) return null;
  return (
    <div
      role="status"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning-border bg-warning px-4 py-2 text-sm text-warning-foreground lg:px-6", className)}
    >
      <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        {broken.map((b) => (
          <span key={b.id} className="block">
            <span className="font-medium">{b.label} isn&apos;t ready:</span> {b.detail ?? "it stopped answering."}{" "}
            <span className="opacity-90">Using another {b.kind === "brain" ? "brain" : "image engine"} for now.</span>
          </span>
        ))}
      </p>
      <Link
        href="/setup"
        className="inline-flex min-h-11 items-center gap-1 rounded-md font-medium underline-offset-4 hover:underline lg:min-h-0"
      >
        Open setup
        <ArrowRightIcon aria-hidden className="size-3.5" />
      </Link>
    </div>
  );
}
