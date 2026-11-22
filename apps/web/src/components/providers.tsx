"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import { JobWatcher } from "@/lib/jobs";
import { needsPairing, pairUrl } from "@/lib/pairing";
import { PreferencesProvider } from "@/lib/preferences";

/** An unpaired phone gets 403 "Pair this device…" from every endpoint; send it to /pair and back here afterwards. */
function sendToPairing(error: unknown) {
  if (!needsPairing(error) || window.location.pathname === "/pair") return;
  window.location.replace(pairUrl(window.location));
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: sendToPairing }),
        mutationCache: new MutationCache({ onError: sendToPairing }),
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
          <TooltipProvider delay={250}>
            <PreferencesProvider>
              {children}
              <CommandPalette />
              <JobWatcher />
            </PreferencesProvider>
            <Toaster position="bottom-right" closeButton />
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
