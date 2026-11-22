"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { isMockMode } from "@/lib/api";
import { useSetupStatus } from "@/lib/queries";

/** Pages that work before setup is finished. `/render/*` lives outside the site layout and never gets here. */
const OPEN_PATHS = ["/setup", "/pair"];

/**
 * First run: until `GET /api/system/setup` says complete, app routes go to `/setup`. If the API can't be reached the
 * page stays put and shows its own error, rather than bouncing.
 */
export function SetupGate() {
  const pathname = usePathname();
  const router = useRouter();
  const { data } = useSetupStatus();
  const open = OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (data && !data.complete && !open) router.replace("/setup");
  }, [data, open, router]);

  useEffect(() => {
    // The mock reads `?vvScenario=` when it loads; drop it so links and reloads don't reset the scenario again.
    if (!isMockMode) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("vvScenario")) return;
    url.searchParams.delete("vvScenario");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [pathname]);

  return null;
}
