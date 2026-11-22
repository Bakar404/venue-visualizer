import { ApiError } from "@/lib/errors";

/** The API's LAN guard answers 403 with this before a phone is paired (services/api/lan.py). */
const PAIR_FIRST = "Pair this device";

export function needsPairing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.message.startsWith(PAIR_FIRST);
}

/** A same-site path to return to after pairing, or null. Rejects `//host` and `/\host`, which browsers treat as other sites. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (next === "/pair" || next.startsWith("/pair?") || next.startsWith("/pair/")) return null;
  return next;
}

/** `/pair?next=<where this page is>`. */
export function pairUrl(location: Pick<Location, "pathname" | "search">): string {
  const next = safeNext(location.pathname + location.search);
  return next ? `/pair?next=${encodeURIComponent(next)}` : "/pair";
}
