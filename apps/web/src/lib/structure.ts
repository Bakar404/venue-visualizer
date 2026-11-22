import type { Render, StructureMessage } from "@/lib/types";

/** The badge's levels: the API's `structure_message.level` minus "ok", which shows no badge. */
export type StructureLevel = Exclude<StructureMessage["level"], "ok">;

/** What the structure badge says: a label, its level (styling) and the plain-language reason. */
export type StructureVerdict = { level: StructureLevel; label: string; text: string };

const LABELS: Record<StructureLevel, string> = {
  unverified: "Couldn't verify",
  changed: "May have changed the room",
};

const UNVERIFIED_TEXT = "Lighting or decor changed a lot, so we couldn't confirm the room matches. Compare with the slider.";
const CHANGED_TEXT = "The walls, windows or fixtures look different from your photo. Compare with the slider before sharing, or regenerate.";

/** Methods that never alignment-checked the render (services/api/qa_text.py). */
const UNCHECKED_METHODS = new Set(["unverifiable", "edges", "gray", "flat"]);

function fromReason(method: string | undefined, reason: string | null | undefined): { level: StructureLevel; text: string } {
  const r = (reason ?? "").toLowerCase();
  const share = r.match(/only shows (\d+)% of the protected area/);
  if (share) {
    return {
      level: "changed",
      text: `The render only keeps ${share[1]}% of the room's walls and fixtures, so parts may look different from your photo.`,
    };
  }
  if (r.includes("lost the room's structure")) return { level: "changed", text: CHANGED_TEXT };
  if (UNCHECKED_METHODS.has(method ?? "") || /no consistent match|alignment failed|couldn'?t (align|match)|not enough/.test(r)) {
    return { level: "unverified", text: UNVERIFIED_TEXT };
  }
  return { level: "changed", text: CHANGED_TEXT };
}

/**
 * Turns the render QA into the badge's verdict, or null when the backend says the room is ok. The backend's
 * `structure_message` wins; older renders only have `structure.method` / `structure.reason`, mapped to the same levels.
 */
export function structureVerdict(qa: Render["qa"] | undefined): StructureVerdict | null {
  const message = qa?.structure_message;
  if (message?.level === "ok") return null;
  if (message?.text?.trim()) {
    const level: StructureLevel = message.level === "unverified" ? "unverified" : "changed";
    return { level, label: LABELS[level], text: message.text.trim() };
  }
  const mapped = fromReason(qa?.structure?.method, qa?.structure?.reason);
  return { ...mapped, label: LABELS[mapped.level] };
}
