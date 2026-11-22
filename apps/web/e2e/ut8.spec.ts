import { expect, test } from "@playwright/test";

import { openStudio, proof, sendChat } from "./helpers";

test("UT8: when the plan changes, the canvas says so until the new render", async ({ page }) => {
  // Show the Look whose plan matches the room's draft, so nothing is stale yet.
  await openStudio(page, "space-ballroom", "?look=look-blush");
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByRole("img", { name: /with the Blush, gold & ivory Look applied/ })).toBeVisible();
  const banner = preview.getByText("Your plan changed since this render");
  await expect(banner).toHaveCount(0);

  await sendChat(page, "Make the linens sage green");
  await expect(banner).toBeVisible();
  await page.screenshot({ path: proof("UT8-plan-changed-banner.png") });

  await preview.getByRole("button", { name: /Render to see it/ }).click();
  await expect(banner).toBeHidden();
  await expect(preview.getByText(/^(Queued|Rendering)$/)).toBeVisible();
  await expect(preview.getByText(/^(Queued|Rendering)$/)).toBeHidden({ timeout: 15_000 });
  await expect(banner).toBeHidden();
  await page.screenshot({ path: proof("UT8-after-render.png") });
});
