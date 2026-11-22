"use client";

import NumberFlow from "@number-flow/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, CopyIcon, DownloadIcon, GitBranchIcon, ImageIcon, LayoutGridIcon, SaveIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BackendPicker } from "@/components/backend-picker";
import { BackendUnavailableNotice } from "@/components/backend-unavailable-notice";
import { NoEngineNotice } from "@/components/no-engine-notice";
import { QueryError } from "@/components/query-error";
import { ChatPanel, WarningCallout } from "@/components/studio/chat-panel";
import { DescribeVenue } from "@/components/studio/describe-venue";
import { SaveLookDialog, VariationDialog } from "@/components/studio/look-dialogs";
import { PhotoStrip } from "@/components/studio/photo-strip";
import { ReferencePhotos } from "@/components/studio/reference-photos";
import { RenderStage } from "@/components/studio/render-stage";
import { SpecForm } from "@/components/studio/spec-form";
import { type StudioTab, StudioTabBar, studioPanelId, studioTabId } from "@/components/studio/studio-tab-bar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import { api, errorMessage } from "@/lib/api";
import { isActive, trackJobs, useLookHasActiveJobs } from "@/lib/jobs";
import { usePreferences } from "@/lib/preferences";
import { qk, useBackends, useLook, useLooks, useSpace, useVenue } from "@/lib/queries";
import { defaultSpec, formatDate, latestRenderFor, specEquals, suggestLookName, timeOfDayLabel } from "@/lib/spec";
import { setStudioActions } from "@/lib/studio-actions";
import type { DesignSpec, Look, RenderResponse, RuleWarning, Space } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Studio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const space = useSpace(id);

  if (space.isPending) {
    return (
      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[16rem_minmax(0,1fr)_24rem] lg:p-6" aria-busy>
        <Skeleton className="hidden h-96 lg:block" />
        <Skeleton className="aspect-[3/2] w-full" />
        <Skeleton className="hidden h-96 lg:block" />
      </div>
    );
  }
  if (space.error) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6">
        <QueryError error={space.error} onRetry={() => space.refetch()} what="room" />
      </div>
    );
  }
  return <StudioLoaded space={space.data} />;
}

type Tab = StudioTab;

function renderJobs(res: RenderResponse) {
  return res.jobs.map((job, i) => ({ job, renderId: res.renders[i]?.id }));
}

