// @vitest-environment jsdom
// FX-R8: copying works without `navigator.clipboard` (plain-HTTP LAN pages), and reports failure honestly.
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "@/lib/clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "execCommand");
});

function stubExecCommand(result: boolean) {
  const copied: string[] = [];
  const exec = vi.fn((command: string) => {
    const el = document.activeElement as HTMLTextAreaElement | null;
    if (command === "copy" && el?.tagName === "TEXTAREA") copied.push(el.value.slice(el.selectionStart, el.selectionEnd));
    return result;
  });
  Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
  return { exec, copied };
}

describe("copyText", () => {
  it("uses the async clipboard when there is one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("make dev")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("make dev");
  });

  it("falls back to a hidden textarea and execCommand('copy') when navigator.clipboard is missing", async () => {
    vi.stubGlobal("navigator", {});
    const { exec, copied } = stubExecCommand(true);
    await expect(copyText("claude")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(copied).toEqual(["claude"]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when the async clipboard refuses", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const { copied } = stubExecCommand(true);
    await expect(copyText("copilot")).resolves.toBe(true);
    expect(copied).toEqual(["copilot"]);
  });

  it("reports failure when nothing can copy", async () => {
    vi.stubGlobal("navigator", {});
    stubExecCommand(false);
    await expect(copyText("kimi")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
