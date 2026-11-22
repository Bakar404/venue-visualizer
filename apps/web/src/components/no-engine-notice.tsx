"use client";

import { ArrowRightIcon, ImageOffIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { useRefreshBackends } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Shown instead of a render button when `/api/system/backends` reports no usable image engine. */
export function NoEngineNotice({ className }: { className?: string }) {
  const refresh = useRefreshBackends();
  return (
    <div role="status" className={cn("rounded-xl border border-dashed p-4 text-sm", className)}>
      <p className="flex items-center gap-2 font-medium">
        <ImageOffIcon aria-hidden className="size-4 text-muted-foreground" />
        No image engine is ready yet
      </p>
      <p className="mt-1 text-muted-foreground">
        The image engine paints your plan onto the room photos. Setup shows how to add one, step by step.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href="/setup" className={buttonVariants({ size: "sm" })}>
          Open setup
          <ArrowRightIcon aria-hidden />
        </Link>
        <Button type="button" size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCwIcon aria-hidden />
          {refresh.isPending ? "Checking…" : "Check again"}
        </Button>
      </div>
    </div>
  );
}
