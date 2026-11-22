"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRetryCountdown } from "@/hooks/use-retry-countdown";
import { api, ApiError, errorMessage } from "@/lib/api";
import { safeNext } from "@/lib/pairing";
import { cn } from "@/lib/utils";

/** The phone half of "Open on your phone": type the 6-digit code shown in Setup on the computer. */
export function PairForm() {
  const id = useId();
  const router = useRouter();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  // Sticky: once this phone is paired, later edits or errors don't undo it.
  const [paired, setPaired] = useState(false);
  const retry = useRetryCountdown();
  const pair = useMutation({
    mutationFn: (c: string) => api.pairDevice(c),
    onSuccess: () => {
      setPaired(true);
      // Everything fetched before pairing was a 403; fetch it again now.
      void qc.invalidateQueries();
      const next = new URLSearchParams(window.location.search).get("next");
      if (next !== null) router.replace(safeNext(next, window.location.origin));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 429) retry.start(error.retryAfter ?? 60);
    },
  });

  if (paired) {
    return (
      <div className="grid gap-5">
        <p role="status" className="flex items-start gap-2 text-lg text-pretty">
          <CheckCircle2Icon aria-hidden className="mt-1 size-5 shrink-0 text-brand" />
          This phone is paired. It stays paired until it&apos;s forgotten in Setup on the computer.
        </p>
        <Link href="/" className={cn(buttonVariants({ size: "lg" }), "h-12 w-full text-base sm:w-auto")}>
          Open Venue Visualizer
        </Link>
      </div>
    );
  }

  const waiting = retry.wait !== null;
  const showError = pair.isError && !waiting;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6 && !pair.isPending && !waiting) pair.mutate(code);
      }}
    >
      <Label htmlFor={id} className="text-base">
        Pairing code
      </Label>
      <Input
        id={id}
        name="code"
        value={code}
        onChange={(e) => {
          // Digits only, so a pasted "12 34 56" or "123-456" works.
          setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
          if (!pair.isPending && pair.isError) pair.reset();
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        aria-invalid={showError || undefined}
        aria-describedby={waiting ? `${id}-retry` : showError ? `${id}-error` : `${id}-hint`}
        className="h-14 font-mono text-2xl! tracking-[0.3em] tabular-nums pointer-coarse:h-14"
        autoFocus
      />
      {waiting ? (
        <p id={`${id}-retry`} role="alert" data-testid="pair-retry" className="text-sm text-destructive tabular-nums">
          Too many attempts. Try again in {retry.wait?.left} s.
        </p>
      ) : showError ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {errorMessage(pair.error)} Check the code on the computer and try again.
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          On the computer: Setup → Advanced → Open on your phone.
        </p>
      )}
      <Button type="submit" size="lg" className="mt-2 h-12 text-base" disabled={code.length !== 6 || pair.isPending || waiting}>
        Pair
      </Button>
    </form>
  );
}
