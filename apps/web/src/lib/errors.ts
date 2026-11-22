export class ApiError extends Error {
  status: number;
  /** Seconds to wait before retrying, from a 429's `Retry-After` header. */
  retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/** `Retry-After` is either whole seconds or an HTTP date; returns seconds from now, or undefined if unusable. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}
