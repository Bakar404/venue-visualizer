import { expect, test } from "@playwright/test";

import { openStudio, proof, settled } from "./helpers";

test("UT7: an unverifiable check says “Couldn't verify”, explains why, and points to the slider", async ({ page }) => {
  await openStudio(page, "space-terrace");
  const badge = page.getByRole("button", { name: /Couldn't verify/ });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("data-level", "unverified");
  await badge.click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("Lighting changed a lot, so we couldn't confirm the room matches; compare with the slider.");
  await settled(page);
  await page.screenshot({ path: proof("UT7-couldnt-verify.png") });

  await detail.getByRole("button", { name: /Compare/ }).click();
  await expect(page.getByRole("slider")).toBeFocused();
});

test("UT7: a changed room says “May have changed the room” with the backend's message", async ({ page }) => {
  await openStudio(page, "space-hayloft");
  const badge = page.getByRole("button", { name: /May have changed the room/ });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("data-level", "changed");
  await badge.click();
  await expect(page.getByRole("dialog")).toContainText("This render may have changed the room's architecture.");
  await settled(page);
  await page.screenshot({ path: proof("UT7-may-have-changed.png") });
});
