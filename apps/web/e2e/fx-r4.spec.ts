import { expect, test } from "@playwright/test";

import { mockReady, proof, settled } from "./helpers";

// FX-R4: from a paired phone every image test asks first and sends confirm_credits, even for the free local engine.

test("FX-R4: a paired phone confirms before an mflux image test", async ({ page }) => {
  await page.goto("/setup?vvScenario=ready");
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.setClient("phone", true));
  await page.reload();
  // Who is calling comes with the setup status; wait for it before testing.
  await expect(page.getByTestId("setup-summary")).toBeVisible();
  const mflux = page.getByRole("region", { name: "Local FLUX (mflux)", exact: true });
  await mflux.getByRole("button", { name: "Test images" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/phone/i);
  await settled(page);
  await page.screenshot({ path: proof("FX-R4-phone-confirm.png") });
  await dialog.getByRole("button", { name: "Test" }).click();
  // The mock answers 422 without confirm_credits from a phone, so a pass proves it was sent.
  await expect(mflux.getByTestId("test-result")).toContainText("Passed");
});

test("FX-R4: on this computer mflux still tests straight away", async ({ page }) => {
  await page.goto("/setup?vvScenario=ready");
  await expect(page.getByTestId("setup-summary")).toBeVisible();
  const mflux = page.getByRole("region", { name: "Local FLUX (mflux)", exact: true });
  await mflux.getByRole("button", { name: "Test images" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(mflux.getByTestId("test-result")).toContainText("Passed", { timeout: 15_000 });
});
