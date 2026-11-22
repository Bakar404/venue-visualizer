"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Controller, useForm, type FieldPath, type Resolver, type UseFormReturn } from "react-hook-form";

import { ChipsInput } from "@/components/chips-input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TIME_OF_DAY, WINDOWS_VIEW } from "@/lib/spec";
import { SPEC_LIMITS, specFormSchema as schema, type NumericSpecField } from "@/lib/spec-schema";
import type { DesignSpec, VenueRules } from "@/lib/types";
import { cn } from "@/lib/utils";

type Form = UseFormReturn<DesignSpec>;
type Path = FieldPath<DesignSpec>;

const OPTIONS = {
  event_type: [
    ["wedding", "Wedding"],
    ["gala", "Gala"],
    ["corporate", "Corporate"],
    ["birthday", "Birthday"],
    ["shower", "Shower"],
    ["other", "Other"],
  ],
  shape: [
    ["round", "Round"],
    ["banquet", "Banquet (long)"],
    ["square", "Square"],
    ["oval", "Oval"],
    ["cocktail", "Cocktail"],
    ["mixed", "Mixed"],
  ],
  length: [
    ["floor", "Floor length"],
    ["lap", "Lap length"],
    ["none", "No linens"],
  ],
  height: [
    ["none", "None"],
    ["low", "Low"],
    ["medium", "Medium"],
    ["tall", "Tall"],
    ["mixed", "Mixed heights"],
  ],
  candles: [
    ["none", "No candles"],
    ["flameless", "Flameless"],
    ["live", "Live flame"],
  ],
  ambient: [
    ["evening_warm", "Warm evening"],
    ["dim", "Dim and moody"],
    ["daylight", "Daylight"],
    ["colored", "Colored wash"],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [string, string]>>;

const asNullableNumber = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
const asNullableText = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

function errorFor(form: Form, name: Path) {
  return form.getFieldState(name, form.formState).error?.message;
}

function FieldShell({ form, name, label, children, className, hint }: { form: Form; name: Path; label: string; children: React.ReactNode; className?: string; hint?: string }) {
  const id = `spec-${name.replace(/\./g, "-")}`;
  const error = errorFor(form, name);
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-warning-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function TextField({ form, name, label, placeholder, className }: { form: Form; name: Path; label: string; placeholder?: string; className?: string }) {
  const id = `spec-${name.replace(/\./g, "-")}`;
  const error = errorFor(form, name);
  return (
    <FieldShell form={form} name={name} label={label} className={className}>
      <Input
        id={id}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...form.register(name, { setValueAs: asNullableText })}
      />
    </FieldShell>
  );
}

function NumberField({ form, name, label, className }: { form: Form; name: NumericSpecField; label: string; className?: string }) {
  const id = `spec-${name.replace(/\./g, "-")}`;
  const error = errorFor(form, name);
  const { min, max } = SPEC_LIMITS[name];
  return (
    <FieldShell form={form} name={name} label={label} className={className}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        className="tabular"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...form.register(name, { setValueAs: asNullableNumber })}
      />
    </FieldShell>
  );
}

function SelectField({ form, name, label, options, className }: { form: Form; name: Path; label: string; options: ReadonlyArray<readonly [string, string]>; className?: string }) {
  const id = `spec-${name.replace(/\./g, "-")}`;
  const items = options.map(([value, label]) => ({ value, label }));
  return (
    <FieldShell form={form} name={name} label={label} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select items={items} value={(field.value as string | undefined) ?? null} onValueChange={(v) => field.onChange(v)}>
            <SelectTrigger id={id} className="w-full" onBlur={field.onBlur}>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {items.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </FieldShell>
  );
}

function ChipsField({ form, name, label, placeholder, swatches, max, className }: { form: Form; name: Path; label: string; placeholder?: string; swatches?: boolean; max?: number; className?: string }) {
  const id = `spec-${name.replace(/\./g, "-")}`;
  return (
    <FieldShell form={form} name={name} label={label} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <ChipsInput
            id={id}
            label={label}
            value={(field.value as string[] | undefined) ?? []}
            onChange={field.onChange}
            placeholder={placeholder}
            swatches={swatches}
            max={max}
          />
        )}
      />
    </FieldShell>
  );
}

