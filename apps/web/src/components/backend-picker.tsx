"use client";

import { StatusDot } from "@/components/backend-status";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BackendStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  kind: "engine" | "brain";
  options: BackendStatus[] | undefined;
  value: string;
  onChange: (id: string) => void;
  className?: string;
  /** Extra availability filter, e.g. engines that can generate a base image. */
  usable?: (b: BackendStatus) => boolean;
  unusableReason?: string;
};

/** Engine or brain choice. Unavailable backends stay listed, disabled, with the API's `detail` as a tooltip. */
export function BackendPicker({ kind, options, value, onChange, className, usable, unusableReason }: Props) {
  const items = (options ?? []).map((b) => ({ value: b.id, label: b.label }));
  if (!items.some((i) => i.value === value)) items.push({ value, label: value });
  const label = kind === "engine" ? "Engine" : "Brain";

  return (
    <Select items={items} value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger size="sm" aria-label={label} className={cn("min-w-36", className)}>
        <span className="text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="min-w-64">
        <SelectGroup>
          <SelectLabel>{kind === "engine" ? "Photo engines on this machine" : "Brains on this machine"}</SelectLabel>
          {(options ?? []).map((b) => {
            const disabled = !b.available || (usable ? !usable(b) : false);
            const reason = !b.available ? (b.detail ?? "Not detected on this machine.") : unusableReason;
            if (!disabled) {
              return (
                <SelectItem key={b.id} value={b.id}>
                  <StatusDot backend={b} />
                  {b.label}
                  {b.caps?.typical_seconds ? <span className="text-xs text-muted-foreground tabular">~{b.caps.typical_seconds}s</span> : null}
                </SelectItem>
              );
            }
            return (
              <Tooltip key={b.id}>
                <TooltipTrigger
                  render={<SelectItem value={b.id} disabled className="data-disabled:pointer-events-auto" />}
                >
                  <StatusDot backend={b} />
                  {b.label}
                  <span className="sr-only">, unavailable: {reason}</span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-60">
                  {reason}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
