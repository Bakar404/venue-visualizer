"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRightIcon, CheckIcon, ChevronDownIcon, CopyIcon, ImageIcon, Loader2Icon, MessageSquareIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";

import { Ticks } from "@/components/setup/ticks";
import { FREE_ENGINES, USED_FOR_LABELS, type ProviderInfo } from "@/components/setup/providers";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { setupPill, type SetupPill } from "@/lib/backends";
import { qk, useRefreshBackends, useSettings, useUpdateSettings } from "@/lib/queries";
import type { BackendStatus, UsedFor } from "@/lib/types";
import { cn } from "@/lib/utils";

type Kind = "brain" | "engine";
type Result = { kind: Kind; ok: boolean; seconds: number; detail: string; sample_url?: string | null };

const PILL_STYLES: Record<SetupPill, string> = {
  Ready: "bg-brand-soft text-brand ring-brand/25",
  "Installed, not signed in": "bg-warning text-warning-foreground ring-warning-border",
  Unknown: "bg-warning/60 text-warning-foreground ring-warning-border/70",
  "Not installed": "bg-muted text-muted-foreground ring-border",
};

function Pill({ value }: { value: SetupPill }) {
  return (
    <span
      data-testid="status-pill"
      className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-sm font-medium ring-1 ring-inset", PILL_STYLES[value])}
    >
      {value}
    </span>
  );
}

const noop = () => () => {};
/** The commands the API sends depend on the computer's OS; the browser's guess is good enough to pick one. */
function useOs(): "macos" | "linux" {
  return useSyncExternalStore(
    noop,
    () => (/Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent) ? "linux" : "macos"),
    () => "macos",
  );
}

function Command({ which, label, command }: { which: "install" | "sign-in"; label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-start gap-1 rounded-lg bg-muted/60 py-1 pr-1 pl-3 ring-1 ring-border/70">
        <code data-testid={`${which}-command`} className="min-w-0 flex-1 self-center py-1 font-mono text-sm break-words whitespace-pre-wrap">
          {command}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? `Copied ${which} command` : `Copy ${which} command`}
          onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}
        >
          {copied ? <CheckIcon className="text-brand" /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}

function roleLine(brain: BackendStatus | undefined, engine: BackendStatus | undefined) {
  if (brain && engine) return "Brain and image engine";
  return brain ? "Brain" : "Image engine";
}

function latestTest(...list: (BackendStatus | undefined)[]): (Result & { at: string }) | null {
  let best: (Result & { at: string }) | null = null;
  for (const b of list) {
    const t = b?.last_test;
    if (t && (!best || t.at > best.at)) best = { ...t, kind: b.kind as Kind };
  }
  return best;
}

function TestResult({ result, engineLabel }: { result: Result; engineLabel: string }) {
  const what = result.kind === "brain" ? "Chat test" : "Image test";
  return (
    <div
      data-testid="test-result"
      className={cn(
        "rounded-lg border p-3 text-sm",
        result.ok ? "border-brand/25 bg-brand-soft" : "border-warning-border bg-warning text-warning-foreground",
      )}
    >
      <p className="font-medium">
        {what}: {result.ok ? `Passed in ${result.seconds.toFixed(1)} s` : `Failed after ${result.seconds.toFixed(1)} s`}
      </p>
      <p className={cn("mt-1 break-words", result.ok && "text-muted-foreground")}>
        {result.ok ? "It answered: " : ""}
        <Ticks text={result.detail} />
      </p>
      {result.ok && result.sample_url && (
        <img
          src={result.sample_url}
          alt={`Your test image from ${engineLabel}`}
          className="mt-3 aspect-[3/2] w-full max-w-xs rounded-md object-cover ring-1 ring-border"
        />
      )}
    </div>
  );
}

function Advanced({ provider }: { provider: ProviderInfo }) {
  const field = provider.advanced!;
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const id = useId();
  const saved = (settings?.providers[field.group] as Record<string, string | null | undefined> | undefined)?.[field.key] ?? "";
  const [value, setValue] = useState<string | null>(null);
  const current = value ?? saved;
  return (
    <form
      className="grid gap-2 rounded-lg border border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ providers: { [field.group]: { [field.key]: current.trim() || null } } });
      }}
    >
      <Label htmlFor={id}>{field.label}</Label>
      <p id={`${id}-hint`} className="text-sm text-pretty text-muted-foreground">
        {field.hint}
      </p>
      <div className="flex gap-2">
        <Input
          id={id}
          aria-describedby={`${id}-hint`}
          value={current}
          placeholder={field.placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="font-mono"
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={update.isPending}>
          Save
        </Button>
      </div>
      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {update.isError ? errorMessage(update.error) : update.isSuccess ? "Saved. It applies to the next chat or render." : ""}
      </p>
    </form>
  );
}

