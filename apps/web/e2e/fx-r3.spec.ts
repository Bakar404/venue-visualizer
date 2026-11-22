import { expect, test } from "@playwright/test";

import { lanCode, proof, settled } from "./helpers";

// FX-R3: New code asks the API for a fresh code (POST /api/system/lan/code).
// The panel counts down to expiry, fetches a new code when it runs out, and explains a pairing lockout.

test("FX-R3: New code replaces the code; the panel counts down and refreshes at expiry", async ({ page }) => {
  await page.clock.install();
  await page.goto("/setup?vvScenario=demo");
  const first = await lanCode(page);
  const code = page.getByTestId("pairing-code");
  const expiry = page.getByTestId("pairing-expiry");
  await expect(expiry).toHaveText(/Expires in (10:00|9:5\d)/);
  await page.clock.fastForward(65_000);
  await expect(expiry).toHaveText(/Expires in 8:5\d/);

  await page.getByRole("button", { name: "New code" }).click();
  await expect(code).not.toHaveText(`${first.slice(0, 3)} ${first.slice(3)}`);
  await expect(expiry).toHaveText(/Expires in (10:00|9:5\d)/);
  const second = ((await code.textContent()) ?? "").replace(/\D/g, "");

  // Ten minutes later the code is gone; the panel fetches the next one by itself.
  await page.clock.fastForward(10 * 60_000 + 2_000);
  await expect(code).toHaveText(/^\d{3} \d{3}$/);
  await expect(code).not.toHaveText(`${second.slice(0, 3)} ${second.slice(3)}`);
  await expect(expiry).toHaveText(/Expires in (10:00|9:5\d)/);
  await settled(page);
  await page.getByRole("region", { name: "Open on your phone" }).screenshot({ path: proof("FX-R3-countdown.png") });
});

test("RV2: the open panel notices a lockout without reloading, then shows a code when it ends", async ({ page }) => {
  await page.clock.install();
  await page.goto("/setup?vvScenario=demo");
  await lanCode(page);
  await page.evaluate(() => window.__vvMock.lockPairing(30));
  const paused = page.getByTestId("pairing-locked");
  await expect(paused).toHaveText(/Pairing is paused for \d+ s after too many wrong codes/, { timeout: 10_000 });
  await expect(page.getByTestId("pairing-code")).toHaveCount(0);
  await settled(page);
  await page.getByRole("region", { name: "Open on your phone" }).screenshot({ path: proof("FX-R3-locked.png") });
  const secondsLeft = async () => Number(/for (\d+) s/.exec((await paused.textContent()) ?? "")?.[1]);
  const initial = await secondsLeft();
  await page.clock.fastForward(10_000);
  await expect.poll(async () => Math.abs(await secondsLeft() - (initial - 10))).toBeLessThanOrEqual(1);
  await page.clock.fastForward(21_000);
  await expect(page.getByTestId("pairing-code")).toHaveText(/^\d{3} \d{3}$/);
  await expect(paused).toHaveCount(0);
});
