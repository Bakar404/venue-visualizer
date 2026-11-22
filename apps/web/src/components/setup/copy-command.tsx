"use client";

import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

/**
 * A terminal command with a copy button, labelled "Copy {name}", then "Copied {name}" or "Couldn't copy {name}". It
 * copies without `navigator.clipboard` too (plain-http LAN pages). `note` is what to do after running it: plain text,
 * not copied.
 */
export function CopyCommand({
  label,
  command,
  name,
  testId,
  note,
  noteTestId,
}: {
  label: string;
  command: string;
  name: string;
  testId: string;
  note?: string | null;
  noteTestId?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-start gap-1 rounded-lg bg-muted/60 py-1 pr-1 pl-3 ring-1 ring-border/70">
        <code data-testid={testId} className="min-w-0 flex-1 self-center py-1 font-mono text-sm break-words whitespace-pre-wrap select-all">
          {command}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={state === "copied" ? `Copied ${name}` : state === "failed" ? `Couldn't copy ${name}` : `Copy ${name}`}
          onClick={() => void copyText(command).then((ok) => setState(ok ? "copied" : "failed"))}
        >
          {state === "copied" ? <CheckIcon className="text-brand" /> : state === "failed" ? <XIcon className="text-destructive" /> : <CopyIcon />}
        </Button>
      </div>
      {note && (
        <p data-testid={noteTestId} className="mt-1.5 text-sm text-pretty text-muted-foreground">
          {note}
        </p>
      )}
      {state === "failed" && (
        <p role="status" className="mt-1.5 text-sm text-destructive">
          Couldn&apos;t copy. Select the command and copy it yourself.
        </p>
      )}
    </div>
  );
}
