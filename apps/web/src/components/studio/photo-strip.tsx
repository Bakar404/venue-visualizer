"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { CameraCapture } from "@/components/camera-capture";
import { PhotoCredit } from "@/components/photo-credit";
import { BaseCandidate } from "@/components/studio/base-candidate";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import { latestRenderFor } from "@/lib/spec";
import type { Look, Photo } from "@/lib/types";
import { cn } from "@/lib/utils";

export const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PHOTOS = 30;

function accepted(file: File) {
  return ACCEPT.includes(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

export function useUploadPhotos(spaceId: string, onUploaded?: (photos: Photo[]) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => api.uploadPhotos(spaceId, files),
    onSuccess: (photos) => {
      void qc.invalidateQueries({ queryKey: qk.space(spaceId) });
      void qc.invalidateQueries({ queryKey: qk.venues });
      toast.success(photos.length === 1 ? "Photo added" : `${photos.length} photos added`);
      onUploaded?.(photos);
    },
    onError: (e) => toast.error("Couldn't upload", { description: errorMessage(e) }),
  });
}

export function filterFiles(list: FileList | File[], existing: number): File[] {
  const files = [...list];
  const wrongType = files.filter((f) => !accepted(f));
  const tooBig = files.filter((f) => accepted(f) && f.size > MAX_BYTES);
  let ok = files.filter((f) => accepted(f) && f.size <= MAX_BYTES);
  if (wrongType.length) toast.error(`Skipped ${wrongType.length} file${wrongType.length > 1 ? "s" : ""}`, { description: "Use JPG, PNG, WebP or HEIC photos." });
  if (tooBig.length) toast.error(`Skipped ${tooBig.length} large file${tooBig.length > 1 ? "s" : ""}`, { description: "Each photo can be up to 20 MB." });
  const room = MAX_PHOTOS - existing;
  if (ok.length > room) {
    toast.error(`A room holds up to ${MAX_PHOTOS} photos`, { description: `Added the first ${Math.max(room, 0)}.` });
    ok = ok.slice(0, Math.max(room, 0));
  }
  return ok;
}

/** Drop target plus a visually hidden file input; works with click, keyboard and drag and drop. */
export function PhotoDropzone({ spaceId, existing, onUploaded, large }: { spaceId: string; existing: number; onUploaded?: (photos: Photo[]) => void; large?: boolean }) {
  const id = useId();
  const [over, setOver] = useState(false);
  const upload = useUploadPhotos(spaceId, onUploaded);

  const handle = (list: FileList | File[] | null) => {
    if (!list) return;
    const files = filterFiles(list, existing);
    if (files.length) upload.mutate(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-center transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40",
        large ? "px-6 py-10" : "px-3 py-5",
        over ? "border-brand bg-brand-soft" : "hover:border-foreground/30",
        upload.isPending && "pointer-events-none opacity-70",
      )}
    >
      <ImagePlusIcon className="size-5 text-muted-foreground" aria-hidden />
      <label htmlFor={id} className="cursor-pointer text-sm font-medium after:absolute after:inset-0">
        {upload.isPending ? "Uploading…" : large ? "Add photos of the empty room" : "Add photos"}
      </label>
      <p className="text-sm text-muted-foreground pointer-coarse:hidden">Drop here or browse. JPG, PNG, WebP or HEIC.</p>
      <CameraCapture kind="photos" onFiles={handle} disabled={upload.isPending} className="relative z-10 mt-1.5" />
      <input
        id={id}
        type="file"
        multiple
        accept={ACCEPT.join(",") + ",.heic,.heif"}
        className="sr-only"
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
      />
      <span aria-live="polite" className="sr-only">
        {upload.isPending ? "Uploading photos" : ""}
      </span>
    </div>
  );
}

function DeletePhoto({ photo, spaceId, label }: { photo: Photo; spaceId: string; label: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deletePhoto(photo.id),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: qk.space(spaceId) });
      void qc.invalidateQueries({ queryKey: qk.looks(spaceId) });
      void qc.invalidateQueries({ queryKey: ["look"] });
      toast.success("Photo deleted");
    },
    onError: (e) => toast.error("Couldn't delete the photo", { description: errorMessage(e) }),
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="secondary"
            size="icon-xs"
            aria-label={`Delete ${label}`}
            className="absolute top-1.5 right-1.5 z-10 opacity-0 shadow-sm group-focus-within/photo:opacity-100 group-hover/photo:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
          />
        }
      >
        <Trash2Icon />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64">
        <PopoverTitle>Delete this photo?</PopoverTitle>
        <PopoverDescription>Its renders in every Look are deleted too.</PopoverDescription>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Keep
          </Button>
          <Button variant="destructive" size="sm" onClick={() => del.mutate()} disabled={del.isPending}>
            Delete photo
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const STATUS_LABEL = { queued: "Queued", running: "Rendering", done: "Rendered", failed: "Render failed", cancelled: "Cancelled" } as const;

export function PhotoStrip({
  spaceId,
  photos,
  selectedId,
  onSelect,
  look,
  candidate,
}: {
  spaceId: string;
  photos: Photo[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  look: Look | undefined;
  /** A generated base view still waiting for review (e.g. it finished after another photo became the base). */
  candidate?: Photo;
}) {
  return (
    <div className="flex flex-col gap-3">
      {candidate && (
        <section aria-label="Generated view to review">
          <BaseCandidate key={candidate.id} photo={candidate} spaceId={spaceId} onApproved={(p) => onSelect(p.id)} compact />
        </section>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1" aria-label="Photos">
        {photos.map((photo, i) => {
          const render = latestRenderFor(look?.renders, photo.id);
          const label =
            photo.kind === "generated_base" ? `Generated view ${i + 1}` : photo.kind === "video_frame" ? `Video frame ${i + 1}` : `Photo ${i + 1}`;
          const selected = photo.id === selectedId;
          const shown = render?.status === "done" && render.url ? render.url : photo.url;
          return (
            <li key={photo.id} className="group/photo relative">
              <button
                type="button"
                onClick={() => onSelect(photo.id)}
                aria-pressed={selected}
                className={cn(
                  "block w-full overflow-hidden rounded-lg ring-offset-2 ring-offset-background transition-shadow",
                  selected ? "ring-2 ring-foreground" : "ring-1 ring-border hover:ring-foreground/30",
                )}
              >
                <span className="relative block">
                  <img src={shown} alt={label} className="aspect-[3/2] w-full bg-muted object-cover" loading="lazy" />
                  <PhotoCredit photo={photo} asLink={false} className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)]" />
                </span>
                <span className="flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs">
                  <span className="truncate">{label}</span>
                  {render && (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1",
                        render.status === "failed" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 rounded-full",
                          render.status === "done" && "bg-brand",
                          (render.status === "queued" || render.status === "running") && "animate-pulse bg-amber-500",
                          render.status === "failed" && "bg-destructive",
                          render.status === "cancelled" && "bg-muted-foreground",
                        )}
                      />
                      {STATUS_LABEL[render.status]}
                    </span>
                  )}
                </span>
              </button>
              <DeletePhoto photo={photo} spaceId={spaceId} label={label} />
            </li>
          );
        })}
      </ul>
      <PhotoDropzone spaceId={spaceId} existing={photos.length} onUploaded={(p) => p[0] && onSelect(p[0].id)} />
    </div>
  );
}
