"use client";

import { RefreshCwIcon } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api";

export function QueryError({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what: string }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-8">
      <p className="font-display text-3xl">{notFound ? `This ${what} doesn't exist` : `Couldn't load the ${what}`}</p>
      <p className="max-w-prose text-sm text-muted-foreground">
        {notFound ? "It may have been deleted. Pick another from your venues." : errorMessage(error)}
      </p>
      <div className="flex gap-2">
        {!notFound && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon />
            Try again
          </Button>
        )}
        <Link href="/venues" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Go to venues
        </Link>
      </div>
    </div>
  );
}
