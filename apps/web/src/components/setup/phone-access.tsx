"use client";

import { RefreshCwIcon, ShieldAlertIcon, SmartphoneIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { CopyCommand } from "@/components/setup/copy-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useForgetAllLanDevices, useForgetLanDevice, useLanDevices, useLanInfo } from "@/lib/queries";
import { PAIRING_CODE_MINUTES, type LanDevice } from "@/lib/types";
import { cn } from "@/lib/utils";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Setup → Advanced → Open on your phone (docs/onboarding-and-mobile.md, "Open on your phone"). Phone access can't be
 * switched on from the browser: it's on only when the app was started with `make dev-lan`.
 */
export function PhoneAccess() {
  const headingId = useId();
  const lan = useLanInfo();
  const info = lan.data?.enabled ? lan.data : null;
  const devices = useLanDevices(Boolean(info));

  // A phone that paired since this code was fetched used it up: show the next one.
  const newestPairing = devices.data?.reduce((max, d) => Math.max(max, Date.parse(d.paired_at)), 0) ?? 0;
  const { refetch } = lan;
  const codeFetchedAt = lan.dataUpdatedAt;
  useEffect(() => {
    if (info && newestPairing > codeFetchedAt) void refetch();
  }, [info, newestPairing, codeFetchedAt, refetch]);

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
          When phone access is on, anyone on the same Wi-Fi could try to connect to this computer. That&apos;s why each
          phone must first type a pairing code shown here. Only use it at home or in the office, never on café or hotel
          Wi-Fi.
        </p>
      </div>

      {lan.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : lan.isError ? (
        <p role="alert" className="text-sm text-muted-foreground">
          Couldn&apos;t check phone access: {errorMessage(lan.error)}
        </p>
      ) : info ? (
        <div className="grid gap-4">
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
                  <span
                    data-testid="pairing-code"
                    aria-busy={lan.isFetching || undefined}
                    className={cn("mt-1 block font-mono text-2xl tracking-[0.2em] tabular-nums", lan.isFetching && "opacity-50")}
                  >
                    {info.pairing_code.slice(0, 3)} {info.pairing_code.slice(3)}
                  </span>
                  <span className="mt-1 block text-pretty text-muted-foreground">
                    It works once and expires after {PAIRING_CODE_MINUTES} minutes. Each phone needs its own code; a new
                    code replaces this one.
                  </span>
                  <Button type="button" variant="outline" size="sm" className="mt-2" disabled={lan.isFetching} onClick={() => void refetch()}>
                    <RefreshCwIcon aria-hidden className={cn(lan.isFetching && "animate-spin")} />
                    New code
                  </Button>
                </li>
              )}
            </ol>
          </div>
          <p className="text-sm text-pretty text-muted-foreground">
            To turn phone access off, quit the app and start it again with <code className="font-mono">make dev</code>.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-pretty">
            <span className="font-medium">Phone access is off.</span> To turn it on, quit the app (press Ctrl+C in the
            Terminal window where it&apos;s running) and start it again with this command. Then come back here for the
            QR code and pairing code.
          </p>
          <CopyCommand label="Start with phone access" command="make dev-lan" name="start command" testId="lan-command" />
        </div>
      )}

      <PairedPhones devices={devices.data} loading={devices.isPending} error={devices.isError ? devices.error : null} />
    </section>
  );
}

function PairedPhones({ devices, loading, error }: { devices: LanDevice[] | undefined; loading: boolean; error: Error | null }) {
  const headingId = useId();
  const forget = useForgetLanDevice();
  const forgetAll = useForgetAllLanDevices();
  const [confirming, setConfirming] = useState(false);
  const failure = forget.error ?? forgetAll.error;

  return (
    <section aria-labelledby={headingId} className="grid gap-3 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h4 id={headingId} className="font-medium">
          Paired phones
        </h4>
        {devices && devices.length > 0 && (
          <Button type="button" variant="outline" size="sm" disabled={forgetAll.isPending} onClick={() => setConfirming(true)}>
            Forget all phones
          </Button>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : error ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t list paired phones: {errorMessage(error)}</p>
      ) : !devices || devices.length === 0 ? (
        <p className="text-sm text-pretty text-muted-foreground">No phones are paired with this computer.</p>
      ) : (
        <ul aria-labelledby={headingId} className="grid divide-y rounded-xl border">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
              <SmartphoneIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium break-words">{d.label}</p>
                <p className="text-muted-foreground">
                  Paired {when(d.paired_at)} · Last seen {when(d.last_seen)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Forget ${d.label}`}
                disabled={forget.isPending && forget.variables === d.id}
                onClick={() => forget.mutate(d.id)}
              >
                Forget
              </Button>
            </li>
          ))}
        </ul>
      )}
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(failure)}
        </p>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogTitle>Forget all phones?</AlertDialogTitle>
          <AlertDialogDescription>
            Every paired phone is disconnected and will need a new pairing code from this page to connect again.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                forgetAll.mutate();
              }}
            >
              Forget all
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
