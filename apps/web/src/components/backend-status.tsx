"use client";

import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useBackends } from "@/lib/queries";
import type { BackendStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusDot({ backend, className }: { backend: Pick<BackendStatus, "available" | "logged_in">; className?: string }) {
  const state = !backend.available ? "off" : backend.logged_in === false ? "warn" : "on";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        state === "on" && "bg-brand shadow-[0_0_0_3px_var(--brand-soft)]",
        state === "warn" && "bg-amber-500 shadow-[0_0_0_3px_oklch(0.8_0.15_80/0.2)]",
        state === "off" && "border border-muted-foreground/60",
        className,
      )}
    />
  );
}

export function statusText(b: BackendStatus) {
  if (!b.available) return "Not found";
  if (b.logged_in === false) return "Signed out";
  return b.version ? `Ready, ${b.version}` : "Ready";
}

function Row({ backend }: { backend: BackendStatus }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <StatusDot backend={backend} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-medium">{backend.label}</span>
          <span className={cn("text-sm", backend.available ? "text-foreground/80" : "text-muted-foreground")}>
            {statusText(backend)}
          </span>
        </div>
        {(backend.detail || backend.caps?.cost_note) && (
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{backend.detail ?? backend.caps?.cost_note}</p>
        )}
      </div>
    </li>
  );
}

/** Live list of brains and engines detected by the local API (`GET /api/system/backends`). */
export function BackendList() {
  const { data, error, isPending, refetch, isFetching } = useBackends();

  if (isPending) {
    return (
      <div className="grid gap-8 sm:grid-cols-2" aria-busy>
        {[0, 1].map((i) => (
          <div key={i} className="space-y-4">
            <Skeleton className="h-5 w-24" />
            {[0, 1, 2].map((j) => (
              <Skeleton key={j} className="h-10 w-full" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-dashed p-6">
        <p className="font-medium">Can&apos;t reach the local API</p>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{errorMessage(error)}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCwIcon className={cn(isFetching && "animate-spin")} />
          Check again
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
      {(
        [
          ["Brains", "Turn your words into a decor plan", data.brains],
          ["Photo engines", "Edit the plan into your photos, photoreal", data.engines],
        ] as const
      ).map(([title, hint, list]) => (
        <section key={title} aria-label={title}>
          <h3 className="font-display text-2xl">{title}</h3>
          <p className="text-sm text-muted-foreground">{hint}</p>
          <ul className="mt-2 divide-y">
            {list.map((b) => (
              <Row key={b.id} backend={b} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
