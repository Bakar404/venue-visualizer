import { expect, test } from "@playwright/test";

import { holdMock, openStudio, proof, savedSpec, sendChat } from "./helpers";

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

test("UT8: a field typed then cleared is not a plan change, and Render all reuses the Look", async ({ page }) => {
  await openStudio(page, "space-ballroom", "?look=look-blush");
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByRole("img", { name: /with the Blush, gold & ivory Look applied/ })).toBeVisible();
  const banner = preview.getByText("Your plan changed since this render");
  const looksBefore = await page.evaluate(() => window.__vvMock.looks().length);

  await page.getByRole("button", { name: /Plan details/ }).click();
  const runner = page.getByLabel("Runner");
  await runner.fill("burlap");
  await expect(banner).toBeVisible();
  await runner.fill("");
  // The cleared runner is saved as null; the Look's spec (from the API) has no runner key at all.
  await expect.poll(async () => ((await savedSpec(page, "space-ballroom")) as { linens?: { runner?: unknown } })?.linens).toMatchObject({ runner: null });
  await expect(banner).toBeHidden();

  await page.getByRole("button", { name: "Render all photos" }).click();
  await expect(preview.getByText(/^(Queued|Rendering)$/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__vvMock.renders().filter((r) => r.status !== "done").length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__vvMock.looks().length)).toBe(looksBefore);
  await expect(page).toHaveURL(/look=look-blush/);
});

test("UT8: edits made while Render all is starting are kept, and the canvas says the plan changed", async ({ page }) => {
  await openStudio(page, "space-ballroom", "?look=look-blush");
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByRole("img", { name: /with the Blush, gold & ivory Look applied/ })).toBeVisible();
  const banner = preview.getByText("Your plan changed since this render");

  await page.getByRole("button", { name: /Plan details/ }).click();
  const linen = page.getByLabel("Linen color");
  await linen.fill("champagne");
  await expect(banner).toBeVisible();

  const render = await holdMock(page, "renderLook");
  await page.getByRole("button", { name: "Render all photos" }).click();
  await render.reached();
  await linen.fill("sage");
  await expect.poll(async () => ((await savedSpec(page, "space-ballroom")) as { linens: { color: string } }).linens.color).toBe("sage");
  await render.release();

  // The new Look holds the plan that was rendered; the draft keeps the later edit.
  await expect(page).not.toHaveURL(/look=look-blush/);
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(linen).toHaveValue("sage");
  expect(((await savedSpec(page, "space-ballroom")) as { linens: { color: string } }).linens.color).toBe("sage");
  const created = await page.evaluate(() => window.__vvMock.looks().filter((l) => !l.id.startsWith("look-")));
  expect(created.map((l) => l.spec.linens.color)).toEqual(["champagne"]);
});