function StudioLoaded({ space }: { space: Space }) {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const venue = useVenue(space.venue_id);
  const looks = useLooks(space.id);
  const backends = useBackends();
  const { engine, setEngine, brain, setBrain } = usePreferences();

  const usablePhotos = space.photos.filter((p) => p.kind === "upload" || p.approved);
  const [localSpec, setLocalSpec] = useState<DesignSpec | null>(null);
  const [pickedPhoto, setPickedPhoto] = useState<string | null>(null);
  // A references-only space shows its reference photos (and the ways to get a base photo) in the Preview pane.
  const keyboard = useKeyboardInset();
  const phoneLayout = usePhoneLayout();
  const [tab, setTab] = useState<Tab>(() => (usablePhotos.length || space.references?.length ? "canvas" : "photos"));
  const [check, setCheck] = useState<{ warnings: RuleWarning[]; fixed: DesignSpec } | null>(null);
  const [specOpen, setSpecOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [variationOpen, setVariationOpen] = useState(false);
  /** Set while the draft is a copy of a saved Look; `roomDraft` is what the room had before, for restoring. */
  const [copyOf, setCopyOf] = useState<{ id: string; name: string; roomDraft: DesignSpec } | null>(null);
  /** The `?look=` value whose spec has already been loaded into the draft. */
  const [appliedLookParam, setAppliedLookParam] = useState<string | null>(null);
  /** The brain's name for the plan from the latest chat reply; prefills Save as Look. */
  const [chatLookName, setChatLookName] = useState<string | null>(null);
  const checkSeq = useRef(0);
  /** Blocks a second Render all from a fast double click before React re-renders with `isPending`. */
  const renderStarting = useRef(false);

  const draft = localSpec ?? space.current_spec ?? defaultSpec(space.name.toLowerCase());
  // Async results (rule checks, chat replies) compare against the latest draft, not the one they closed over.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const selectedPhoto = usablePhotos.find((p) => p.id === pickedPhoto) ?? usablePhotos[0];
  const photoLabel = (id: string | undefined) => {
    const i = usablePhotos.findIndex((p) => p.id === id);
    return usablePhotos[i]?.kind === "generated_base" ? `Generated view ${i + 1}` : `Photo ${i + 1}`;
  };

  const sortedLooks = [...(looks.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const lookParam = searchParams.get("look");
  const activeLookId =
    lookParam && (!looks.data || sortedLooks.some((l) => l.id === lookParam)) ? lookParam : (sortedLooks[0]?.id ?? null);
  const lookQuery = useLook(activeLookId);
  const activeLook: Look | undefined = lookQuery.data ?? sortedLooks.find((l) => l.id === activeLookId);
  const activeRender = selectedPhoto ? latestRenderFor(activeLook?.renders, selectedPhoto.id) : undefined;

  // Opening a saved Look (`?look=…&open=1` from the Looks page, or the picker) edits a copy of its spec, so Render
  // renders what's on screen. The room's own draft is kept so it can be restored. A bare `?look=` (written after
  // Render all / Save) only selects the Look, so reloading never replaces the saved room draft.
  const openParam = searchParams.get("open") === "1";
  const paramLook = lookParam ? (lookQuery.data?.id === lookParam ? lookQuery.data : sortedLooks.find((l) => l.id === lookParam)) : undefined;
  if (lookParam && openParam && paramLook && appliedLookParam !== lookParam) {
    setAppliedLookParam(lookParam);
    if (!specEquals(paramLook.spec, draft)) {
      setCopyOf({ id: paramLook.id, name: paramLook.name, roomDraft: copyOf?.roomDraft ?? draft });
      setLocalSpec(paramLook.spec);
      setCheck(null);
    }
  }

  // `open=1` is a one-shot request: drop it once applied so a reload keeps editing the room draft.
  useEffect(() => {
    if (!openParam || appliedLookParam !== lookParam) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    window.history.replaceState(null, "", url);
  }, [openParam, appliedLookParam, lookParam]);

  // Flushed (not dropped) on unmount and when the tab is hidden, so the last edit is always saved.
  const persist = useDebouncedCallback(
    (spec: DesignSpec) => {
      api
        .updateSpace(space.id, { current_spec: spec })
        .then((saved) => qc.setQueryData(qk.space(space.id), saved))
        .catch((e) => toast.error("Couldn't save the plan", { description: errorMessage(e) }));
    },
    600,
    { flushOnUnmount: true },
  );

  const runCheck = useDebouncedCallback((spec: DesignSpec) => {
    const seq = ++checkSeq.current;
    api
      .checkSpec({ spec, venue_id: space.venue_id })
      .then((res) => {
        // Drop results for a spec that is no longer the draft (a chat reply or fix may have replaced it).
        if (seq !== checkSeq.current || !specEquals(spec, draftRef.current)) return;
        setCheck(res.warnings.length ? { warnings: res.warnings, fixed: res.spec } : null);
      })
      .catch(() => {
        // Rule checks are advisory here; the API enforces rules again when a Look is saved.
      });
  }, 400);

  /** `check: false` marks a non-form source (chat reply, applied fix, Look switch): the spec is already checked. */
  const updateSpec = (next: DesignSpec, opts: { check?: boolean } = {}) => {
    draftRef.current = next;
    setLocalSpec(next);
    persist(next);
    if (opts.check === false) {
      runCheck.cancel();
      checkSeq.current++;
      setCheck(null);
    } else {
      runCheck(next);
    }
  };

  /** A chat reply always wins, but edits made while it was in flight can be brought back. */
  const applyChatSpec = (spec: DesignSpec, sent: DesignSpec) => {
    const before = draftRef.current;
    updateSpec(spec, { check: false });
    if (!specEquals(before, sent)) {
      toast("Updated from chat — your edits during the reply were replaced", {
        action: { label: "Undo", onClick: () => updateSpec(before) },
      });
    }
  };

  /** Shows a saved Look's spec as an editable copy. */
  const openLook = (look: Look) => {
    setAppliedLookParam(look.id);
    selectLook(look.id);
    if (specEquals(look.spec, draft)) return;
    setCopyOf({ id: look.id, name: look.name, roomDraft: copyOf?.roomDraft ?? draft });
    runCheck.cancel();
    checkSeq.current++;
    draftRef.current = look.spec;
    setLocalSpec(look.spec);
    setCheck(null);
  };

  const restoreRoomDraft = () => {
    if (!copyOf) return;
    const room = copyOf.roomDraft;
    setCopyOf(null);
    updateSpec(room);
  };

  const selectLook = (lookId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("look", lookId);
    window.history.replaceState(null, "", url);
  };

  /**
   * Makes a Look this screen just created the active one. Its spec becomes the room's draft only if the draft is still
   * the plan that was `submitted`; edits made while the request was in flight are kept (the canvas then says the plan
   * changed since this render).
   */
  const adoptLook = (look: Look, submitted: DesignSpec) => {
    qc.setQueryData<Look[]>(qk.looks(space.id), (old) => (old?.some((l) => l.id === look.id) ? old : [look, ...(old ?? [])]));
    void qc.invalidateQueries({ queryKey: qk.looks(space.id) });
    void qc.invalidateQueries({ queryKey: qk.look(look.id) });
    setAppliedLookParam(look.id);
    selectLook(look.id);
    setCopyOf(null);
    const current = draftRef.current;
    if (specEquals(current, submitted) && !specEquals(look.spec, current)) updateSpec(look.spec, { check: false });
  };

  const photoIds = usablePhotos.map((p) => p.id);
  // Render all reuses the active Look when the draft matches it; block a second run while that one is in flight.
  const reusableLook = activeLook && specEquals(activeLook.spec, draft) ? activeLook : undefined;
  const trackerBusy = useLookHasActiveJobs(reusableLook?.id);
  const lookRendering =
    trackerBusy || Boolean(reusableLook?.renders?.some((r) => photoIds.includes(r.photo_id) && isActive(r.status)));
  const noEngine = backends.isSuccess && !engine;
  const renderingLabel = (n: number) => (n === 1 ? "Rendering 1 photo" : `Rendering ${n} photos`);

  const renderAll = useMutation({
    mutationFn: async () => {
      if (!photoIds.length) throw new Error("Add a photo first, or describe the venue and approve a base image.");
      if (!engine) throw new Error("No image engine found — install/log in to Copilot CLI, Codex CLI, or mflux.");
      const submitted = draft;
      const look = reusableLook ?? (await api.createLook(space.id, { name: suggestLookName(submitted), spec: submitted, parent_look_id: null }));
      const res = await api.renderLook(look.id, { engine, photo_ids: photoIds });
      return { look, res, submitted };
    },
    onSuccess: ({ look, res, submitted }) => {
      trackJobs(qc, renderJobs(res), {
        pending: renderingLabel(res.jobs.length),
        done: `${look.name} is ready`,
        failed: `Couldn't render ${look.name}`,
        spaceId: space.id,
        lookId: look.id,
      });
      adoptLook(look, submitted);
    },
    onError: (e) => toast.error("Couldn't start rendering", { description: errorMessage(e) }),
    onSettled: () => {
      renderStarting.current = false;
    },
  });
  const rendering = renderAll.isPending || lookRendering;
  const noBasePhoto = usablePhotos.length === 0;
  const renderDisabled = rendering || !engine || noBasePhoto;
  const renderAllIfIdle = () => {
    if (renderStarting.current || rendering) toast.info("Already rendering this Look");
    else if (!engine) toast.info(backends.isPending ? "Still checking for image engines…" : "No image engine found");
    else {
      renderStarting.current = true;
      renderAll.mutate();
    }
  };
  const engineInfo = backends.data?.engines.find((e) => e.id === engine);
  const renderInfo = engineInfo
    ? { engineLabel: engineInfo.label, typicalSeconds: engineInfo.caps?.typical_seconds, costNote: engineInfo.caps?.cost_note }
    : null;
  // The render on screen shows a Look whose plan differs from the draft (chat or form edits since).
  const planChanged = Boolean(activeLook && !specEquals(activeLook.spec, draft));
  const timeLabel = timeOfDayLabel(draft);

  const saveLook = useMutation({
    mutationFn: async (name: string) => {
      const submitted = draft;
      return { look: await api.createLook(space.id, { name, spec: submitted, parent_look_id: null }), submitted };
    },
    onSuccess: ({ look, submitted }) => {
      setSaveOpen(false);
      adoptLook(look, submitted);
      toast.success("Look saved", { description: look.name });
    },
    onError: (e) => toast.error("Couldn't save the Look", { description: errorMessage(e) }),
  });

  const variation = useMutation({
    mutationFn: async (prompt: string) => {
      if (!activeLook) throw new Error("Save or render a Look first, then make variations of it.");
      const submitted = draft;
      const chat = await api.chat(space.id, { message: prompt, spec: activeLook.spec, brain: brain ?? undefined });
      const suggested = suggestLookName(chat.spec);
      const name = suggested !== activeLook.name ? suggested : `${activeLook.name}, variation`;
      const look = await api.createLook(space.id, { name, spec: chat.spec, parent_look_id: activeLook.id });
      const res = photoIds.length && engine ? await api.renderLook(look.id, { engine, photo_ids: photoIds }) : null;
      return { look, res, chat, submitted };
    },
    onSuccess: ({ look, res, chat, submitted }) => {
      setVariationOpen(false);
      void qc.invalidateQueries({ queryKey: qk.chat(space.id) });
      adoptLook(look, submitted);
      if (res) {
        trackJobs(qc, renderJobs(res), {
          pending: `Rendering ${look.name}`,
          done: `${look.name} is ready`,
          failed: `Couldn't render ${look.name}`,
          spaceId: space.id,
          lookId: look.id,
        });
      } else {
        toast.success("Variation saved", { description: look.name });
      }
      if (chat.rule_notes?.length) for (const n of chat.rule_notes) toast.warning(n);
      else for (const w of chat.warnings) toast.warning(w.message, { description: w.fix ?? undefined });
    },
    onError: (e) => toast.error("Couldn't make the variation", { description: errorMessage(e) }),
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      if (!activeLook || !selectedPhoto) throw new Error("Pick a photo and a Look first.");
      if (!engine) throw new Error("No image engine found — install/log in to Copilot CLI, Codex CLI, or mflux.");
      const render = latestRenderFor(activeLook.renders, selectedPhoto.id);
      if (render) {
        const job = await api.regenerateRender(render.id, { engine });
        return { look: activeLook, jobs: [{ job, renderId: render.id }] };
      }
      const res = await api.renderLook(activeLook.id, { engine, photo_ids: [selectedPhoto.id] });
      return { look: activeLook, jobs: renderJobs(res) };
    },
    onSuccess: ({ look, jobs }) => {
      trackJobs(qc, jobs, {
        pending: `Rendering ${photoLabel(selectedPhoto?.id).toLowerCase()}`,
        done: "Photo rendered",
        failed: "Render failed",
        spaceId: space.id,
        lookId: look.id,
      });
      void qc.invalidateQueries({ queryKey: qk.look(look.id) });
    },
    onError: (e) => toast.error("Couldn't regenerate", { description: errorMessage(e) }),
  });

  const exportLook = async () => {
    if (!activeLook) return;
    try {
      const url = await api.exportUrl(activeLook.id);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error("Couldn't export the PDF", { description: errorMessage(e) });
    }
  };

  const otherLook = sortedLooks.find((l) => l.id === activeLook?.parent_look_id) ?? sortedLooks.find((l) => l.id !== activeLookId);
  const compareHref = activeLook && otherLook ? `/compare?a=${otherLook.id}&b=${activeLook.id}` : `/spaces/${space.id}/looks`;

  // The ⌘K palette calls into the studio through stable wrappers around the latest handlers.
  const handlers = useRef({ renderAll: () => {}, saveLook: () => {}, makeVariation: () => {}, exportLook: () => {} });
  useEffect(() => {
    handlers.current = {
      renderAll: renderAllIfIdle,
      saveLook: () => setSaveOpen(true),
      makeVariation: () => (activeLook ? setVariationOpen(true) : toast.info("Save or render a Look first, then make variations of it.")),
      exportLook: () => void exportLook(),
    };
  });
  const hasLook = Boolean(activeLook);
  useEffect(() => {
    setStudioActions({
      spaceId: space.id,
      renderAll: () => handlers.current.renderAll(),
      saveLook: () => handlers.current.saveLook(),
      makeVariation: () => handlers.current.makeVariation(),
      exportLook: hasLook ? () => handlers.current.exportLook() : null,
      compareHref,
    });
    return () => setStudioActions(null);
  }, [space.id, hasLook, compareHref]);

  // On phones the panes are tab panels of the bottom tab bar; on wider screens they sit side by side as regions.
  const panel = (of: StudioTab, label: string) =>
    phoneLayout ? { id: studioPanelId(of), role: "tabpanel", "aria-labelledby": studioTabId(of) } : { id: studioPanelId(of), "aria-label": label };

  const lookItems = sortedLooks.map((l) => ({ value: l.id, label: l.name }));
  const warnings = check?.warnings ?? [];

  return (
    // Fills the viewport under the site header (h-14 + 1px border + the top safe area); each column scrolls on its own.
    // The bottom stops above the home indicator (bottom safe area) or, on phones, the on-screen keyboard (`--kb`, see
    // useKeyboardInset), whichever is taller.
    <div
      data-testid="studio"
      style={{ "--kb": `${keyboard}px` } as React.CSSProperties}
      className="flex h-[calc(100dvh-3.5rem-1px-var(--safe-top,env(safe-area-inset-top,0px))-max(var(--kb,0px),var(--safe-bottom,env(safe-area-inset-bottom,0px))))] min-h-0 flex-col overflow-hidden"
    >
      <div className={cn("border-b", keyboard > 0 && "max-lg:hidden")}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-6">
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
              <Link href={`/venues/${space.venue_id}`} className="rounded-sm hover:text-foreground pointer-coarse:-my-3 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                {venue.data?.name ?? "Venue"}
              </Link>
            </nav>
            <h1 className="font-display truncate text-3xl leading-tight">{space.name}</h1>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {sortedLooks.length > 0 && (
              <Select
                items={lookItems}
                value={activeLookId}
                onValueChange={(v) => {
                  const look = sortedLooks.find((l) => l.id === v);
                  if (look) openLook(look);
                }}
              >
                <SelectTrigger size="sm" aria-label="Active Look" className="max-w-60">
                  <span className="text-muted-foreground">Look</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} className="min-w-64">
                  {sortedLooks.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      <span className="truncate">{l.name}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(l.created_at)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Link href={`/spaces/${space.id}/looks`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <LayoutGridIcon />
              All Looks
            </Link>
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="sm" onClick={() => void exportLook()} disabled={!activeLook} />}>
                <DownloadIcon />
                Export PDF
              </TooltipTrigger>
              <TooltipContent>Includes credits for any photos from the web</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      <BackendUnavailableNotice />

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)_24rem] xl:grid-cols-[17rem_minmax(0,1fr)_27rem]">
        <aside {...panel("photos", "Photos")} className={cn("scrollbar-thin min-h-0 overflow-y-auto overscroll-contain p-4 lg:block lg:border-r", tab !== "photos" && "hidden")}>
          {usablePhotos.length ? (
            <PhotoStrip
              spaceId={space.id}
              photos={usablePhotos}
              selectedId={selectedPhoto?.id}
              onSelect={(photoId) => {
                setPickedPhoto(photoId);
                setTab("canvas");
              }}
              look={activeLook}
              candidate={space.photos.find((p) => p.kind === "generated_base" && !p.approved)}
            />
          ) : (
            <DescribeVenue
              space={space}
              onApproved={(photo) => {
                setPickedPhoto(photo.id);
                setTab("canvas");
              }}
            />
          )}
        </aside>

        <section
          {...panel("canvas", "Preview")}
          className={cn("scrollbar-thin min-h-0 overflow-y-auto overscroll-contain p-4 lg:block lg:p-6", tab !== "canvas" && "hidden")}
        >
          {selectedPhoto ? (
            <div className="mx-auto max-w-5xl">
              <RenderStage
                photo={selectedPhoto}
                photoLabel={photoLabel(selectedPhoto.id)}
                look={activeLook}
                render={activeRender}
                structureThreshold={backends.data?.thresholds?.structure_ok}
                onRegenerate={() => regenerate.mutate()}
                regenerating={regenerate.isPending}
                regenerateDisabled={!engine}
                toolbar={<BackendPicker kind="engine" options={backends.data?.engines} value={engine} onChange={setEngine} />}
                stale={planChanged}
                onRenderLatest={renderAllIfIdle}
                renderLatestDisabled={renderDisabled}
              />
            </div>
          ) : space.references?.length ? (
            <ReferencePhotos
              space={space}
              onReady={(photo) => {
                setPickedPhoto(photo.id);
                setTab("canvas");
              }}
              onDescribe={() => {
                setTab("photos");
                requestAnimationFrame(() => {
                  const card = document.getElementById("describe-venue");
                  card?.scrollIntoView({ behavior: "smooth", block: "start" });
                  card?.querySelector<HTMLElement>("input, textarea, button[role=combobox]")?.focus({ preventScroll: true });
                });
              }}
            />
          ) : (
            <div className="mx-auto flex aspect-[3/2] max-w-5xl flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">
              <ImageIcon className="size-6 text-muted-foreground" />
              <p className="font-display text-3xl">Start with the room</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Add photos of the empty space, or describe it and generate a base image. Renders appear here.
              </p>
              <Button variant="outline" className="lg:hidden" onClick={() => setTab("photos")}>
                Add photos
              </Button>
            </div>
          )}
        </section>

        <aside {...panel(tab === "chat" ? "chat" : "plan", "Plan")} className={cn("flex min-h-0 flex-col lg:border-l", tab !== "plan" && tab !== "chat" && "hidden lg:flex")}>
          {copyOf && (
            <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm" role="status">
              <CopyIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 truncate">
                Editing a copy of <span className="font-medium">{copyOf.name}</span>
              </p>
              <Button size="sm" variant="ghost" onClick={restoreRoomDraft}>
                Restore room draft
              </Button>
            </div>
          )}
          <ChatPanel
            spaceId={space.id}
            spec={draft}
            brain={brain}
            onBrain={setBrain}
            onSpec={applyChatSpec}
            onRender={usablePhotos.length ? renderAllIfIdle : undefined}
            renderInfo={renderInfo}
            rendering={rendering}
            onLookName={setChatLookName}
          />
          <Collapsible open={specOpen} onOpenChange={setSpecOpen} className={cn("border-t", tab === "chat" && "max-lg:hidden")}>
            <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="text-sm font-medium">Plan details</span>
              {warnings.length > 0 && (
                <span className="rounded-full bg-warning px-2 py-0.5 text-xs text-warning-foreground">
                  {warnings.length === 1 ? "1 rule conflict" : `${warnings.length} rule conflicts`}
                </span>
              )}
              {timeLabel && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{timeLabel}</span>}
              <span className="ml-auto flex items-center gap-1 text-sm text-muted-foreground tabular">
                <NumberFlow value={draft.guest_count ?? 0} /> guests, <NumberFlow value={draft.tables.count} /> tables
              </span>
              <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted className="scrollbar-thin max-h-[40dvh] overflow-y-auto overscroll-contain px-4 data-closed:hidden">
              {warnings.length > 0 && (
                <div className="space-y-2 pb-3" aria-live="polite">
                  {warnings.map((w) => (
                    <WarningCallout key={`${w.rule}${w.field}`} warning={w} />
                  ))}
                  <Button size="sm" variant="outline" onClick={() => check && updateSpec(check.fixed, { check: false })}>
                    Apply {warnings.length === 1 ? "the fix" : "all fixes"}
                  </Button>
                </div>
              )}
              <SpecForm spec={draft} onChange={(spec) => updateSpec(spec)} rules={venue.data?.rules} />
            </CollapsibleContent>
          </Collapsible>
          <div className={cn("grid gap-2 border-t p-3", tab === "chat" && "max-lg:hidden")}>
            {noEngine && <NoEngineNotice />}
            <Button
              size="lg"
              className="h-10 bg-brand text-brand-foreground hover:bg-brand/90 max-lg:hidden"
              onClick={renderAllIfIdle}
              disabled={renderDisabled}
              aria-busy={backends.isPending || lookRendering || undefined}
            >
              <SparklesIcon />
              {lookRendering ? "Rendering…" : "Render all photos"}
              {usablePhotos.length > 0 && <span className="tabular opacity-75">({usablePhotos.length})</span>}
            </Button>
            {noBasePhoto && (
              <p className="text-center text-sm text-muted-foreground lg:text-xs">Add or approve a base photo to render</p>
            )}
            {backends.data?.internal?.layout_guide?.available && (
              <p className="text-center text-sm text-muted-foreground lg:text-xs" title={backends.data.internal.layout_guide.detail ?? undefined}>
                Exact table layout guide on
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setSaveOpen(true)}>
                <SaveIcon />
                Save as Look
              </Button>
              <Button variant="outline" onClick={() => setVariationOpen(true)} disabled={!activeLook}>
                <GitBranchIcon />
                Make a variation
              </Button>
            </div>
          </div>
        </aside>
      </div>

      <StudioTabBar
        className={cn("lg:hidden", keyboard > 0 && "hidden")}
        tab={tab}
        onTab={setTab}
        onRender={renderAllIfIdle}
        renderDisabled={renderDisabled}
        rendering={lookRendering}
        busy={backends.isPending || lookRendering}
        photoCount={usablePhotos.length}
      />

      <SaveLookDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        suggestedName={chatLookName?.trim() || suggestLookName(draft)}
        onSave={(name) => saveLook.mutate(name)}
        pending={saveLook.isPending}
      />
      <VariationDialog
        open={variationOpen}
        onOpenChange={setVariationOpen}
        baseName={activeLook?.name ?? "this Look"}
        onSubmit={(prompt) => variation.mutate(prompt)}
        pending={variation.isPending}
        willRender={photoIds.length > 0}
      />
    </div>
  );
}
