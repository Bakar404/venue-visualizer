"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDownIcon, ArrowUpIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BackendPicker } from "@/components/backend-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { qk, useBackends, useChatHistory } from "@/lib/queries";
import { labelForPointer } from "@/lib/spec";
import type { Ambiguity, ChatIntent, ChatMessage, ChatResponse, DesignSpec, RuleWarning } from "@/lib/types";
import { cn } from "@/lib/utils";

type Meta = { notes: string[]; warnings: RuleWarning[]; ambiguities: Ambiguity[]; intent: ChatIntent; specChanged: boolean };

/** Within this many pixels of the bottom, new messages keep the history pinned to the end. */
const STICK_PX = 80;

/** What "Render now" will use, from the selected engine's caps. */
export type RenderInfo = { engineLabel: string; typicalSeconds?: number | null; costNote?: string | null };

function aboutHowLong(seconds: number) {
  return seconds < 90 ? `about ${Math.round(seconds)} s` : `about ${Math.round(seconds / 60)} min`;
}

const STARTERS = [
  "Blush and gold for 120 guests on round tables",
  "Tall centerpieces with garden roses and flameless candles",
  "Add a dance floor and string lights",
];

export function WarningCallout({ warning, className }: { warning: RuleWarning; className?: string }) {
  return (
    <div role="note" className={cn("flex gap-2.5 rounded-lg border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground", className)}>
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p>
          <span className="font-medium">{labelForPointer(warning.field)}:</span> {warning.message}
        </p>
        {warning.fix && <p className="mt-0.5 opacity-90">{warning.fix}</p>}
      </div>
    </div>
  );
}

/** A plain-language rule note from the brain (`rule_notes`), styled like a rule warning. */
export function RuleNoteCallout({ note, className }: { note: string; className?: string }) {
  return (
    <div role="note" className={cn("flex gap-2.5 rounded-lg border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground", className)}>
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0">{note}</p>
    </div>
  );
}

type Props = {
  spaceId: string;
  spec: DesignSpec;
  /** `sent` is the spec the request was made with, so the caller can tell if the draft changed meanwhile. */
  onSpec: (spec: DesignSpec, sent: DesignSpec) => void;
  brain: string | null;
  onBrain: (id: string) => void;
  /** Starts a render of the plan on screen (the same path as Render all photos). */
  onRender?: () => void;
  renderInfo?: RenderInfo | null;
  /** A render of this plan is starting or running. */
  rendering?: boolean;
  /** The brain's short name for the plan, used to prefill Save as Look. */
  onLookName?: (name: string) => void;
};

