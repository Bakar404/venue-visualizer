import { expect, test, type Page } from "@playwright/test";

import { proof, settled } from "./helpers";

// FX-R8: copy works without navigator.clipboard (plain-http LAN pages) by falling back to execCommand("copy"), and
// always says whether it worked. Sign-in shows only the command as copyable; what to do next is plain text.

const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** No async clipboard (like http://192.168.x.x); execCommand("copy") records the selection, or fails when told to. */
async function legacyClipboard(page: Page, works: boolean) {
  await page.addInitScript((ok) => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    document.execCommand = (command: string) => {
      if (command !== "copy" || !ok) return false;
      w.__copied.push(String(document.getSelection() ?? "") || (document.activeElement as HTMLTextAreaElement | null)?.value || "");
      return true;
    };
  }, works);
}

test("FX-R8: copy falls back to execCommand and says Copied", async ({ page }) => {
  await legacyClipboard(page, true);
  await page.goto("/setup?vvScenario=fresh");
  const claude = card(page, "Claude Code");
  await claude.getByRole("button", { name: "Copy install command" }).click();
  await expect(claude.getByRole("button", { name: "Copied install command" })).toBeVisible();
  const install = (await claude.getByTestId("install-command").textContent())?.trim();
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([install]);
});

test("FX-R8: when copying is impossible the button says so", async ({ page }) => {
  await legacyClipboard(page, false);
  await page.goto("/setup?vvScenario=fresh");
  const claude = card(page, "Claude Code");
  await claude.getByRole("button", { name: "Copy install command" }).click();
  await expect(claude.getByRole("button", { name: "Couldn't copy install command" })).toBeVisible();
  await expect(claude.getByRole("status")).toContainText("Couldn't copy. Select the command and copy it yourself.");
});

test("FX-R8: sign-in is a command to copy plus a plain-text next step", async ({ page }) => {
  await page.goto("/setup?vvScenario=fresh");
  const claude = card(page, "Claude Code");
  await expect(claude.getByTestId("sign-in-command")).toHaveText("claude");
  await expect(claude.getByTestId("sign-in-note")).toHaveText("then follow the sign-in prompt");
  const copilot = card(page, "GitHub Copilot");
  await expect(copilot.getByTestId("sign-in-command")).toHaveText("copilot");
  await expect(copilot.getByTestId("sign-in-note")).toHaveText("then type /login");
  const codex = card(page, "Codex");
  await expect(codex.getByTestId("sign-in-command")).toHaveText("codex login");
  await expect(codex.getByTestId("sign-in-note")).toHaveCount(0);
  await expect(codex.getByTestId("image-setup-command")).toHaveText("codex features enable image_generation");
  await settled(page);
  await claude.screenshot({ path: proof("FX-R8-sign-in.png") });
});
