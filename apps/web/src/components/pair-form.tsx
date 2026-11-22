"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The phone half of "Open on your phone": type the 6-digit code shown in Setup on the computer. */
export function PairForm() {
  const id = useId();
  const [code, setCode] = useState("");
  const pair = useMutation({ mutationFn: (c: string) => api.pairDevice(c) });

  if (pair.isSuccess) {
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

  const digits = code.replace(/\D/g, "");
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (digits.length === 6) pair.mutate(digits);
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
          setCode(e.target.value.replace(/[^\d\s]/g, "").slice(0, 7));
          pair.reset();
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{3} ?\d{3}"
        placeholder="123 456"
        aria-invalid={pair.isError || undefined}
        aria-describedby={pair.isError ? `${id}-error` : `${id}-hint`}
        className="h-14 font-mono text-2xl! tracking-[0.3em] tabular-nums pointer-coarse:h-14"
        autoFocus
      />
      {pair.isError ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {errorMessage(pair.error)} Check the code on the computer and try again.
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          On the computer: Setup → Advanced → Open on your phone.
        </p>
      )}
      <Button type="submit" size="lg" className="mt-2 h-12 text-base" disabled={digits.length !== 6 || pair.isPending}>
        Pair
      </Button>
    </form>
  );
}
