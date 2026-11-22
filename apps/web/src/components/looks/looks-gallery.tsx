"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, DownloadIcon, GitBranchIcon, ImageIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { toast } from "sonner";

import { QueryError } from "@/components/query-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/api";
import { qk, useLooks, useSpace } from "@/lib/queries";
import { colorFor, firstDoneRender, formatDate } from "@/lib/spec";
import type { Look } from "@/lib/types";
import { cn } from "@/lib/utils";

async function exportLook(look: Look) {
  try {
    window.open(await api.exportUrl(look.id), "_blank", "noopener");
  } catch (e) {
    toast.error("Couldn't export the PDF", { description: errorMessage(e) });
  }
}

export function Swatches({ palette, className }: { palette: string[]; className?: string }) {
  if (!palette.length) return null;
  return (
    <ul className={cn("flex items-center -space-x-1", className)} aria-label={`Palette: ${palette.join(", ")}`}>
      {palette.slice(0, 6).map((c) => (
        <li key={c} title={c} className="size-5 rounded-full ring-2 ring-card" style={{ backgroundColor: colorFor(c) }} />
      ))}
    </ul>
  );
}

export function LooksGallery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const space = useSpace(id);
  const looks = useLooks(id);
  const [selected, setSelected] = useState<string[]>([]);

  const remove = useMutation({
    mutationFn: (lookId: string) => api.deleteLook(lookId),
    onSuccess: (_, lookId) => {
      setSelected((s) => s.filter((x) => x !== lookId));
      void qc.invalidateQueries({ queryKey: qk.looks(id) });
      toast.success("Look deleted");
    },
    onError: (e) => toast.error("Couldn't delete the Look", { description: errorMessage(e) }),
  });

  const toggle = (lookId: string) =>
    setSelected((s) => (s.includes(lookId) ? s.filter((x) => x !== lookId) : [...s.slice(-1), lookId]));

  if (looks.error || space.error) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6">
        <QueryError error={looks.error ?? space.error} onRetry={() => void Promise.all([looks.refetch(), space.refetch()])} what="Looks" />
      </div>
    );
  }

  const sorted = [...(looks.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byId = new Map(sorted.map((l) => [l.id, l]));
  const photoUrl = (look: Look) => firstDoneRender(look.renders)?.url ?? space.data?.photos[0]?.url;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-10 pb-28 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
            <Link href={`/spaces/${id}`} className="rounded-sm hover:text-foreground">
              {space.data?.name ?? "Studio"}
            </Link>
          </nav>
          <h1 className="font-display text-5xl leading-none sm:text-6xl">Looks</h1>
          <p className="mt-3 max-w-prose text-muted-foreground">Every saved plan for this room. Select two to compare them photo by photo.</p>
        </div>
        <Link href={`/spaces/${id}`} className={buttonVariants({ variant: "outline" })}>
          Back to the studio
        </Link>
      </div>

      {looks.isPending ? (
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed p-10 text-center">
          <p className="font-display text-3xl">No Looks yet</p>
          <p className="mt-2 text-muted-foreground">Describe the decor in the studio, then save it or render all photos.</p>
          <Link href={`/spaces/${id}`} className={cn(buttonVariants(), "mt-5")}>
            Open the studio
          </Link>
        </div>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((look) => {
            const isSelected = selected.includes(look.id);
            const url = photoUrl(look);
            const rendered = look.renders.filter((r) => r.status === "done").length;
            const parent = look.parent_look_id ? byId.get(look.parent_look_id) : undefined;
            return (
              <li key={look.id}>
                <article
                  className={cn(
                    "group relative overflow-hidden rounded-xl bg-card ring-1 ring-border transition-shadow duration-200",
                    isSelected && "ring-2 ring-brand",
                  )}
                >
                  <div className="relative aspect-[3/2] bg-muted">
                    {url ? (
                      <img src={url} alt={`${look.name}, first render`} className={cn("size-full object-cover", !firstDoneRender(look.renders) && "opacity-60 grayscale")} />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="size-6" />
                      </div>
                    )}
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggle(look.id)}
                      className={cn(
                        "absolute top-3 right-3 z-10 flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium shadow-sm ring-1 backdrop-blur transition-colors",
                        isSelected ? "bg-brand text-brand-foreground ring-brand" : "bg-background/85 ring-border hover:bg-background",
                      )}
                    >
                      {isSelected && <CheckIcon className="size-4" />}
                      {isSelected ? "Selected" : "Select"}
                    </button>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-display truncate text-2xl leading-tight">
                          <Link href={`/spaces/${id}?look=${look.id}&open=1`} className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
                            {look.name}
                          </Link>
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(look.created_at)}, {rendered === 1 ? "1 render" : `${rendered} renders`}
                        </p>
                      </div>
                      <Swatches palette={look.spec.palette} className="mt-1 shrink-0" />
                    </div>
                    {parent && (
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <GitBranchIcon className="size-3.5" />
                        Variation of {parent.name}
                      </p>
                    )}
                    <div className="relative z-10 flex gap-2">
                      <Tooltip>
                        <TooltipTrigger render={<Button variant="outline" size="sm" onClick={() => void exportLook(look)} />}>
                          <DownloadIcon />
                          Export PDF
                        </TooltipTrigger>
                        <TooltipContent>Includes credits for any photos from the web</TooltipContent>
                      </Tooltip>
                      <Popover>
                        <PopoverTrigger render={<Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" aria-label={`Delete ${look.name}`} />}>
                          <Trash2Icon />
                        </PopoverTrigger>
                        <PopoverContent className="w-64">
                          <p className="text-sm">Delete {look.name} and its renders?</p>
                          <Button variant="destructive" size="sm" className="mt-3" onClick={() => remove.mutate(look.id)} disabled={remove.isPending}>
                            Delete Look
                          </Button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {sorted.length > 1 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-6" aria-live="polite">
            <p className="text-sm text-muted-foreground">
              {selected.length === 0
                ? "Select two Looks to compare."
                : selected.length === 1
                  ? `${byId.get(selected[0])?.name} selected. Pick one more.`
                  : `${byId.get(selected[0])?.name} and ${byId.get(selected[1])?.name}`}
            </p>
            <Button className="ml-auto" disabled={selected.length !== 2} onClick={() => router.push(`/compare?a=${selected[0]}&b=${selected[1]}`)}>
              Compare
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
