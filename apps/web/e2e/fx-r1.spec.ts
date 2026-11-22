import { expect, test } from "@playwright/test";

import { lanCode, mockReady, proof, settled } from "./helpers";

// FX-R1 / FX-R10: the phone link opens /pair; an unpaired phone that lands anywhere else is sent to
// /pair?next=<where it was>, and after pairing it goes back there with fresh data.

test("FX-R1: the QR code and address open the pairing page", async ({ page }) => {
  await page.goto("/setup?vvScenario=demo");
  await lanCode(page);
  await expect(page.getByTestId("lan-url")).toHaveText(/^http:\/\/[\d.]+:3000\/pair$/);
  await expect(page.getByRole("img", { name: /QR code for http:\/\/[\d.]+:3000\/pair$/ })).toBeVisible();
});

test("FX-R1: an unpaired phone is sent to /pair, pairs, and lands back where it was", async ({ page }) => {
  await page.goto("/setup?vvScenario=demo");
  const code = await lanCode(page);
  await page.evaluate(() => window.__vvMock.setClient("phone"));

  await page.goto("/venues/venue-larkspur?tab=rooms");
  await expect(page).toHaveURL(/\/pair\?next=%2Fvenues%2Fvenue-larkspur%3Ftab%3Drooms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pair this phone");
  await settled(page);
  await page.screenshot({ path: proof("FX-R1-redirected-to-pair.png") });

  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page).toHaveURL(/\/venues\/venue-larkspur\?tab=rooms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Larkspur/);
  expect(await page.evaluate(() => window.__vvMock.client())).toEqual({ client: "phone", paired: true });
  await settled(page);
  await page.screenshot({ path: proof("FX-R1-back-after-pairing.png") });
});

test("FX-R1: a /pair link with an outside next only goes home", async ({ page }) => {
  await page.goto("/setup?vvScenario=demo");
  const code = await lanCode(page);
  await page.evaluate(() => window.__vvMock.setClient("phone"));
  await page.goto("/pair?next=//evil.example/x");
  await mockReady(page);
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.getByText("This phone is paired.")).toBeVisible();
  await expect(page).toHaveURL(/\/pair\?next=/);
});
