"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BackendPicker } from "@/components/backend-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { qk, useBackends, useChatHistory } from "@/lib/queries";
import { labelForPointer } from "@/lib/spec";
import type { ChatMessage, DesignSpec, RuleWarning } from "@/lib/types";
import { cn } from "@/lib/utils";

type Meta = { warnings: RuleWarning[]; ambiguities: string[] };

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

type Props = {
  spaceId: string;
  spec: DesignSpec;
  onSpec: (spec: DesignSpec) => void;
  brain: string;
  onBrain: (id: string) => void;
};

export function ChatPanel({ spaceId, spec, onSpec, brain, onBrain }: Props) {
  const qc = useQueryClient();
  const history = useChatHistory(spaceId);
  const backends = useBackends();
  const [draft, setDraft] = useState("");
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [pendingText, setPendingText] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = useMutation({
    mutationFn: (message: string) => api.chat(spaceId, { message, spec, brain }),
    onMutate: (message) => setPendingText(message),
    onSuccess: (res, message) => {
      const stamp = new Date().toISOString();
      const user: ChatMessage = { id: crypto.randomUUID(), role: "user", content: message, created_at: stamp };
      const reply: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: res.reply, created_at: stamp };
      qc.setQueryData<ChatMessage[]>(qk.chat(spaceId), (old) => [...(old ?? []), user, reply]);
      setMeta((m) => ({ ...m, [reply.id]: { warnings: res.warnings, ambiguities: res.ambiguities } }));
      onSpec(res.spec);
    },
    onError: (e, message) => {
      setDraft(message);
      toast.error("The brain didn't answer", { description: errorMessage(e) });
    },
    onSettled: () => setPendingText(null),
  });

  const messages = history.data ?? [];
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const count = messages.length + (pendingText ? 1 : 0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ block: "end", behavior: reduce ? "auto" : "smooth" });
  }, [count]);

  const submit = (text: string) => {
    const message = text.trim();
    if (!message || send.isPending) return;
    setDraft("");
    send.mutate(message);
  };

  return (
    <section aria-labelledby="chat-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 id="chat-heading" className="font-display text-2xl">
          Describe the look
        </h2>
        <BackendPicker kind="brain" options={backends.data?.brains} value={brain} onChange={onBrain} className="min-w-0" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
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
                <li key={m.id} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
                  <p
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                      m.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted",
                    )}
                  >
                    <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
                    {m.content}
                  </p>
                  {info?.warnings.map((w) => <WarningCallout key={`${w.rule}${w.field}`} warning={w} className="max-w-[92%]" />)}
                  {isLast && info && info.ambiguities.length > 0 && !send.isPending && (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested replies">
                      {info.ambiguities.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => submit(a)}
                          className="rounded-full border border-brand/40 bg-brand-soft px-3 py-1 text-sm text-foreground transition-colors hover:border-brand"
                        >
                          {a}
                        </button>
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
        <div ref={endRef} />
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
