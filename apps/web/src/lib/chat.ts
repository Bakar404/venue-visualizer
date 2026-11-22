import type { Ambiguity, ChatIntent, ChatResponse } from "@/lib/types";

const INTENTS = new Set<ChatIntent>(["edit", "render", "question", "none"]);

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Accepts both ambiguity shapes. Old servers sent plain strings that were either a question
 * ("Keep the amber uplighting, or switch to blue?") or a ready-to-send reply ("Use peonies").
 * A question becomes text with no chips; consecutive replies become the options of one item.
 */
export function normalizeAmbiguities(raw: unknown): Ambiguity[] {
  if (!Array.isArray(raw)) return [];
  const out: Ambiguity[] = [];
  let loose: Ambiguity | null = null;
  for (const item of raw) {
    if (typeof item === "string") {
      const s = item.trim();
      if (!s) continue;
      if (s.endsWith("?")) {
        out.push({ question: s, options: [] });
        loose = null;
      } else if (loose) {
        loose.options.push(s);
      } else {
        loose = { question: "", options: [s] };
        out.push(loose);
      }
      continue;
    }
    if (item && typeof item === "object") {
      const { question, options } = item as { question?: unknown; options?: unknown };
      // An option must never be the question itself, so it can be sent as the user's reply.
      const opts = Array.isArray(options) ? options.map(text).filter((o) => o && !o.endsWith("?")) : [];
      const q = text(question);
      if (q || opts.length) out.push({ question: q, options: [...new Set(opts)] });
      loose = null;
    }
  }
  return out;
}

/** Fills in fields an older server may not send yet (`intent`, `spec_changed`, `look_name`). */
export function normalizeChatResponse(raw: unknown): ChatResponse {
  const r = (raw ?? {}) as Partial<Record<keyof ChatResponse, unknown>>;
  const intent = typeof r.intent === "string" && INTENTS.has(r.intent as ChatIntent) ? (r.intent as ChatIntent) : "none";
  return {
    ...(r as ChatResponse),
    reply: typeof r.reply === "string" ? r.reply : "",
    warnings: Array.isArray(r.warnings) ? (r.warnings as ChatResponse["warnings"]) : [],
    rule_notes: Array.isArray(r.rule_notes) ? (r.rule_notes as string[]) : [],
    intent,
    spec_changed: r.spec_changed === true,
    look_name: text(r.look_name) || null,
    ambiguities: normalizeAmbiguities(r.ambiguities),
  };
}
