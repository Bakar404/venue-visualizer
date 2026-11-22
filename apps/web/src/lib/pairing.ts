import { ApiError } from "@/lib/errors";

/** The API's LAN guard answers 403 with this before a phone is paired (services/api/lan.py). */
const PAIR_FIRST = "Pair this device";

export function needsPairing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.message.startsWith(PAIR_FIRST);
}

/** A canonical same-origin path to return to after pairing, or home. */
export function safeNext(next: string | null | undefined, origin: string): string {
  if (!next?.startsWith("/") || next.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(next)) return "/";
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return "/";
  }
  const { pathname, search, hash } = url;
  if (url.origin !== origin || pathname.startsWith("//") || pathname === "/pair" || pathname.startsWith("/pair/")) return "/";
  return pathname + search + hash;
}

/** `/pair?next=<where this page is>`. */
export function pairUrl(location: Pick<Location, "origin" | "pathname" | "search">): string {
  const path = location.pathname + location.search;
  const next = safeNext(path, location.origin);
  return next === "/" && path !== "/" ? "/pair" : `/pair?next=${encodeURIComponent(next)}`;
}
