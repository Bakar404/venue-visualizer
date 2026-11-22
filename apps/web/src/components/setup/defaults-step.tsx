"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { PROVIDERS } from "@/components/setup/providers";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api";
import { isUsable } from "@/lib/backends";
import { usePreferences } from "@/lib/preferences";
import { qk, useUpdateSettings } from "@/lib/queries";
import type { Backends, BackendStatus, Settings } from "@/lib/types";
import { cn } from "@/lib/utils";

const brainName = (b: BackendStatus) => PROVIDERS.find((p) => p.id === b.id)?.name ?? b.label;

function Options({
  label,
  description,
  options,
  value,
  recommended,
  onChange,
  nameOf,
}: {
  label: string;
  description: string;
  options: BackendStatus[];
  value: string | null;
  recommended: string | null;
  onChange: (id: string) => void;
  nameOf: (b: BackendStatus) => string;
}) {
  const id = useId();
  return (
    <div className="grid gap-3">
      <div>
        <h3 id={id} className="font-medium">
          {label}
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {options.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Nothing is ready yet. Get at least one ready in step 1, then press Check again.
        </p>
      ) : (
        <RadioGroup aria-labelledby={id} value={value} onValueChange={(v) => onChange(v as string)} className="grid gap-2 sm:grid-cols-2">
          {options.map((b) => (
            <Radio.Root
              key={b.id}
              value={b.id}
              aria-labelledby={`${id}-${b.id}`}
              aria-describedby={`${id}-${b.id}-note`}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-[border-color,background-color,box-shadow] duration-150 ease-out",
                "hover:border-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-brand/60 data-checked:bg-brand-soft",
                "active:scale-[0.99] motion-safe:transition-[border-color,background-color,box-shadow,scale]",
              )}
            >
              <span
                aria-hidden
                className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-foreground/30 bg-background in-data-checked:border-brand"
              >
                <Radio.Indicator className="size-2.5 rounded-full bg-brand" />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span id={`${id}-${b.id}`} className="font-medium">
                    {nameOf(b)}
                  </span>
                  {b.id === recommended && (
                    <span className="rounded-full bg-brand px-2 py-px text-[0.8rem] font-medium text-brand-foreground">Recommended</span>
                  )}
                </span>
                <span id={`${id}-${b.id}-note`} className="mt-1 block text-sm text-pretty text-muted-foreground">
                  {b.cost_note ?? b.caps?.cost_note ?? b.detail}
                </span>
              </span>
            </Radio.Root>
          ))}
        </RadioGroup>
      )}
    </div>
  );
}

/** Step 2: pick from the ready tools (the recommended one preselected) and whether the brain may search the web. */
export function DefaultsStep({ backends, settings }: { backends: Backends; settings: Settings }) {
  const qc = useQueryClient();
  const { setBrain, setEngine } = usePreferences();
  const update = useUpdateSettings();
  const switchId = useId();
  const brains = backends.brains.filter(isUsable);
  const engines = backends.engines.filter(isUsable);
  const [brainChoice, setBrainChoice] = useState<string | null>(null);
  const [engineChoice, setEngineChoice] = useState<string | null>(null);
  const [web, setWeb] = useState<boolean | null>(null);

  const recommendedBrain = backends.defaults.brain && brains.some((b) => b.id === backends.defaults.brain) ? backends.defaults.brain : (brains[0]?.id ?? null);
  const recommendedEngine = backends.defaults.engine;
  const brain = brains.some((b) => b.id === brainChoice) ? brainChoice : recommendedBrain;
  const engine = engines.some((e) => e.id === engineChoice) ? engineChoice : recommendedEngine;
  const allowWeb = web ?? settings.allow_web_research;
  const done = Boolean(settings.setup_completed_at);

  const finish = () => {
    if (!brain || !engine) return;
    update.mutate(
      {
        default_brain: brain,
        default_engine: engine,
        allow_web_research: allowWeb,
        setup_completed_at: settings.setup_completed_at ?? new Date().toISOString(),
      },
      {
        onSuccess: () => {
          // This browser's own picks follow the new defaults too.
          setBrain(brain);
          setEngine(engine);
          void qc.invalidateQueries({ queryKey: qk.backends });
        },
      },
    );
  };

  return (
    <div className="grid gap-8">
      <Options
        label="Default brain"
        description="The AI you chat with. You can switch in the Studio at any time."
        options={brains}
        value={brain}
        recommended={recommendedBrain}
        onChange={setBrainChoice}
        nameOf={brainName}
      />
      <Options
        label="Default image engine"
        description="Paints the decor into your photos. Each render uses it once per photo."
        options={engines}
        value={engine}
        recommended={recommendedEngine}
        onChange={setEngineChoice}
        nameOf={(e) => e.label}
      />
      <div className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4">
        <div>
          <Label htmlFor={switchId} id={`${switchId}-label`} className="text-base leading-snug">
            Allow web research
          </Label>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">
            Lets the brain look up venues, floor plans and photos online when you ask it to. Turn off to keep everything on
            this computer.
          </p>
        </div>
        <Switch id={switchId} aria-labelledby={`${switchId}-label`} checked={allowWeb} onCheckedChange={(v) => setWeb(v)} className="mt-0.5" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" size="lg" className="h-11 px-5" disabled={!brain || !engine || update.isPending} onClick={finish}>
          {done ? "Save defaults" : "Finish setup"}
        </Button>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {update.isError
            ? errorMessage(update.error)
            : !brain || !engine
              ? "You need one ready brain and one ready image engine first."
              : update.isSuccess
                ? "Saved."
                : ""}
        </p>
      </div>
    </div>
  );
}