export function ChatPanel({ spaceId, spec, onSpec, brain, onBrain, onRender, renderInfo, rendering = false, onLookName }: Props) {
  const qc = useQueryClient();
  const history = useChatHistory(spaceId);
  const backends = useBackends();
  const [draft, setDraft] = useState("");
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [pendingText, setPendingText] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** True while the reader is at (or near) the end; only then do new messages scroll the history. */
  const stickRef = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const reduceMotion = useReducedMotion();

  /**
   * The request in flight. `send.isPending` can still be true for a frame after the reply is on screen, which
   * would swallow an Enter pressed right away; this clears exactly when the reply (or error) is shown.
   */
  const inFlight = useRef(false);
  const send = useMutation({
    mutationFn: ({ message, sent }: { message: string; sent: DesignSpec }) =>
      api.chat(spaceId, { message, spec: sent, brain: brain ?? undefined }),
    onMutate: ({ message }) => setPendingText(message),
    onError: (e, { message }) => {
      inFlight.current = false;
      setDraft(message);
      toast.error("The brain didn't answer", { description: errorMessage(e) });
    },
    onSettled: () => setPendingText(null),
  });

  /** Shows the exchange. Called from `mutate`'s callbacks so the reply and "not pending" render together. */
  const showReply = (res: ChatResponse, message: string, sent: DesignSpec) => {
    inFlight.current = false;
    const stamp = new Date().toISOString();
    const user: ChatMessage = { id: crypto.randomUUID(), role: "user", content: message, created_at: stamp };
    const reply: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: res.reply, created_at: stamp };
    qc.setQueryData<ChatMessage[]>(qk.chat(spaceId), (old) => [...(old ?? []), user, reply]);
    setMeta((m) => ({
      ...m,
      [reply.id]: {
        notes: res.rule_notes ?? [],
        warnings: res.warnings,
        ambiguities: res.ambiguities ?? [],
        intent: res.intent ?? "none",
        specChanged: res.spec_changed ?? false,
      },
    }));
    if (res.look_name) onLookName?.(res.look_name);
    onSpec(res.spec, sent);
  };

  const messages = history.data ?? [];
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  // Whenever the history grows (a message, the thinking dots, chips) or the log itself gets shorter (a smaller
  // window, a growing panel below), stay at the end only if the reader was already there.
  useEffect(() => {
    const log = logRef.current;
    const content = contentRef.current;
    if (!log || !content) return;
    const follow = new ResizeObserver(() => {
      if (stickRef.current) log.scrollTop = log.scrollHeight;
    });
    follow.observe(content);
    follow.observe(log);
    return () => follow.disconnect();
  }, []);

  // A reply that arrives while the reader is scrolled up gets a pill instead of a jump. The reply already in the
  // loaded history is the baseline (undefined until it loads; null when the conversation is new), so even the
  // very first reply of a conversation gets the pill.
  const seenReply = useRef<string | null | undefined>(undefined);
  const lastAssistantId = lastAssistant?.id ?? null;
  useEffect(() => {
    if (!history.isSuccess) return;
    if (seenReply.current === undefined) {
      seenReply.current = lastAssistantId;
      return;
    }
    if (lastAssistantId === seenReply.current) return;
    seenReply.current = lastAssistantId;
    if (lastAssistantId && !stickRef.current) setUnseen(true);
  }, [history.isSuccess, lastAssistantId]);

  const onLogScroll = () => {
    const log = logRef.current;
    if (!log) return;
    stickRef.current = log.scrollHeight - log.scrollTop - log.clientHeight <= STICK_PX;
    if (stickRef.current) setUnseen(false);
  };

  const scrollToEnd = (smooth: boolean) => {
    const log = logRef.current;
    if (!log) return;
    stickRef.current = true;
    setUnseen(false);
    log.scrollTo({ top: log.scrollHeight, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
  };

  /** The pill: bring the reader to the newest message and put keyboard focus there (the pill itself unmounts). */
  const showNewest = () => {
    scrollToEnd(true);
    logRef.current?.querySelector<HTMLElement>("ol > li:last-of-type")?.focus({ preventScroll: true });
  };

  const submit = (text: string) => {
    const message = text.trim();
    if (!message || inFlight.current) return;
    inFlight.current = true;
    setDraft("");
    // Sending is an explicit "I'm here": jump to the end so the reply is followed.
    scrollToEnd(false);
    send.mutate({ message, sent: spec }, { onSuccess: (res) => showReply(res, message, spec) });
  };

  return (
    <section aria-labelledby="chat-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 id="chat-heading" className="font-display text-2xl">
          Describe the look
        </h2>
        <BackendPicker kind="brain" options={backends.data?.brains} value={brain} onChange={onBrain} className="min-w-0" />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        onScroll={onLogScroll}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation"
      >
        <div ref={contentRef}>
        {history.isPending ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="ml-auto h-10 w-2/3" />
          </div>
        ) : messages.length === 0 && !pendingText ? (
          <div className="py-3">
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
              Say what you picture, the way you&apos;d brief a planner. The plan below updates as you go, and anything
              the venue doesn&apos;t allow is swapped for something it does.
            </p>
            <ul className="mt-4 flex flex-col items-start gap-2">
              {STARTERS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => submit(s)}
                    className="rounded-full border px-3 py-1.5 text-left text-sm transition-colors hover:border-foreground/25 hover:bg-muted"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="space-y-3 py-2">
            {messages.map((m) => {
              const info = meta[m.id];
              const isLast = m.id === lastAssistant?.id;
              return (
                <li
                  key={m.id}
                  tabIndex={-1}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    m.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  <p
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                      m.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted",
                    )}
                  >
                    <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
                    {m.content}
                  </p>
                  {info && info.notes.length > 0
                    ? info.notes.map((n) => <RuleNoteCallout key={n} note={n} className="max-w-[92%]" />)
                    : info?.warnings.map((w) => <WarningCallout key={`${w.rule}${w.field}`} warning={w} className="max-w-[92%]" />)}
                  {isLast && info?.intent === "render" && (
                    <RenderNowCard id={`${m.id}-ready`} info={renderInfo} rendering={rendering} onRender={onRender} />
                  )}
                  {isLast && info && info.intent !== "render" && info.specChanged && onRender && (
                    <button
                      type="button"
                      onClick={onRender}
                      disabled={rendering}
                      className="inline-flex items-center gap-1.5 rounded-sm px-0.5 text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/40 disabled:pointer-events-none disabled:opacity-60"
                    >
                      <SparklesIcon aria-hidden className="size-3.5" />
                      Render this change
                    </button>
                  )}
                  {isLast && info && info.ambiguities.length > 0 && !send.isPending && (
                    <div className="grid max-w-[92%] gap-2" role="group" aria-label="Suggested replies">
                      {info.ambiguities.map((a, i) => (
                        <div key={`${a.question}${i}`} className="grid gap-1.5">
                          {a.question && <p className="text-xs text-pretty text-muted-foreground">{a.question}</p>}
                          {a.options.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {a.options.map((o) => (
                                <button
                                  key={o}
                                  type="button"
                                  onClick={() => submit(o)}
                                  className="rounded-full border border-brand/40 bg-brand-soft px-3 py-1 text-sm text-foreground transition-[border-color,transform] duration-150 ease-out hover:border-brand active:scale-[0.97]"
                                >
                                  {o}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
            {pendingText && (
              <li className="flex flex-col items-end gap-2">
                <p className="max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground opacity-80">{pendingText}</p>
              </li>
            )}
          </ol>
        )}
        <AnimatePresence>
          {send.isPending && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-1 pb-2 text-sm text-muted-foreground"
            >
              <span className="sr-only">The brain is thinking</span>
              <span aria-hidden className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </span>
            </motion.p>
          )}
        </AnimatePresence>
        </div>
      </div>
        <AnimatePresence>
          {unseen && (
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
              <motion.button
                type="button"
                onClick={showNewest}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : 6, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-sm shadow-md backdrop-blur-sm transition-colors hover:bg-muted active:scale-[0.97]"
              >
                <ArrowDownIcon aria-hidden className="size-3.5" />
                New message
              </motion.button>
            </div>
          )}
        </AnimatePresence>
      </div>

      <form
        className="p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border bg-card p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder="Make the linens sage, add tall peonies"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim() || send.isPending}>
            <ArrowUpIcon />
          </Button>
        </div>
      </form>
    </section>
  );
}

function RenderNowCard({
  id,
  info,
  rendering,
  onRender,
}: {
  id: string;
  info?: RenderInfo | null;
  rendering: boolean;
  onRender?: () => void;
}) {
  const details = [
    info?.engineLabel,
    info?.typicalSeconds ? `${aboutHowLong(info.typicalSeconds)} per photo` : null,
    info?.costNote,
  ].filter(Boolean);
  return (
    <div role="group" aria-labelledby={id} className="flex w-full max-w-[92%] items-center gap-3 rounded-xl border bg-card px-3.5 py-3 shadow-xs">
      <div className="min-w-0 flex-1">
        <p id={id} className="text-sm font-medium">
          Ready to see it?
        </p>
        {details.length > 0 && <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{details.join(" · ")}</p>}
      </div>
      <Button
        size="sm"
        className="shrink-0 bg-brand text-brand-foreground hover:bg-brand/90"
        onClick={onRender}
        disabled={!onRender || rendering || !info}
      >
        <SparklesIcon />
        {rendering ? "Rendering…" : "Render now"}
      </Button>
    </div>
  );
}
