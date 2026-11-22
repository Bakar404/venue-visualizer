/** JSON.stringify with object keys sorted, so equal values always produce the same string. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/**
 * Drops null/undefined object keys at every depth, mirroring the API's `exclude_none` (a Look's spec comes back
 * without its None fields). A nested object left with no keys (e.g. a form section whose fields are all unset) is
 * dropped too. Arrays keep their length, so `[]` stays `[]`.
 */
export function withoutNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutNulls) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, withoutNulls(v)] as const)
        .filter(([, v]) => v !== null && v !== undefined && !isEmptyObject(v)),
    ) as T;
  }
  return value;
}

function isEmptyObject(v: unknown) {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}
