"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** A terminal command with a copy button. The button is labelled "Copy {name}", then "Copied {name}". */
export function CopyCommand({ label, command, name, testId }: { label: string; command: string; name: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-start gap-1 rounded-lg bg-muted/60 py-1 pr-1 pl-3 ring-1 ring-border/70">
        <code data-testid={testId} className="min-w-0 flex-1 self-center py-1 font-mono text-sm break-words whitespace-pre-wrap">
          {command}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? `Copied ${name}` : `Copy ${name}`}
          onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}
        >
          {copied ? <CheckIcon className="text-brand" /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}
