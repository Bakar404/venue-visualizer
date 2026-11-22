import { expect, test } from "@playwright/test";

import { holdMock, lanCode, mockReady, proof, settled } from "./helpers";

// FX-R5: /pair counts down a 429's Retry-After with Pair disabled, doesn't drop a request in flight when the code is
// edited, and once paired stays paired.

test("FX-R5: too many attempts disables Pair until Retry-After passes", async ({ page }) => {
  await page.clock.install();
  await page.goto("/setup?vvScenario=demo");
  const code = await lanCode(page);
  await page.goto("/pair");
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.lockPairing(20));
  await page.getByLabel("Pairing code").fill(code);
  const pair = page.getByRole("button", { name: "Pair" });
  await pair.click();
  const wait = page.getByTestId("pair-retry");
  await expect(wait).toHaveText(/Too many attempts\. Try again in (20|19) s\./);
  await expect(pair).toBeDisabled();
  await settled(page);
  await page.screenshot({ path: proof("FX-R5-retry-after.png") });
  await page.clock.fastForward(8_000);
  await expect(wait).toHaveText(/Try again in (12|11) s/);
  await expect(pair).toBeDisabled();
  await page.clock.fastForward(13_000);
  await expect(wait).toHaveCount(0);
  await expect(pair).toBeEnabled();
});

test("FX-R5: editing the code while Pair is in flight doesn't lose the result", async ({ page }) => {
  await page.goto("/setup?vvScenario=demo");
  const code = await lanCode(page);
  await page.goto("/pair");
  await mockReady(page);
  const input = page.getByLabel("Pairing code");
  await input.fill(code);
  const held = await holdMock(page, "pairDevice");
  await page.getByRole("button", { name: "Pair" }).click();
  await held.reached();
  await input.press("Backspace");
  await input.pressSequentially("9");
  await held.release();
  await expect(page.getByText("This phone is paired.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Venue Visualizer" })).toBeVisible();
});
