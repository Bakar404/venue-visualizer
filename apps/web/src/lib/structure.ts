import type { Render } from "@/lib/types";

export type StructureLevel = "unverifiable" | "changed";

/** What the structure badge says: a label, its level (styling) and the plain-language reason. */
export type StructureVerdict = { level: StructureLevel; label: string; text: string };

const LABELS: Record<StructureLevel, string> = {
  unverifiable: "Couldn't verify",
  changed: "May have changed the room",
};

const UNVERIFIABLE_TEXT = "Lighting or decor changed a lot, so we couldn't confirm the room matches. Compare with the slider.";
const CHANGED_TEXT = "The walls, windows or fixtures look different from your photo. Compare with the slider before sharing, or regenerate.";

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
  if (method === "unverifiable" || /no consistent match|alignment failed|couldn'?t (align|match)|not enough/.test(r)) {
    return { level: "unverifiable", text: UNVERIFIABLE_TEXT };
  }
  return { level: "changed", text: CHANGED_TEXT };
}

/**
 * Turns the render QA into the badge's verdict. The backend's `structure_message` wins; older renders only have
 * `structure.method` / `structure.reason`, which are mapped to the same two levels.
 */
export function structureVerdict(qa: Render["qa"] | undefined): StructureVerdict {
  const message = qa?.structure_message;
  const mapped = fromReason(qa?.structure?.method, qa?.structure?.reason);
  if (message && typeof message === "object" && message.text?.trim()) {
    const level: StructureLevel = message.level === "unverifiable" ? "unverifiable" : "changed";
    return { level, label: LABELS[level], text: message.text.trim() };
  }
  if (typeof message === "string" && message.trim()) {
    return { level: mapped.level, label: LABELS[mapped.level], text: message.trim() };
  }
  return { ...mapped, label: LABELS[mapped.level] };
}
