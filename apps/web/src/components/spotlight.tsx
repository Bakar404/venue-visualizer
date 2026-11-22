"use client";

import { motion } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

/** A soft, angled beam of light that fades in once on load. */
export function Spotlight({ className }: { className?: string }) {
  return (
    <motion.svg
      aria-hidden
      initial={{ opacity: 0, x: -40, y: -30 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
      className={cn("pointer-events-none absolute -top-40 -left-24 h-[150%] w-[140%] lg:w-[90%]", className)}
      viewBox="0 0 3787 2842"
      fill="none"
    >
      <g filter="url(#vv-spotlight-blur)">
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          className="fill-[oklch(0.9_0.06_85)] dark:fill-[oklch(0.85_0.05_85)]"
          fillOpacity="0.32"
        />
      </g>
      <defs>
        <filter id="vv-spotlight-blur" x="0.86" y="0.84" width="3785.16" height="2840.26" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="151" result="effect1_foregroundBlur" />
        </filter>
      </defs>
    </motion.svg>
  );
}

/** Card with a pointer-following glow. Pointer position is written to CSS vars, not React state. */
export function SpotlightCard({ className, children, ...props }: React.ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
        el.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
      }}
      className={cn(
        "group/spot relative overflow-hidden rounded-2xl border bg-card text-card-foreground",
        "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-200",
        "before:bg-[radial-gradient(420px_circle_at_var(--spot-x,50%)_var(--spot-y,50%),var(--brand-soft),transparent_65%)]",
        "hover:before:opacity-100",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
