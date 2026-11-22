"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Photo } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A generated base view waiting for review: approve it as a base photo or discard it. */
export function BaseCandidate({
  photo,
  spaceId,
  onApproved,
  compact = false,
}: {
  photo: Photo;
  spaceId: string;
  onApproved: (photo: Photo) => void;
  /** The narrow photo-strip layout. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.space(spaceId) });
    void qc.invalidateQueries({ queryKey: qk.venues });
  };

  const approve = useMutation({
    mutationFn: () => api.approvePhoto(photo.id),
    onSuccess: (approved) => {
      refresh();
      toast.success("Base view approved", { description: "You can now design on it like a photo." });
      onApproved(approved);
    },
    onError: (e) => toast.error("Couldn't approve the view", { description: errorMessage(e) }),
  });

  const discard = useMutation({
    mutationFn: () => api.deletePhoto(photo.id),
    onSuccess: refresh,
    onError: (e) => toast.error("Couldn't discard the view", { description: errorMessage(e) }),
  });

  const pending = approve.isPending || discard.isPending;

  return (
    <figure
      className={cn(
        "grid gap-3 rounded-xl border bg-card",
        compact ? "p-2" : "p-4 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-end",
      )}
    >
      <img src={photo.url} alt="Generated empty base view" className="aspect-[3/2] w-full rounded-lg bg-muted object-cover" />
      <div className={cn("grid", compact ? "gap-2" : "gap-3")}>
        <figcaption className={cn("text-pretty text-muted-foreground", compact ? "text-xs" : "text-sm")}>
          Does this match the room? Use it as your base view, or try again.
        </figcaption>
        <Button size={compact ? "sm" : "default"} onClick={() => approve.mutate()} disabled={pending}>
          <CheckIcon />
          Use this view
        </Button>
        <Button size={compact ? "sm" : "default"} variant="outline" onClick={() => discard.mutate()} disabled={pending}>
          <RotateCcwIcon />
          {discard.isPending ? "Discarding…" : "Discard"}
        </Button>
      </div>
    </figure>
  );
}
