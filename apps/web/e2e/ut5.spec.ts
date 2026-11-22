import { expect, test } from "@playwright/test";

import { openStudio, proof, sendChat } from "./helpers";

test("UT5: Save as Look prefills the brain's name for the latest change", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await sendChat(page, "Moody night with burgundy and plum, blue uplighting");
  await page.getByRole("button", { name: "Save as Look" }).click();
  const name = page.getByRole("dialog").getByLabel("Name");
  await expect(name).toHaveValue("Moody night, blue uplighting");
  await page.screenshot({ path: proof("UT5-save-as-look-name.png") });

  await page.getByRole("dialog").getByRole("button", { name: /Save/ }).click();
  await expect(page.getByRole("combobox", { name: "Active Look" })).toContainText("Moody night, blue uplighting");
});
