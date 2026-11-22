import { expect, test } from "@playwright/test";

import { openStudio, proof, settled } from "./helpers";

// FX-R13 @mobile: each Studio tab controls a labelled tabpanel.

test("FX-R13: Studio tabs point at labelled tab panels @mobile", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  for (const name of ["Photos", "Preview", "Chat", "Plan"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const panelId = await tab.getAttribute("aria-controls");
    expect(panelId, `${name} has aria-controls`).toBeTruthy();
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel).toHaveAttribute("role", "tabpanel");
    await expect(panel).toBeVisible();
    await expect(page.getByRole("tabpanel", { name })).toBeVisible();
  }
  await settled(page);
  await page.screenshot({ path: proof("FX-R13-tabpanel.png") });
});
