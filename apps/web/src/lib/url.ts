/**
 * Returns `value` if it is safe to use as a link href or image src for data that came from the web
 * (venue research, credits): absolute http(s) URLs, or root-relative paths on this origin. Anything
 * else (`javascript:`, `data:`, protocol-relative, malformed) returns null and must render as text or be dropped.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
