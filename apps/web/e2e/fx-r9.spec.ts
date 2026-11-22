import { expect, test } from "@playwright/test";

import { holdMock, mockReady, proof } from "./helpers";

// FX-R9: Finish setup makes the Try-it links safe to use straight away (setup is known complete before they're
// enabled), and the setup gate shows a neutral loading state instead of flashing a page it's about to leave.

test("FX-R9: Try it right after Finish setup opens the venue, even while setup status is still reloading", async ({ page }) => {
  await page.goto("/setup?vvScenario=ready");
  await mockReady(page);
  await expect(page.getByRole("button", { name: "Finish setup" })).toBeEnabled();
  // Setup status has loaded once (the summary comes from it); only the reload after Finish setup is held.
  await expect(page.getByTestId("setup-summary")).toHaveText(/ready brain and a ready image engine/);
  const held = await holdMock(page, "setupStatus");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("link", { name: "Open the demo venue" }).click();
  await expect(page).toHaveURL(/\/venues\/[\w-]+$/);
  await held.release();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Set up your AI tools");
  await expect(page).toHaveURL(/\/venues\/[\w-]+$/);
});

test("FX-R9: the setup gate shows a neutral loading state until it knows where to go", async ({ page }) => {
  // `vvHold` parks setup-status requests from the moment the page loads.
  await page.goto("/venues?vvScenario=fresh&vvHold=setupStatus");
  await mockReady(page);
  await expect.poll(() => page.evaluate(() => window.__vvMock.waiting("setupStatus"))).toBeGreaterThan(0);
  await expect(page.getByTestId("setup-gate-loading")).toBeVisible();
  // It covers the whole page, so nothing of the app shows (or takes a tap) before the redirect.
  const covered = () =>
    page.evaluate(() =>
      [
        [10, 10],
        [innerWidth / 2, innerHeight / 2],
        [innerWidth - 10, innerHeight - 10],
      ].every(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid=setup-gate-loading]")),
    );
  expect(await covered()).toBe(true);
  await page.screenshot({ path: proof("FX-R9-gate-loading.png") });
  await page.evaluate(() => window.__vvMock.release("setupStatus"));
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up your AI tools");
  await expect(page.getByTestId("setup-gate-loading")).toHaveCount(0);
});
