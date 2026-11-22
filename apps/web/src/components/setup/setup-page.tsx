"use client";

import { CheckIcon, RefreshCwIcon } from "lucide-react";
import { useId } from "react";

import { DefaultsStep } from "@/components/setup/defaults-step";
import { PhoneAccess } from "@/components/setup/phone-access";
import { ProviderCard } from "@/components/setup/provider-card";
import { PROVIDERS } from "@/components/setup/providers";
import { TryItStep } from "@/components/setup/try-it-step";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { likelyNote } from "@/lib/backends";
import { useBackends, useSettings, useSetupStatus } from "@/lib/queries";
import type { SetupStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

function Step({ n, title, done, intro, children }: { n: number; title: string; done?: boolean; intro?: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-6 border-t pt-10 sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:gap-x-6">
      <span
        aria-hidden
        className={cn(
          "grid size-11 place-items-center rounded-full font-display text-2xl leading-none ring-1",
          done ? "bg-brand text-brand-foreground ring-brand" : "text-brand ring-border",
        )}
      >
        {done ? <CheckIcon className="size-5" /> : n}
      </span>
      <div className="grid min-w-0 gap-6">
        <div>
          <h2 id={id} className="font-display text-3xl sm:text-4xl">
            {title}
          </h2>
          {intro && <div className="mt-2 max-w-prose text-pretty text-muted-foreground">{intro}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** The same rule as `make doctor` (services/api/readiness.py): only a sign-in or a passed test makes a tool ready. */
function summaryText(setup: SetupStatus) {
  const parts = [setup.brain.missing && "a brain", setup.engine.missing && "an image engine"].filter(Boolean);
  const head = parts.length ? `Still needed: ${parts.join(" and ")}.` : "You have a ready brain and a ready image engine.";
  const note = likelyNote([...(setup.brain.missing ? setup.brain.likely : []), ...(setup.engine.missing ? setup.engine.likely : [])]);
  return note ? `${head} ${note}` : head;
}

/** `/setup`: get from a fresh clone to a first render (docs/onboarding-and-mobile.md, section 1). */
export function SetupPage() {
  const backends = useBackends();
  const settings = useSettings();
  const setup = useSetupStatus();
  const advancedId = useId();
  const toolsDone = setup.data ? !setup.data.brain.missing && !setup.data.engine.missing : false;
  const defaultsDone = Boolean(settings.data?.setup_completed_at);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-10 pb-24 sm:px-6 lg:pt-16">
      <header className="max-w-3xl">
        <p className="text-sm font-medium tracking-wide text-brand uppercase">First-run setup</p>
        <h1 className="mt-3 font-display text-[2.9rem] leading-[0.98] tracking-[-0.01em] text-balance sm:text-6xl">Set up your AI tools</h1>
        <p className="mt-5 text-lg leading-relaxed text-pretty text-muted-foreground">
          Venue Visualizer has no AI of its own. It borrows the AI tools you already use on this computer, so there&apos;s no
          new account or subscription. It needs two kinds:
        </p>
      </header>
      <dl className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-muted/50 p-5 ring-1 ring-border/70">
          <dt className="font-medium">A brain</dt>
          <dd className="mt-1 text-pretty text-muted-foreground">
            The brain is the AI you chat with. It turns &ldquo;blush roses, long tables&rdquo; into a decor plan and can look up
            venues for you.
          </dd>
        </div>
        <div className="rounded-2xl bg-muted/50 p-5 ring-1 ring-border/70">
          <dt className="font-medium">An image engine</dt>
          <dd className="mt-1 text-pretty text-muted-foreground">
            The image engine paints that plan into your own photos, keeping the walls, windows and light as they are.
          </dd>
        </div>
      </dl>

      <div className="mt-12 grid gap-12">
        <Step
          n={1}
          title="Your AI tools"
          done={toolsDone}
          intro={
            <>
              <p>One tool can be both. You need at least one of each to be ready; most people start with one they already pay for.</p>
              {setup.data && (
                <p data-testid="setup-summary" className="mt-2 font-medium text-foreground">
                  {summaryText(setup.data)}
                </p>
              )}
            </>
          }
        >
          {backends.isPending ? (
            <div className="grid gap-4 lg:grid-cols-2" aria-busy>
              {PROVIDERS.map((p) => (
                <Skeleton key={p.id} className="h-72 rounded-2xl" />
              ))}
            </div>
          ) : backends.error || !backends.data ? (
            <div className="rounded-2xl border border-dashed p-6">
              <p className="font-medium">Can&apos;t reach the local API</p>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {errorMessage(backends.error)} Start it with <code className="font-mono">make dev</code>, then check again.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void backends.refetch()} disabled={backends.isFetching}>
                <RefreshCwIcon aria-hidden className={cn(backends.isFetching && "animate-spin")} />
                Check again
              </Button>
            </div>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {PROVIDERS.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  brain={backends.data.brains.find((b) => b.id === p.id)}
                  engine={backends.data.engines.find((e) => e.id === p.id)}
                />
              ))}
            </div>
          )}
        </Step>

        <Step n={2} title="Choose your defaults" done={defaultsDone} intro="Only ready tools are listed. You can change these later.">
          {backends.data && settings.data ? (
            <DefaultsStep backends={backends.data} settings={settings.data} />
          ) : (
            <Skeleton className="h-48 rounded-2xl" />
          )}
        </Step>

        <Step n={3} title="Try it" done={false}>
          <TryItStep ready={Boolean(setup.data?.steps.try_it)} />
        </Step>

        <section aria-labelledby={advancedId} className="grid gap-6 border-t pt-10">
          <div>
            <h2 id={advancedId} className="font-display text-3xl sm:text-4xl">
              Advanced
            </h2>
            <p className="mt-2 max-w-prose text-pretty text-muted-foreground">
              Per-tool options live behind each card&apos;s Advanced button. This one is for the whole app.
            </p>
          </div>
          <PhoneAccess />
        </section>
      </div>
    </div>
  );
}
