"use client";

import { ImageIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState, type PointerEvent } from "react";

import { CompareSlider } from "@/components/compare-slider";
import { Swatches } from "@/components/looks/looks-gallery";
import { QueryError } from "@/components/query-error";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLook, useSpace } from "@/lib/queries";
import { diffSpecs, formatDate, latestRenderFor } from "@/lib/spec";
import type { Look, Photo } from "@/lib/types";
import { type Zoom, zoomAt, zoomForKey } from "@/lib/zoom";
import { cn } from "@/lib/utils";

type Mode = "side" | "slider";

export function CompareLooks() {
  const params = useSearchParams();
  const aId = params.get("a");
  const bId = params.get("b");
  const a = useLook(aId);
  const b = useLook(bId);
  const space = useSpace(a.data?.space_id ?? b.data?.space_id);

  if (!aId || !bId) {
    return (
      <Shell>
        <h1 className="font-display text-5xl">Compare Looks</h1>
        <p className="mt-3 text-muted-foreground">Pick two Looks from a room&apos;s gallery to compare them.</p>
        <Link href="/venues" className={cn(buttonVariants(), "mt-6")}>
          Go to your venues
        </Link>
      </Shell>
    );
  }
  if (a.error || b.error || space.error) {
    return (
      <Shell>
        <QueryError error={a.error ?? b.error ?? space.error} onRetry={() => void Promise.all([a.refetch(), b.refetch()])} what="Look" />
      </Shell>
    );
  }
  if (!a.data || !b.data || !space.data) {
    return (
      <Shell>
        <Skeleton className="h-14 w-80" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Skeleton className="aspect-[3/2]" />
          <Skeleton className="aspect-[3/2]" />
        </div>
      </Shell>
    );
  }
  const photos = space.data.photos.filter((p) => p.kind === "upload" || p.approved);
  return <Comparison a={a.data} b={b.data} photos={photos} spaceId={space.data.id} spaceName={space.data.name} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6">{children}</div>;
}

