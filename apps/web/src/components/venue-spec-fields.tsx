"use client";

import { ChipsInput } from "@/components/chips-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { VenueSpec } from "@/lib/types";

const text: Array<{ key: "style" | "walls" | "floor" | "windows"; label: string; placeholder: string }> = [
  { key: "style", label: "Style", placeholder: "classic ballroom, rustic barn, modern loft" },
  { key: "walls", label: "Walls", placeholder: "ivory panelled walls with gilt moulding" },
  { key: "floor", label: "Floor", placeholder: "herringbone oak" },
  { key: "windows", label: "Windows", placeholder: "three tall arched windows on the long wall" },
];

const dims: Array<{ key: "length_ft" | "width_ft" | "ceiling_ft"; label: string }> = [
  { key: "length_ft", label: "Length (ft)" },
  { key: "width_ft", label: "Width (ft)" },
  { key: "ceiling_ft", label: "Ceiling (ft)" },
];

function toNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Controlled editor for an empty room's description (VenueSpec). */
export function VenueSpecFields({ value, onChange, idPrefix }: { value: VenueSpec; onChange: (next: VenueSpec) => void; idPrefix: string }) {
  const set = <K extends keyof VenueSpec>(key: K, v: VenueSpec[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-style`}>Style</Label>
        <Input id={`${idPrefix}-style`} value={value.style ?? ""} onChange={(e) => set("style", e.target.value || null)} placeholder={text[0].placeholder} />
      </div>
      <fieldset className="grid grid-cols-3 gap-3">
        <legend className="sr-only">Dimensions</legend>
        {dims.map((d) => (
          <div key={d.key} className="grid gap-2">
            <Label htmlFor={`${idPrefix}-${d.key}`} className="text-xs sm:text-sm">
              {d.label}
            </Label>
            <Input
              id={`${idPrefix}-${d.key}`}
              type="number"
              inputMode="decimal"
              min={1}
              className="tabular"
              value={value[d.key] ?? ""}
              onChange={(e) => set(d.key, toNumber(e.target.value))}
            />
          </div>
        ))}
      </fieldset>
      {text.slice(1).map((f) => (
        <div key={f.key} className="grid gap-2">
          <Label htmlFor={`${idPrefix}-${f.key}`}>{f.label}</Label>
          <Input id={`${idPrefix}-${f.key}`} value={value[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value || null)} placeholder={f.placeholder} />
        </div>
      ))}
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-fixtures`}>Fixtures</Label>
        <ChipsInput
          id={`${idPrefix}-fixtures`}
          label="Add a fixture"
          value={value.fixtures ?? []}
          onChange={(fixtures) => set("fixtures", fixtures)}
          placeholder="two crystal chandeliers, exposed beams"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-notes`}>Anything else</Label>
        <Textarea id={`${idPrefix}-notes`} rows={2} value={value.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} />
      </div>
    </div>
  );
}

export function hasVenueSpec(spec: VenueSpec | null | undefined) {
  return Boolean(spec && Object.values(spec).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "")));
}
