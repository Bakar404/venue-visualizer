"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64);

const CELL = 3; // CSS pixels per dither cell
const FPS = 24;

function readInk(el: HTMLElement): [number, number, number] {
  // Resolve any CSS colour (including oklch) to sRGB by painting it on a 1x1 canvas.
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d")!;
  ctx.fillStyle = getComputedStyle(el).getPropertyValue("--foreground").trim() || "#333";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/**
 * Ordered (Bayer 8x8) dithering of a slow, low-contrast gradient field. Draws at 1/3 resolution
 * and upscales with pixelated sampling. Pauses when hidden or off-screen; one static frame
 * under prefers-reduced-motion.
 */
export function DitherBackground({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let ink = readInk(document.documentElement);
    let w = 0;
    let h = 0;
    let image: ImageData | null = null;
    let raf = 0;
    let last = 0;
    let visible = true;
    const start = performance.now() - 40_000;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.ceil(rect.width / CELL));
      h = Math.max(1, Math.ceil(rect.height / CELL));
      canvas.width = w;
      canvas.height = h;
      image = ctx.createImageData(w, h);
    };

    const draw = (now: number) => {
      if (!image) return;
      const t = (now - start) / 1000;
      const data = image.data;
      const [r, g, b] = ink;
      const sx = 1 / w;
      const sy = 1 / h;
      for (let y = 0; y < h; y++) {
        const ny = y * sy;
        for (let x = 0; x < w; x++) {
          const nx = x * sx;
          // Layered sines make a soft, drifting field; cheap enough for full frames at 24 fps.
          const v =
            0.5 +
            0.22 * Math.sin(nx * 5.1 + t * 0.11 + Math.sin(ny * 3.7 - t * 0.07) * 1.6) +
            0.16 * Math.sin(ny * 6.3 - t * 0.09 + Math.cos(nx * 4.2 + t * 0.05) * 1.3) +
            0.1 * Math.sin((nx + ny) * 9.0 + t * 0.15);
          // Brighter towards the upper right so the headline sits on quiet paper.
          const falloff = 0.35 + 0.65 * Math.min(1, nx * 0.9 + (1 - ny) * 0.5);
          const on = v * falloff > BAYER_8[(y & 7) * 8 + (x & 7)];
          const i = (y * w + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = on ? 255 : 0;
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS) return;
      last = now;
      draw(now);
    };

    const startLoop = () => {
      cancelAnimationFrame(raf);
      if (reduced.matches) {
        draw(start + 40_000);
        return;
      }
      if (visible && document.visibilityState === "visible") raf = requestAnimationFrame(loop);
    };

    resize();
    startLoop();

    const ro = new ResizeObserver(() => {
      resize();
      if (reduced.matches) draw(start + 40_000);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      startLoop();
    });
    io.observe(canvas);
    const mo = new MutationObserver(() => {
      ink = readInk(document.documentElement);
      draw(performance.now());
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    document.addEventListener("visibilitychange", startLoop);
    reduced.addEventListener("change", startLoop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", startLoop);
      reduced.removeEventListener("change", startLoop);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={cn(
        "pixelated pointer-events-none absolute inset-0 size-full opacity-[0.07] dark:opacity-[0.1]",
        "[mask-image:radial-gradient(ellipse_80%_70%_at_70%_30%,black,transparent)]",
        className,
      )}
    />
  );
}
