"use client";

import { XIcon } from "lucide-react";
import { useId, useState } from "react";

import { colorFor } from "@/lib/spec";
import { cn } from "@/lib/utils";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Accessible name for the text input. */
  label: string;
  id?: string;
  swatches?: boolean;
  max?: number;
  className?: string;
};

/** Free-text chips. Enter or comma adds; Backspace on an empty input removes the last chip. */
export function ChipsInput({ value, onChange, placeholder, label, id, swatches, max, className }: Props) {
  const [draft, setDraft] = useState("");
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const full = max !== undefined && value.length >= max;

  const commit = (text = draft) => {
    const items = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
    if (items.length) onChange([...value, ...items].slice(0, max ?? Infinity));
    setDraft("");
  };

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      {value.map((chip) => (
        <span key={chip} className="inline-flex items-center gap-1.5 rounded-md bg-secondary py-0.5 pr-1 pl-2 text-secondary-foreground">
          {swatches && (
            <span aria-hidden className="size-3 rounded-full ring-1 ring-black/10" style={{ background: colorFor(chip) }} />
          )}
          {chip}
          <button
            type="button"
            className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label={`Remove ${chip}`}
            onClick={() => onChange(value.filter((v) => v !== chip))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        aria-label={label}
        value={draft}
        disabled={full}
        placeholder={full ? "" : placeholder}
        onChange={(e) => {
          if (e.target.value.includes(",")) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit()}
        className="min-w-24 flex-1 bg-transparent px-1 py-0.5 outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