/** One AI tool on the setup page: what it does, whether it's ready, and how to get it ready. */
export function ProviderCard({ provider, brain, engine }: { provider: ProviderInfo; brain?: BackendStatus; engine?: BackendStatus }) {
  const qc = useQueryClient();
  const os = useOs();
  const headingId = useId();
  const advancedId = useId();
  const refresh = useRefreshBackends();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const base = brain ?? engine;
  const lastTest = latestTest(brain, engine);
  const pill = base
    ? setupPill({ available: Boolean(brain?.available || engine?.available), logged_in: base.logged_in, last_test: lastTest })
    : "Not installed";
  const usedFor: UsedFor[] = base?.used_for ?? [...(brain ? (["chat"] as const) : []), ...(engine ? (["images"] as const) : [])];
  const costNote = base?.cost_note ?? engine?.caps?.cost_note ?? "See the provider's pricing.";
  const install = base?.install ? (os === "linux" ? base.install.linux : base.install.macos) : null;
  const login = base?.login ?? null;
  const installed = pill !== "Not installed";
  const engineLabel = engine?.label ?? provider.name;

  const test = useMutation({
    mutationFn: async ({ kind, confirm }: { kind: Kind; confirm: boolean }) => ({
      kind,
      ...(await api.testBackend(kind, kind === "brain" ? brain!.id : engine!.id, { confirm_credits: confirm })),
    }),
    onMutate: () => setResult(null),
    onSuccess: (r) => setResult(r),
    onError: (e, { kind }) => setResult({ kind, ok: false, seconds: 0, detail: errorMessage(e) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.backends });
      void qc.invalidateQueries({ queryKey: qk.setup });
    },
  });
  const shown = result ?? lastTest;
  const freeImages = engine ? FREE_ENGINES.has(engine.id) : false;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-[0_1px_0_0_var(--border)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-lg leading-tight font-medium">
            {provider.name}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{roleLine(brain, engine)}</p>
        </div>
        <Pill value={pill} />
      </div>

      <p className="text-pretty text-foreground/85">{provider.blurb}</p>

      <div className="grid gap-2">
        <ul aria-label="Used for" className="flex flex-wrap gap-1.5">
          {usedFor.map((u) => (
            <li key={u} className="rounded-full bg-muted px-2.5 py-0.5 text-sm text-foreground/80">
              {USED_FOR_LABELS[u]}
            </li>
          ))}
        </ul>
        <p data-testid="cost-note" className="text-sm text-muted-foreground">
          {costNote}
        </p>
      </div>

      {pill === "Not installed" && (
        <div className="grid gap-3">
          <p className="text-sm text-pretty">
            Not on this computer yet. Open the Terminal app, paste the install command
            {login ? ", then the sign-in command" : ""}, and come back to press Check again.
          </p>
          {install && <Command which="install" label="1. Install" command={install} />}
          {login && <Command which="sign-in" label={install ? "2. Sign in" : "Sign in"} command={login} />}
        </div>
      )}
      {pill === "Installed, not signed in" && login && (
        <div className="grid gap-3">
          <p className="text-sm text-pretty">It&apos;s installed but not signed in. Run this in Terminal, then press Check again.</p>
          <Command which="sign-in" label="Sign in" command={login} />
        </div>
      )}
      {pill === "Unknown" && (
        <div className="grid gap-3">
          <p className="text-sm text-pretty">
            It&apos;s installed, but we can&apos;t tell whether it&apos;s signed in. Run a test to find out.
          </p>
          {login && <Command which="sign-in" label="If the test fails, sign in with" command={login} />}
        </div>
      )}
      {pill === "Ready" && base?.version && <p className="text-sm text-muted-foreground">Version {base.version} is installed and signed in.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCwIcon aria-hidden className={cn(refresh.isPending && "animate-spin")} />
          Check again
        </Button>
        {installed && brain?.available && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-busy={test.isPending && test.variables?.kind === "brain"}
            disabled={test.isPending}
            onClick={() => test.mutate({ kind: "brain", confirm: false })}
          >
            {test.isPending && test.variables?.kind === "brain" ? <Loader2Icon aria-hidden className="animate-spin" /> : <MessageSquareIcon aria-hidden />}
            Test chat
          </Button>
        )}
        {installed && engine?.available && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-busy={test.isPending && test.variables?.kind === "engine"}
            disabled={test.isPending}
            onClick={() => (freeImages ? test.mutate({ kind: "engine", confirm: false }) : setConfirming(true))}
          >
            {test.isPending && test.variables?.kind === "engine" ? <Loader2Icon aria-hidden className="animate-spin" /> : <ImageIcon aria-hidden />}
            Test images
          </Button>
        )}
        {!installed && base?.install?.docs_url && (
          <a href={base.install.docs_url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Install guide
            <ArrowUpRightIcon aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        {provider.advanced && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            aria-expanded={advancedOpen}
            aria-controls={advancedId}
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            Advanced
            <ChevronDownIcon aria-hidden className={cn("transition-transform duration-200 ease-out", advancedOpen && "rotate-180")} />
          </Button>
        )}
      </div>

      <div aria-live="polite" className="empty:hidden">
        {test.isPending && (
          <p className="text-sm text-muted-foreground">
            {test.variables?.kind === "engine"
              ? `Making a small test image with ${engineLabel}. This can take up to a minute.`
              : "Asking for a one-line answer. This takes a few seconds."}
          </p>
        )}
      </div>
      {!test.isPending && shown && <TestResult result={shown} engineLabel={engineLabel} />}

      {provider.advanced && advancedOpen && (
        <div id={advancedId}>
          <Advanced provider={provider} />
        </div>
      )}

      {engine && !freeImages && (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogTitle>Use credits for a test image?</AlertDialogTitle>
            <AlertDialogDescription>
              The test makes one small image with {engineLabel}, so it uses some of your credits or plan quota
              ({costNote.charAt(0).toLowerCase() + costNote.slice(1)}). Chat tests are much cheaper.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
              <Button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  test.mutate({ kind: "engine", confirm: true });
                }}
              >
                Use credits and test
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
}
