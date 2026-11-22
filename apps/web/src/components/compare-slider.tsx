"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/utils";

type Props = {
  before: string;
  after: string | null;
  beforeAlt: string;
  afterAlt: string;
  className?: string;
  /** Rendered over the image area, e.g. a progress overlay. */
  children?: React.ReactNode;
  initial?: number;
  beforeLabel?: string;
  afterLabel?: string;
};

/**
 * Before/after comparison. A native range input drives the split, so it works with
 * arrow keys, Home/End and screen readers. The split follows the pointer with no easing.
 */
export function CompareSlider({ before, after, beforeAlt, afterAlt, className, children, initial = 50, beforeLabel = "Before", afterLabel = "After" }: Props) {
  const [pos, setPos] = useState(initial);
  const id = useId();

  return (
    <div className={cn("group/compare relative isolate overflow-hidden bg-muted select-none", className)}>
      <img src={before} alt={beforeAlt} className="absolute inset-0 size-full object-cover" draggable={false} />
      {after && (
        <>
          <img
            src={after}
            alt={afterAlt}
            className="absolute inset-0 size-full object-cover"
            style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
            draggable={false}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/90 shadow-[0_0_0_1px_rgb(0_0_0/0.15)]"
            style={{ left: `${pos}%` }}
          >
            <div className="absolute top-1/2 left-1/2 flex h-9 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-0.5 rounded-full bg-white/95 shadow-md ring-1 ring-black/10 group-has-focus-visible/compare:ring-2 group-has-focus-visible/compare:ring-ring">
              <span className="h-3.5 w-px bg-stone-400" />
              <span className="h-3.5 w-px bg-stone-400" />
            </div>
          </div>
          <span className="pointer-events-none absolute top-3 left-3 z-10 rounded-full bg-black/45 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
            {beforeLabel}
          </span>
          <span className="pointer-events-none absolute top-3 right-3 z-10 rounded-full bg-black/45 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
            {afterLabel}
          </span>
          <label htmlFor={id} className="sr-only">
            Comparison split. Lower values show more of {afterLabel === "After" ? "the render" : afterLabel}.
          </label>
          <input
            id={id}
            type="range"
            min={0}
            max={100}
            step={1}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-valuetext={`${pos}% ${beforeLabel === "Before" ? "original photo" : beforeLabel}`}
            className="absolute inset-0 z-20 size-full cursor-ew-resize opacity-0"
          />
        </>
      )}
      {children}
    </div>
  );
}
