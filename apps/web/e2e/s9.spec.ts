import { expect, test, type Page } from "@playwright/test";

import { openStudio, proof, settled } from "./helpers";

// S9 (docs/onboarding-and-mobile.md) @mobile: "Take photos" and "Record a walkthrough" use the phone's camera and sit
// next to the normal pickers; desktop doesn't show them.

async function expectTakePhotos(page: Page) {
  const input = page.getByLabel("Take photos", { exact: true });
  await expect(input).toHaveAttribute("type", "file");
  await expect(input).toHaveAttribute("accept", "image/*");
  await expect(input).toHaveAttribute("capture", "environment");
  await expect(input).toHaveAttribute("multiple", "");
  await expect(page.getByText("Take photos", { exact: true })).toBeVisible();
}

test("S9: camera inputs sit next to the file pickers on a phone @mobile", async ({ page }) => {
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "a touch device").toBe(true);

  await page.goto("/venues/new?tab=upload");
  await expectTakePhotos(page);
  await expect(page.getByRole("button", { name: "Choose photos" })).toBeVisible();
  await settled(page);
  await page.screenshot({ path: proof("S9-upload-take-photos.png") });

  await page.goto("/venues/new?tab=video");
  const video = page.getByLabel("Record a walkthrough", { exact: true });
  await expect(video).toHaveAttribute("type", "file");
  await expect(video).toHaveAttribute("accept", "video/*");
  await expect(video).toHaveAttribute("capture", "environment");
  await expect(video).not.toHaveAttribute("multiple", /.*/);
  await expect(page.getByText("Record a walkthrough", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose a video" })).toBeVisible();
  await settled(page);
  await page.screenshot({ path: proof("S9-video-record.png") });

  await openStudio(page, "space-ballroom");
  await page.getByRole("tab", { name: "Photos", exact: true }).click();
  await expectTakePhotos(page);
  await expect(page.getByText("Add photos", { exact: true })).toBeVisible();
  await settled(page);
  await page.screenshot({ path: proof("S9-studio-take-photos.png") });
});

test("S9: desktop shows only the file pickers", async ({ page }) => {
  await page.goto("/venues/new?tab=upload");
  await expect(page.getByRole("button", { name: "Choose photos" })).toBeVisible();
  await expect(page.getByText("Take photos", { exact: true })).toBeHidden();
  await page.goto("/venues/new?tab=video");
  await expect(page.getByRole("button", { name: "Choose a video" })).toBeVisible();
  await expect(page.getByText("Record a walkthrough", { exact: true })).toBeHidden();
});
