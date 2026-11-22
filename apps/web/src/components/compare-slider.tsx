"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";

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
  /**
   * For static images in `public/`: render with next/image so they're resized and served as AVIF/WebP.
   * User photos (blob:, data: and API URLs) keep a plain <img>.
   */
  optimize?: { sizes: string; preload?: boolean };
};

function SliderImage({ src, alt, optimize, style }: { src: string; alt: string; optimize?: Props["optimize"]; style?: React.CSSProperties }) {
  if (optimize) {
    return <Image src={src} alt={alt} fill sizes={optimize.sizes} preload={optimize.preload} className="object-cover" style={style} draggable={false} />;
  }
  return <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" style={style} draggable={false} />;
}

/**
 * Before/after comparison. A native range input holds the split, so it works with arrow keys, Home/End and screen
 * readers. Mouse, pen and touch drag anywhere on the image via pointer events: the split follows the pointer with
 * no easing, the stage captures the pointer so the drag survives leaving it, and a second finger is ignored so the
 * split never jumps. `touch-action: pan-y` keeps vertical page scrolling on phones.
 */
export function CompareSlider({ before, after, beforeAlt, afterAlt, className, children, initial = 50, beforeLabel = "Before", afterLabel = "After", optimize }: Props) {
  const [pos, setPos] = useState(initial);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const dragging = useRef<number | null>(null);

  const follow = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width) setPos(Math.round(Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100))));
  };
  const drag = after
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
          if (dragging.current !== null || !e.isPrimary || e.button !== 0) return;
          // Controls laid over the image (retry, progress actions) keep their own clicks.
          if (e.target !== input.current && (e.target as Element).closest("button, a, [role=button], textarea, select")) return;
          dragging.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          input.current?.focus({ preventScroll: true });
          follow(e);
        },
        onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
          if (e.pointerId === dragging.current) follow(e);
        },
        onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
          if (e.pointerId === dragging.current) dragging.current = null;
        },
        onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => {
          if (e.pointerId === dragging.current) dragging.current = null;
        },
      }
    : {};

  return (
    <div
      {...drag}
      className={cn("group/compare relative isolate overflow-hidden bg-muted select-none", after && "cursor-ew-resize touch-pan-y", className)}
    >
      <SliderImage src={before} alt={beforeAlt} optimize={optimize} />
      {after && (
        <>
          <SliderImage src={after} alt={afterAlt} optimize={optimize} style={{ clipPath: `inset(0 0 0 ${pos}%)` }} />
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
            ref={input}
            id={id}
            type="range"
            min={0}
            max={100}
            step={1}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-valuetext={`${pos}% ${beforeLabel === "Before" ? "original photo" : beforeLabel}`}
            className="pointer-events-none absolute inset-0 z-20 size-full opacity-0"
          />
        </>
      )}
      {children}
    </div>
  );
}
