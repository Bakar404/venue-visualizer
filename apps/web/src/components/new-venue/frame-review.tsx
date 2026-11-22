"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVerticalIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { formatElapsed } from "@/components/new-venue/job-progress";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { SuggestedSpace, VenueSpec, VideoFrame } from "@/lib/types";
import { cn } from "@/lib/utils";

type Column = { key: string; name: string; spec?: VenueSpec; ids: string[] };

const SELECT =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function initialColumns(frames: VideoFrame[], suggested: SuggestedSpace[]): Column[] {
  const cols: Column[] = suggested.map((s, i) => ({ key: `c${i}`, name: s.name, spec: s.venue_spec, ids: s.photo_ids.filter((id) => frames.some((f) => f.photo_id === id)) }));
  const placed = new Set(cols.flatMap((c) => c.ids));
  for (const f of frames) {
    if (placed.has(f.photo_id)) continue;
    let col = cols.find((c) => c.name.toLowerCase() === f.space_guess.toLowerCase());
    if (!col) {
      col = { key: `c${cols.length}`, name: f.space_guess || "Unsorted", ids: [] };
      cols.push(col);
    }
    col.ids.push(f.photo_id);
  }
  return cols;
}

/** Frames grouped by suggested space. Drag between columns (or use "Move to"), rename or merge spaces, untick frames to skip. */
export function FrameReview({
  venueId,
  jobId,
  frames,
  suggested,
  durationS,
}: {
  venueId: string;
  jobId: string;
  frames: VideoFrame[];
  suggested: SuggestedSpace[];
  durationS: number | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const byId = new Map(frames.map((f) => [f.photo_id, f]));
  const [columns, setColumns] = useState<Column[]>(() => initialColumns(frames, suggested));
  const [kept, setKept] = useState<Record<string, boolean>>(() => Object.fromEntries(frames.map((f) => [f.photo_id, f.usable])));
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [nextKey, setNextKey] = useState(columns.length);

  const move = (id: string, to: string) => {
    const dest = columns.find((c) => c.key === to);
    if (!dest || dest.ids.includes(id)) return;
    setColumns((cols) => cols.map((c) => (c.key === to ? { ...c, ids: [...c.ids, id] } : { ...c, ids: c.ids.filter((x) => x !== id) })));
    setAnnounce(`Frame moved to ${dest.name || "the untitled space"}.`);
  };
  const merge = (from: string, into: string) => {
    const src = columns.find((c) => c.key === from);
    const dest = columns.find((c) => c.key === into);
    if (!src || !dest) return;
    setColumns((cols) => cols.filter((c) => c.key !== from).map((c) => (c.key === into ? { ...c, ids: [...c.ids, ...src.ids] } : c)));
    setAnnounce(`${src.name || "Space"} merged into ${dest.name || "the untitled space"}.`);
  };
  const addColumn = () => {
    setColumns((cols) => [...cols, { key: `c${nextKey}`, name: `Space ${cols.length + 1}`, ids: [] }]);
    setNextKey((n) => n + 1);
  };

  const keptCount = frames.filter((f) => kept[f.photo_id]).length;
  const unnamed = columns.some((c) => c.ids.some((id) => kept[id]) && !c.name.trim());

  const apply = useMutation({
    mutationFn: () =>
      api.applyVideo(venueId, {
        job_id: jobId,
        spaces: columns
          .map((c) => ({ name: c.name.trim(), photo_ids: c.ids.filter((id) => kept[id]), venue_spec: c.spec }))
          .filter((s) => s.photo_ids.length > 0),
      }),
    onSuccess: (venue) => {
      void qc.invalidateQueries({ queryKey: qk.venues });
      qc.setQueryData(qk.venue(venue.id), venue);
      toast.success("Frames added", { description: `${keptCount} photo${keptCount === 1 ? "" : "s"} in ${venue.name}` });
      router.push(`/venues/${venue.id}`);
    },
    onError: (e) => toast.error("Couldn't add the frames", { description: errorMessage(e) }),
  });

  return (
    <section aria-labelledby="frames-heading" className="grid gap-6">
      <div>
        <h2 id="frames-heading" className="font-display text-4xl">
          Choose your base photos
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
          {frames.length} frames{durationS ? ` from a ${formatElapsed(durationS * 1000)} video` : ""}, grouped by the space they seem to show. Drag frames
          between spaces or use &ldquo;Move to&rdquo;, rename or merge spaces, and untick anything you don&apos;t want.
        </p>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <div className="grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]">
        {columns.map((col) => {
          const keptHere = col.ids.filter((id) => kept[id]).length;
          const others = columns.filter((c) => c.key !== col.key);
          return (
            <div
              key={col.key}
              role="group"
              aria-labelledby={`${col.key}-label`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (target !== col.key) setTarget(col.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragging;
                if (id) move(id, col.key);
                setDragging(null);
                setTarget(null);
              }}
              className={cn(
                "flex min-w-0 flex-col gap-3 rounded-2xl border bg-muted/30 p-3 transition-colors duration-150",
                target === col.key && "border-brand bg-brand-soft",
              )}
            >
              <div className="grid gap-2">
                <Label htmlFor={`${col.key}-name`} id={`${col.key}-label`} className="sr-only">
                  Space name: {col.name}
                </Label>
                <Input
                  id={`${col.key}-name`}
                  value={col.name}
                  onChange={(e) => setColumns((cols) => cols.map((c) => (c.key === col.key ? { ...c, name: e.target.value } : c)))}
                  aria-invalid={!col.name.trim() && keptHere > 0}
                  className="h-9 bg-background font-medium"
                  autoComplete="off"
                />
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="tabular">
                    {keptHere} of {col.ids.length} kept
                  </span>
                  {others.length > 0 && (
                    <>
                      <label htmlFor={`${col.key}-merge`} className="sr-only">
                        Merge {col.name || "this space"} into another space
                      </label>
                      <select
                        id={`${col.key}-merge`}
                        className={cn(SELECT, "h-7 text-xs")}
                        value=""
                        onChange={(e) => e.target.value && merge(col.key, e.target.value)}
                      >
                        <option value="">Merge into…</option>
                        {others.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.name || "Untitled space"}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              </div>

              {col.ids.length === 0 ? (
                <p className="grid min-h-28 place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">Drop frames here</p>
              ) : (
                <ul className="grid gap-3">
                  {col.ids.map((id) => {
                    const f = byId.get(id);
                    if (!f) return null;
                    return (
                      <FrameCard
                        key={id}
                        frame={f}
                        kept={Boolean(kept[id])}
                        onKeep={(v) => setKept((k) => ({ ...k, [id]: v }))}
                        columns={columns}
                        current={col.key}
                        onMove={(to) => move(id, to)}
                        dragging={dragging === id}
                        onDragStart={() => setDragging(id)}
                        onDragEnd={() => {
                          setDragging(null);
                          setTarget(null);
                        }}
                      />
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button type="button" variant="outline" onClick={addColumn}>
          <PlusIcon aria-hidden /> New space
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={apply.isPending || keptCount === 0 || unnamed}
          onClick={() => apply.mutate()}
          className="sm:ml-auto"
        >
          {apply.isPending ? "Adding…" : `Add ${keptCount} photo${keptCount === 1 ? "" : "s"}`}
        </Button>
        {(keptCount === 0 || unnamed) && (
          <p className="w-full text-sm text-muted-foreground sm:text-right" role="status">
            {keptCount === 0 ? "Keep at least one frame." : "Name every space that has frames."}
          </p>
        )}
      </div>
    </section>
  );
}

const VIEW_LABEL: Record<VideoFrame["view"], string> = { wide: "Wide", corner: "Corner", detail: "Detail" };

function FrameCard({
  frame,
  kept,
  onKeep,
  columns,
  current,
  onMove,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  frame: VideoFrame;
  kept: boolean;
  onKeep: (v: boolean) => void;
  columns: Column[];
  current: string;
  onMove: (to: string) => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const id = `frame-${frame.photo_id}`;
  const sharp = Math.round(frame.sharpness * 100);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", frame.photo_id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "overflow-hidden rounded-xl border bg-card transition-[opacity,transform] duration-150 ease-out",
        dragging && "scale-[0.98] opacity-50",
        !kept && "opacity-60",
      )}
    >
      <div className="relative cursor-grab active:cursor-grabbing">
        <img src={frame.url} alt={frame.description} className="aspect-[3/2] w-full bg-muted object-cover" loading="lazy" draggable={false} />
        <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">
            {VIEW_LABEL[frame.view]}
            {typeof frame.t === "number" ? <span className="tabular"> · {formatElapsed(frame.t * 1000)}</span> : null}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] backdrop-blur-sm",
              frame.usable ? "bg-brand text-brand-foreground" : "bg-black/55 text-white",
            )}
          >
            {frame.usable ? "Usable" : "Not ideal"}
          </span>
        </div>
        <GripVerticalIcon aria-hidden className="absolute right-2 bottom-2 size-4 text-white drop-shadow" />
      </div>
      <div className="grid gap-2 p-3">
        <p className="text-sm text-pretty">{frame.description}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Sharpness</span>
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-label="Sharpness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sharp}
          >
            <div
              className={cn("h-full rounded-full", sharp >= 60 ? "bg-brand" : sharp >= 35 ? "bg-amber-500" : "bg-destructive")}
              style={{ width: `${sharp}%` }}
            />
          </div>
          <span className="w-8 text-right tabular">{sharp}%</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-keep`} checked={kept} onCheckedChange={onKeep} />
            <Label htmlFor={`${id}-keep`} className="text-sm font-normal">
              Keep
            </Label>
          </div>
          {columns.length > 1 && (
            <>
              <label htmlFor={`${id}-move`} className="sr-only">
                Move this frame to another space
              </label>
              <select id={`${id}-move`} className={SELECT} value="" onChange={(e) => e.target.value && onMove(e.target.value)}>
                <option value="">Move to…</option>
                {columns
                  .filter((c) => c.key !== current)
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name || "Untitled space"}
                    </option>
                  ))}
              </select>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
