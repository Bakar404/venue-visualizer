"use client";

import { ShieldAlertIcon } from "lucide-react";
import { useId } from "react";

import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api";
import { useLanInfo, useSettings, useUpdateSettings } from "@/lib/queries";

/** Setup → Advanced → Open on your phone (docs/onboarding-and-mobile.md, "Open on your phone"). */
export function PhoneAccess() {
  const headingId = useId();
  const switchId = useId();
  const settings = useSettings();
  const update = useUpdateSettings();
  const enabled = settings.data?.lan.enabled ?? false;
  const lan = useLanInfo(enabled);
  const info = lan.data?.enabled ? lan.data : null;

  return (
    <section aria-labelledby={headingId} className="grid gap-5 rounded-2xl border bg-card p-5 sm:p-6">
      <div>
        <h3 id={headingId} className="text-lg font-medium">
          Open on your phone
        </h3>
        <p className="mt-1 max-w-prose text-pretty text-muted-foreground">
          Take photos and walk the room with your phone while this computer does the work. Your phone needs to be on the
          same Wi-Fi as this computer.
        </p>
      </div>
      <div className="flex gap-3 rounded-xl border border-warning-border bg-warning p-4 text-sm text-warning-foreground">
        <ShieldAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className="text-pretty">
          While this is on, anyone on the same Wi-Fi can reach this page. Each phone must first type the one-time pairing code
          shown here, but only turn it on at home or in the office, never on café or hotel Wi-Fi.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={switchId} id={`${switchId}-label`} className="text-base leading-snug">
          Allow phones on this Wi-Fi
        </Label>
        <Switch
          id={switchId}
          aria-labelledby={`${switchId}-label`}
          checked={enabled}
          disabled={!settings.data || update.isPending}
          onCheckedChange={(v) => update.mutate({ lan: { enabled: v } })}
        />
      </div>
      {update.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(update.error)}
        </p>
      )}
      {enabled &&
        (lan.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : lan.isError ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t get this computer&apos;s address: {errorMessage(lan.error)}</p>
        ) : info ? (
          <div className="grid items-center gap-5 sm:grid-cols-[auto_1fr]">
            {info.qr_svg && (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(info.qr_svg)}`}
                alt={`QR code for ${info.url}`}
                className="size-40 rounded-lg bg-white p-1 ring-1 ring-border"
              />
            )}
            <ol className="grid gap-3 text-sm">
              <li>
                <span className="text-muted-foreground">1. Scan the code with your phone&apos;s camera, or type</span>
                <span data-testid="lan-url" className="mt-1 block font-mono text-base break-all">
                  {info.url}
                </span>
              </li>
              {info.pairing_code && (
                <li>
                  <span className="text-muted-foreground">2. When the phone asks, enter this pairing code</span>
                  <span data-testid="pairing-code" className="mt-1 block font-mono text-2xl tracking-[0.2em] tabular-nums">
                    {info.pairing_code.slice(0, 3)} {info.pairing_code.slice(3)}
                  </span>
                  <span className="mt-1 block text-muted-foreground">It works once; each phone gets a new code.</span>
                </li>
              )}
            </ol>
          </div>
        ) : null)}
    </section>
  );
}
