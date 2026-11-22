"use client";

import { ChipsInput } from "@/components/chips-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RULE_KEYS, RULE_LABELS, isAllowed } from "@/lib/spec";
import type { VenueRules } from "@/lib/types";

/** House rules editor. Switch on means the venue allows it. */
export function RulesFields({ value, onChange, idPrefix }: { value: VenueRules; onChange: (next: VenueRules) => void; idPrefix: string }) {
  return (
    <div className="grid gap-5">
      <fieldset>
        <legend className="text-sm font-medium">What the venue allows</legend>
        <p className="text-sm text-muted-foreground">Turn off anything the venue doesn&apos;t permit. Plans are adjusted to fit.</p>
        <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
          {RULE_KEYS.map((key) => {
            const id = `${idPrefix}-${key}`;
            return (
              <li key={key} className="flex items-center justify-between gap-4 border-b py-2.5 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                <Label htmlFor={id} className="flex-col items-start gap-0 font-normal">
                  <span>{RULE_LABELS[key].label}</span>
                  <span className="text-xs text-muted-foreground">{RULE_LABELS[key].hint}</span>
                </Label>
                <Switch id={id} checked={isAllowed(value, key)} onCheckedChange={(checked) => onChange({ ...value, [key]: checked })} />
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-provided`}>Provided by the venue</Label>
        <ChipsInput
          id={`${idPrefix}-provided`}
          label="Add an item the venue provides"
          value={value.provided_items ?? []}
          onChange={(provided_items) => onChange({ ...value, provided_items })}
          placeholder="e.g. ivory linens, gold chiavari chairs"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <Textarea
          id={`${idPrefix}-notes`}
          value={value.notes ?? ""}
          onChange={(e) => onChange({ ...value, notes: e.target.value || null })}
          placeholder="Load-in times, coordinator contact, anything else to keep in mind"
          rows={3}
        />
      </div>
    </div>
  );
}
