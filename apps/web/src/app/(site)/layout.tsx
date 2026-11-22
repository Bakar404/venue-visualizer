import { Suspense } from "react";

import { Providers } from "@/components/providers";
import { SetupGate } from "@/components/setup-gate";
import { SiteHeader } from "@/components/site-header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Suspense>
        <SetupGate />
      </Suspense>
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        {children}
      </main>
    </Providers>
  );
}
