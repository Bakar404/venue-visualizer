import { expect, test } from "@playwright/test";

import { lanCode, mockReady, proof, settled } from "./helpers";

// FX-R11: the pairing code field keeps only digits, up to six, so a pasted "12 34 56" works; no native pattern that
// could disagree with it.

test("FX-R11: the pairing field normalises to six digits and accepts a pasted code with spaces", async ({ page }) => {
  await page.goto("/setup?vvScenario=demo");
  const code = await lanCode(page);
  await page.goto("/pair");
  await mockReady(page);
  const input = page.getByLabel("Pairing code");
  await expect(input).not.toHaveAttribute("pattern");

  await input.fill("1a2b3c4d5e6f7");
  await expect(input).toHaveValue("123456");

  const spaced = `${code.slice(0, 2)} ${code.slice(2, 4)} ${code.slice(4)}`;
  await input.fill("");
  await input.focus();
  // Inserts the whole string in one input event, like pasting it.
  await page.keyboard.insertText(spaced);
  await expect(input).toHaveValue(code);
  const pair = page.getByRole("button", { name: "Pair" });
  await expect(pair).toBeEnabled();
  await settled(page);
  await page.screenshot({ path: proof("FX-R11-pasted-code.png") });
  await pair.click();
  await expect(page.getByText("This phone is paired.")).toBeVisible();
});
