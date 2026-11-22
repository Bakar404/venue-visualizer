import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    </Providers>
  );
}
