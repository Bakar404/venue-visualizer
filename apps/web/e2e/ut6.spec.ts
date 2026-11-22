import { expect, test, type Page } from "@playwright/test";

import { holdMock, proof } from "./helpers";

async function findLarkspur(page: Page, query: string) {
  await page.goto("/venues/new?tab=find");
  await page.getByLabel("Venue name, wing/room, city").fill(query);
  // Find waits for the brain list to load; retry until the search has started.
  await expect(async () => {
    await page.getByRole("button", { name: "Find my venue" }).click();
    await expect(page.getByText("Finding your venue")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole("button", { name: "This is my venue" }).first().click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Review before importing" })).toBeVisible();
}

test("UT6a: base photos without the confirmation can't be silently dropped", async ({ page }) => {
  await findLarkspur(page, "Larkspur House, Grand Ballroom");

  const importButton = page.getByRole("button", { name: /^Import \d+ spaces?$/ });
  const rights = page.getByRole("checkbox", { name: /personal planning and will credit/ });
  await expect(rights).not.toBeChecked();
  await expect(importButton, "photos are set to 'Use as base photo' but the box is unticked").toBeDisabled();

  const helper = page.getByRole("button", { name: /set to “Use as base photo”/ });
  await expect(helper).toBeVisible();
  await expect(helper).toContainText("Tick the box");
  await helper.scrollIntoViewIfNeeded();
  await page.screenshot({ path: proof("UT6a-import-blocked.png") });
  await helper.click();
  await expect(rights).toBeFocused();

  await rights.click();
  await expect(importButton).toBeEnabled();
  await expect(helper).toBeHidden();
  await page.screenshot({ path: proof("UT6a-import-ready.png") });
});

test("UT6a: switching every photo to reference only enables Import without the box", async ({ page }) => {
  await findLarkspur(page, "Larkspur House");
  const importButton = page.getByRole("button", { name: /^Import \d+ spaces?$/ });
  await expect(importButton).toBeDisabled();
  for (const toggle of await page.getByRole("switch", { name: "Use as base photo" }).all()) await toggle.click();
  await expect(importButton).toBeEnabled();
});

test("UT6b: a references-only space shows its references and the ways to get a base photo", async ({ page }) => {
  await page.goto("/spaces/space-wren-long-room");
  const preview = page.getByRole("region", { name: "Preview" });
  const refs = preview.getByRole("list", { name: "Reference photos" }).getByRole("listitem");
  await expect(refs).toHaveCount(2);
  await expect(refs.first()).toContainText("Wren Hall (demo image)");
  await expect(refs.first().getByRole("button", { name: "Use as my base photo" })).toBeVisible();
  await expect(refs.first().getByRole("button", { name: "Generate an empty base view from this" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Upload photos" })).toBeVisible();
  await expect(preview.getByRole("link", { name: "Video tour" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Describe it" })).toBeVisible();
  await page.screenshot({ path: proof("UT6b-references-empty-state.png") });

  // Use as my base photo → inline confirmation → the server downloads it and it becomes the active photo.
  await refs.first().getByRole("button", { name: "Use as my base photo" }).click();
  const confirm = refs.first().getByRole("checkbox", { name: /I'm using this for personal planning/ });
  await expect(confirm).toBeVisible();
  const useIt = refs.first().getByRole("button", { name: "Use this photo" });
  await expect(useIt).toBeDisabled();
  await confirm.click();
  await page.screenshot({ path: proof("UT6b-use-as-base-confirm.png") });
  await useIt.click();

  await expect(preview.getByRole("img", { name: "Photo 1, original" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Photos" }).getByText("Wren Hall (demo image)")).toBeVisible();
  await page.screenshot({ path: proof("UT6b-base-photo-active.png") });
});

test("UT6b: generate an empty base view from a reference, then approve it", async ({ page }) => {
  await page.goto("/spaces/space-wren-long-room");
  const preview = page.getByRole("region", { name: "Preview" });
  const refs = preview.getByRole("list", { name: "Reference photos" }).getByRole("listitem");
  await refs.nth(1).getByRole("button", { name: "Generate an empty base view from this" }).click();
  await expect(preview.getByText(/Generating the room|Waiting for the engine/)).toBeVisible();
  await page.screenshot({ path: proof("UT6b-generating-from-reference.png") });

  const approve = preview.getByRole("button", { name: "Use this view" });
  await expect(approve).toBeVisible({ timeout: 15_000 });
  await approve.click();
  await expect(preview.getByRole("img", { name: "Generated view 1, original" })).toBeVisible();
});

test("UT6c: Render all is disabled until the space has an approved base photo", async ({ page }) => {
  await page.goto("/spaces/space-wren-long-room");
  const renderAll = page.getByRole("button", { name: /Render all photos/ });
  await expect(renderAll).toBeVisible();
  await expect(renderAll).toBeDisabled();
  await expect(page.getByText("Add or approve a base photo to render")).toBeVisible();
  await page.screenshot({ path: proof("UT6c-render-disabled-no-photos.png") });
});

test("UT6b @mobile: a references-only space opens on its reference photos and actions", async ({ page }) => {
  await page.goto("/spaces/space-wren-long-room");
  const refs = page.getByRole("list", { name: "Reference photos" }).getByRole("listitem");
  await expect(refs.first()).toBeVisible();
  await expect(refs.first().getByRole("button", { name: "Use as my base photo" })).toBeVisible();
  await expect(refs.first().getByRole("button", { name: "Generate an empty base view from this" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: proof("UT6b-mobile-references.png") });
});

async function generateFromReference(page: Page) {
  await page.goto("/spaces/space-wren-long-room");
  const preview = page.getByRole("region", { name: "Preview" });
  const refs = preview.getByRole("list", { name: "Reference photos" }).getByRole("listitem");
  await refs.nth(1).getByRole("button", { name: "Generate an empty base view from this" }).click();
  await expect(preview.getByRole("button", { name: "Use this view" })).toBeVisible({ timeout: 15_000 });
  return { preview, refs };
}

test("UT6b: while a view is generating from a reference, Use as my base photo waits", async ({ page }) => {
  await page.goto("/spaces/space-wren-long-room");
  const preview = page.getByRole("region", { name: "Preview" });
  const refs = preview.getByRole("list", { name: "Reference photos" }).getByRole("listitem");
  await expect(refs).toHaveCount(2);

  // Job polls are held, so the job stays queued until released.
  const jobs = await holdMock(page, "getJob");
  await refs.nth(1).getByRole("button", { name: "Generate an empty base view from this" }).click();
  await expect(preview.getByText(/Generating the room|Waiting for the engine/)).toBeVisible();
  await jobs.reached();
  await expect(refs.nth(0).getByRole("button", { name: "Use as my base photo" })).toBeDisabled();
  await expect(refs.nth(1).getByRole("button", { name: "Use as my base photo" })).toBeDisabled();

  await jobs.release();
  await expect(preview.getByRole("button", { name: "Use this view" })).toBeVisible({ timeout: 15_000 });
  await expect(refs.nth(0).getByRole("button", { name: "Use as my base photo" })).toBeEnabled();
});

test("UT6b: a generated view stays reviewable after another photo becomes the base", async ({ page }) => {
  const { preview, refs } = await generateFromReference(page);

  await refs.first().getByRole("button", { name: "Use as my base photo" }).click();
  await refs.first().getByRole("checkbox", { name: /I'm using this for personal planning/ }).click();
  await refs.first().getByRole("button", { name: "Use this photo" }).click();
  await expect(preview.getByRole("img", { name: "Photo 1, original" })).toBeVisible();

  // The finished candidate moved to the photo strip, still with its Approve/Discard.
  const strip = page.getByRole("complementary", { name: "Photos" });
  await expect(strip.getByRole("img", { name: "Generated empty base view" })).toBeVisible();
  await expect(strip.getByRole("button", { name: "Discard" })).toBeVisible();
  await page.screenshot({ path: proof("UT6b-candidate-in-strip.png") });
  await strip.getByRole("button", { name: "Use this view" }).click();
  // Photos are ordered by when they were added, so the earlier generated view comes first and is now selected.
  await expect(preview.getByRole("img", { name: "Generated view 1, original" })).toBeVisible();
  await expect(strip.getByRole("button", { name: "Generated view 1", pressed: true })).toBeVisible();
  await expect(strip.getByRole("img", { name: "Generated empty base view" })).toBeHidden();
});

test("UT6b: Discard shows an error and keeps the generated view when deleting fails", async ({ page }) => {
  const { preview } = await generateFromReference(page);
  await page.evaluate(() => window.__vvMock.failNext("deletePhoto", "The disk is read-only"));
  await preview.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Couldn't discard the view")).toBeVisible();
  await expect(page.getByText("The disk is read-only")).toBeVisible();
  await expect(preview.getByRole("img", { name: "Generated empty base view" })).toBeVisible();
});

test("UT6b: Discard is disabled while the delete is in flight", async ({ page }) => {
  const { preview } = await generateFromReference(page);
  const discard = preview.getByRole("button", { name: "Discard" });
  const del = await holdMock(page, "deletePhoto");
  await discard.click();
  await del.reached();
  await expect(discard).toBeDisabled();
  await expect(preview.getByRole("button", { name: "Use this view" })).toBeDisabled();
  await del.release();
  await expect(preview.getByRole("img", { name: "Generated empty base view" })).toBeHidden();
});

test("UT6b: reference photos from the web are loaded without a referrer", async ({ page }) => {
  await page.goto("/spaces/space-wren-long-room");
  const images = page.getByRole("list", { name: "Reference photos" }).getByRole("img");
  await expect(images).toHaveCount(2);
  for (const img of await images.all()) await expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
});

test("UT6b: generating from a reference uses an engine that takes reference photos", async ({ page }) => {
  // The default engine (Mock) can't take references (max_refs 0); the API would reject it.
  await page.goto("/spaces/space-wren-long-room");
  const preview = page.getByRole("region", { name: "Preview" });
  await preview.getByRole("button", { name: "Generate an empty base view from this" }).first().click();
  const outcome = page.getByText(/Generating the room|Waiting for the engine|can't use a reference photo/).first();
  await expect(outcome).toBeVisible();
  await expect(outcome).not.toHaveText(/can't use a reference photo/);
});