function Comparison({ a, b, photos, spaceId, spaceName }: { a: Look; b: Look; photos: Photo[]; spaceId: string; spaceName: string }) {
  const [mode, setMode] = useState<Mode>("side");
  const [onlyChanges, setOnlyChanges] = useState(true);
  const rows = diffSpecs(a.spec, b.spec);
  const changed = rows.filter((r) => r.changed).length;
  const visible = onlyChanges ? rows.filter((r) => r.changed) : rows;

  return (
    <Shell>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href={`/spaces/${spaceId}/looks`} className="rounded-sm hover:text-foreground pointer-coarse:-my-3 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
          {spaceName} Looks
        </Link>
      </nav>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl leading-tight text-balance sm:text-5xl">
          {a.name} <span className="text-muted-foreground">and</span> {b.name}
        </h1>
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList aria-label="Comparison view">
            <TabsTrigger value="side">Side by side</TabsTrigger>
            <TabsTrigger value="slider">Slider</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          {photos.length === 0 && <p className="text-muted-foreground">This room has no photos to compare.</p>}
          {photos.map((photo, i) => (
            <PhotoComparison key={photo.id} index={i} photo={photo} a={a} b={b} mode={mode} />
          ))}
        </div>

        <section aria-labelledby="diff-title" className="xl:sticky xl:top-20 xl:self-start">
          <div className="flex items-center justify-between gap-3">
            <h2 id="diff-title" className="font-display text-2xl">
              What changed
            </h2>
            <div className="flex items-center gap-2">
              <Switch id="only-changes" checked={onlyChanges} onCheckedChange={setOnlyChanges} />
              <Label htmlFor="only-changes" className="text-sm font-normal text-muted-foreground">
                Only differences
              </Label>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {changed === 0 ? "The two plans are identical." : changed === 1 ? "1 field differs." : `${changed} fields differ.`}
          </p>
          <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Plan differences between {a.name} and {b.name}</caption>
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th scope="col" className="w-1/3 px-3 py-2 font-medium">Field</th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      {a.name}
                    </span>
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">{b.name}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">Saved</th>
                  <td className="px-3 py-2">{formatDate(a.created_at)}</td>
                  <td className="px-3 py-2">{formatDate(b.created_at)}</td>
                </tr>
                <tr className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">Swatches</th>
                  <td className="px-3 py-2">
                    <Swatches palette={a.spec.palette} />
                  </td>
                  <td className="px-3 py-2">
                    <Swatches palette={b.spec.palette} />
                  </td>
                </tr>
                {visible.map((row) => (
                  <tr key={row.path} className={cn("border-t align-top", row.changed && "bg-brand-soft/60")}>
                    <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">
                      {row.label}
                      {row.changed && <span className="sr-only"> (changed)</span>}
                    </th>
                    <td className="px-3 py-2 break-words">{row.a}</td>
                    <td className={cn("px-3 py-2 break-words", row.changed && "font-medium")}>{row.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function PhotoComparison({ index, photo, a, b, mode }: { index: number; photo: Photo; a: Look; b: Look; mode: Mode }) {
  const [focus, setFocus] = useState<Zoom>(null);
  const ra = latestRenderFor(a.renders, photo.id);
  const rb = latestRenderFor(b.renders, photo.id);
  const urlA = ra?.status === "done" ? ra.url : null;
  const urlB = rb?.status === "done" ? rb.url : null;
  const label = `Photo ${index + 1}`;

  return (
    <figure>
      <figcaption className="mb-3 text-sm text-muted-foreground">{label}</figcaption>
      {mode === "slider" ? (
        <div className="overflow-hidden rounded-xl bg-muted ring-1 ring-border">
          <CompareSlider
            before={urlA ?? photo.url}
            after={urlB}
            beforeAlt={`${label} with ${a.name}`}
            afterAlt={`${label} with ${b.name}`}
            beforeLabel={a.name}
            afterLabel={b.name}
            className="aspect-[3/2] w-full"
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <SyncedImage url={urlA} fallback={photo.url} alt={`${label} with ${a.name}`} name={a.name} focus={focus} onFocus={setFocus} />
          <SyncedImage url={urlB} fallback={photo.url} alt={`${label} with ${b.name}`} name={b.name} focus={focus} onFocus={setFocus} />
        </div>
      )}
    </figure>
  );
}

/**
 * Hovering (mouse), tapping/dragging (touch, pen) or the keyboard (+/-, arrows, 0/Esc) zooms both
 * images to the same point, so details line up across Looks.
 */
function SyncedImage({
  url,
  fallback,
  alt,
  name,
  focus,
  onFocus,
}: {
  url: string | null;
  fallback: string;
  alt: string;
  name: string;
  focus: Zoom;
  onFocus: (f: Zoom) => void;
}) {
  const press = useRef<{ x: number; y: number; moved: boolean; wasZoomed: boolean } | null>(null);
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`${alt}. Zoom with plus and minus, move with the arrow keys, reset with 0.`}
      className="relative aspect-[3/2] cursor-zoom-in overflow-hidden rounded-xl bg-muted ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={focus ? { touchAction: "none" } : undefined}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const next = zoomForKey(focus, e.key);
        if (next === undefined) return;
        e.preventDefault();
        onFocus(next);
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        const p = point(e);
        press.current = { ...p, moved: false, wasZoomed: focus !== null };
        e.currentTarget.setPointerCapture(e.pointerId);
        if (!focus) onFocus(zoomAt(p.x, p.y));
      }}
      onPointerMove={(e) => {
        const p = point(e);
        if (e.pointerType === "mouse") {
          onFocus(zoomAt(p.x, p.y, focus?.scale));
          return;
        }
        const start = press.current;
        if (!start) return;
        if (Math.hypot(p.x - start.x, p.y - start.y) > 2) start.moved = true;
        onFocus(zoomAt(p.x, p.y, focus?.scale));
      }}
      onPointerUp={() => {
        const start = press.current;
        press.current = null;
        // A tap on an already-zoomed image zooms back out; a drag just pans.
        if (start && start.wasZoomed && !start.moved) onFocus(null);
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onFocus(null);
      }}
    >
      <img
        src={url ?? fallback}
        alt={url ? alt : `${alt} (not rendered yet, showing the original)`}
        className={cn("size-full object-cover transition-transform duration-200 ease-out motion-reduce:transition-none", !url && "opacity-50 grayscale")}
        style={focus ? { transform: `scale(${focus.scale})`, transformOrigin: `${focus.x}% ${focus.y}%` } : undefined}
        draggable={false}
      />
      <span className="absolute top-3 left-3 rounded-full bg-background/85 px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur">{name}</span>
      {!url && (
        <span className="absolute inset-x-0 bottom-3 mx-auto flex w-fit items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur">
          <ImageIcon className="size-3.5" />
          Not rendered yet
        </span>
      )}
    </div>
  );
}