function SwitchField({ form, name, label, blocked }: { form: Form; name: Path; label: string; blocked?: boolean }) {
  const id = `spec-${name.replace(/\./g, "-")}`;
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className="flex items-center justify-between gap-3 py-1.5">
          <Label htmlFor={id} className="flex-col items-start gap-0 font-normal">
            {label}
            {blocked && <span className="text-xs text-warning-foreground">Not allowed at this venue</span>}
          </Label>
          <Switch id={id} checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(v)} />
        </div>
      )}
    />
  );
}

/** A segmented control built from native radios, so arrow keys and forms work as usual. */
function TimeOfDayField({ form }: { form: Form }) {
  return (
    <Controller
      control={form.control}
      name="scene.time_of_day"
      render={({ field }) => (
        <div role="radiogroup" aria-label="Time of day" className="grid grid-cols-5 gap-1 rounded-lg bg-muted p-1">
          {TIME_OF_DAY.map((o) => (
            <label
              key={o.value ?? "as_photo"}
              className={cn(
                "relative flex min-h-8 cursor-pointer items-center justify-center rounded-md px-1.5 text-center text-xs leading-tight font-medium text-muted-foreground select-none",
                "transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97]",
                "has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
                "[@media(hover:hover)]:hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name="spec-scene-time_of_day"
                value={o.value ?? ""}
                checked={(field.value ?? null) === o.value}
                onChange={() => field.onChange(o.value)}
                onBlur={field.onBlur}
                className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-md opacity-0"
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    />
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="group flex w-full items-center justify-between py-3 text-left text-sm font-medium">
        {title}
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted className="pb-4 data-closed:hidden">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Every DesignSpec field. Valid edits are reported through `onChange` straight away; outside
 * updates to `spec` (chat replies, loading a Look) reset the form without echoing back.
 */
export function SpecForm({ spec, onChange, rules }: { spec: DesignSpec; onChange: (spec: DesignSpec) => void; rules: VenueRules | undefined }) {
  const form = useForm<DesignSpec>({
    defaultValues: spec,
    resolver: zodResolver(schema) as unknown as Resolver<DesignSpec>,
    mode: "onChange",
  });
  const lastSeen = useRef(JSON.stringify(spec));
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const json = JSON.stringify(spec);
    if (json === lastSeen.current) return;
    lastSeen.current = json;
    form.reset(spec);
  }, [spec, form]);

  useEffect(() => {
    return form.subscribe({
      formState: { values: true },
      callback: ({ values }) => {
        const parsed = schema.safeParse(values);
        if (!parsed.success) return;
        const json = JSON.stringify(values);
        if (json === lastSeen.current) return;
        lastSeen.current = json;
        onChangeRef.current(structuredClone(values) as DesignSpec);
      },
    });
  }, [form]);

  const blocked = (key: keyof VenueRules) => rules?.[key] === false;

  return (
    <form onSubmit={(e) => e.preventDefault()} aria-label="Plan details" className="text-sm">
      <Section title="Event and guests" defaultOpen>
        <div className="grid grid-cols-2 gap-3">
          <SelectField form={form} name="event_type" label="Event" options={OPTIONS.event_type} />
          <NumberField form={form} name="guest_count" label="Guests" />
          <ChipsField form={form} name="palette" label="Palette" placeholder="blush, gold" swatches max={8} className="col-span-2" />
        </div>
      </Section>
      <Section title="Tables and linens" defaultOpen>
        <div className="grid grid-cols-2 gap-3">
          <NumberField form={form} name="tables.count" label="Tables" />
          <SelectField form={form} name="tables.shape" label="Shape" options={OPTIONS.shape} />
          <NumberField form={form} name="tables.size_in" label="Size (in)" />
          <NumberField form={form} name="tables.seats" label="Seats each" />
          <TextField form={form} name="linens.color" label="Linen color" />
          <SelectField form={form} name="linens.length" label="Linen length" options={OPTIONS.length} />
          <TextField form={form} name="linens.pattern" label="Pattern" placeholder="none" />
          <TextField form={form} name="linens.runner" label="Runner" placeholder="none" />
          <TextField form={form} name="napkins.color" label="Napkin color" />
          <TextField form={form} name="napkins.fold" label="Napkin fold" placeholder="simple" />
        </div>
      </Section>
      <Section title="Chairs">
        <div className="grid grid-cols-2 gap-3">
          <TextField form={form} name="chairs.style" label="Style" placeholder="chiavari" />
          <TextField form={form} name="chairs.color" label="Color" />
          <TextField form={form} name="chairs.cushion" label="Cushion" placeholder="none" />
          <TextField form={form} name="chairs.sash" label="Sash" placeholder="none" />
        </div>
      </Section>
      <Section title="Centerpieces">
        <div className="grid grid-cols-2 gap-3">
          <SelectField form={form} name="centerpieces.height" label="Height" options={OPTIONS.height} />
          <FieldShell form={form} name="centerpieces.candles" label="Candles" hint={blocked("live_candles") && spec.centerpieces.candles === "live" ? "Live flame isn't allowed here" : undefined}>
            <Controller
              control={form.control}
              name="centerpieces.candles"
              render={({ field }) => {
                const items = OPTIONS.candles.map(([value, label]) => ({ value, label }));
                return (
                  <Select items={items} value={field.value ?? null} onValueChange={(v) => field.onChange(v)}>
                    <SelectTrigger id="spec-centerpieces-candles" className="w-full">
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                          {o.value === "live" && blocked("live_candles") && <span className="text-xs text-muted-foreground">Not allowed here</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              }}
            />
          </FieldShell>
          <ChipsField form={form} name="centerpieces.flowers" label="Flowers" placeholder="garden roses" className="col-span-2" />
          <ChipsField form={form} name="centerpieces.colors" label="Flower colors" placeholder="ivory, blush" swatches className="col-span-2" />
          <TextField form={form} name="centerpieces.greenery" label="Greenery" />
          <TextField form={form} name="centerpieces.container" label="Container" />
        </div>
      </Section>
      <Section title="Lighting">
        <div className="grid grid-cols-2 gap-3">
          <TextField form={form} name="lighting.uplighting" label="Uplighting" placeholder="none" />
          <SelectField form={form} name="lighting.ambient" label="Ambient" options={OPTIONS.ambient} />
        </div>
        <div className="mt-2">
          <SwitchField form={form} name="lighting.string_lights" label="String lights" />
          <SwitchField form={form} name="lighting.pin_spots" label="Pin spots on tables" />
        </div>
      </Section>
      <Section title="Time & windows">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground" aria-hidden>
              Time of day
            </span>
            <TimeOfDayField form={form} />
          </div>
          <SelectField form={form} name="scene.windows" label="Windows" options={WINDOWS_VIEW.map((o) => [o.value, o.label] as const)} />
        </div>
      </Section>
      <Section title="Extras, effects and install">
        <ChipsField form={form} name="extras" label="Extras" placeholder="dance floor, flower wall" />
        <div className="mt-3">
          <SwitchField form={form} name="effects.fog" label="Fog or haze" blocked={blocked("fog")} />
          <SwitchField form={form} name="effects.confetti" label="Confetti" blocked={blocked("confetti")} />
          <SwitchField form={form} name="effects.sparklers" label="Sparklers" blocked={blocked("sparklers")} />
          <SwitchField form={form} name="install.ceiling_draping" label="Ceiling draping" blocked={blocked("ceiling_draping")} />
          <SwitchField form={form} name="install.uses_adhesives" label="Uses tape or adhesives" blocked={blocked("adhesives")} />
          <SwitchField form={form} name="install.uses_nails" label="Uses nails or screws" blocked={blocked("nails")} />
        </div>
      </Section>
      <Section title="Notes">
        <Label htmlFor="spec-notes" className="sr-only">
          Notes
        </Label>
        <Textarea id="spec-notes" rows={3} placeholder="Anything the engine should know" {...form.register("notes", { setValueAs: asNullableText })} />
      </Section>
    </form>
  );
}
