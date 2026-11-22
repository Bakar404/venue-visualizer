import { expect, test } from "@playwright/test";

import { openStudio, proof, sendChat } from "./helpers";

test("UT2: asking to see it offers Render now; one click queues one render of the current plan", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await sendChat(page, "Make the linens sage green");
  await sendChat(page, "I want to see it");

  const card = page.getByRole("group", { name: /Ready to see it/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Mock (dev)");
  await expect(card).toContainText(/about 2\s?s/);
  await expect(card).toContainText("Free, for testing");
  await page.screenshot({ path: proof("UT2-render-now-card.png") });

  const looksBefore = await page.evaluate(() => window.__vvMock.looks().length);
  // A double click must not start two renders.
  await card.getByRole("button", { name: "Render now" }).dblclick();

  await expect.poll(() => page.evaluate(() => window.__vvMock.looks().length)).toBe(looksBefore + 1);
  const look = await page.evaluate(() => window.__vvMock.looks().at(-1)!);
  expect(look.spec.linens.color, "the render uses the plan on screen").toMatch(/sage/);
  const rendersFor = () =>
    page.evaluate((id) => window.__vvMock.renders().filter((r) => r.look_id === id).length, look.id);
  await expect.poll(rendersFor, { message: "one render per photo" }).toBe(2);
  await expect(page.getByRole("region", { name: "Preview" }).getByText(/^(Queued|Rendering)$/)).toBeVisible();
  expect(await page.evaluate(() => window.__vvMock.looks().length), "the double click started one render").toBe(looksBefore + 1);
  expect(await rendersFor()).toBe(2);
  await page.screenshot({ path: proof("UT2-render-queued.png") });
});

test("UT2: a reply that changed the plan offers a quiet Render this change", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await sendChat(page, "Add string lights");
  const link = page.getByRole("button", { name: "Render this change" });
  await expect(link).toBeVisible();
  await page.screenshot({ path: proof("UT2-render-this-change.png") });

  const looksBefore = await page.evaluate(() => window.__vvMock.looks().length);
  await link.click();
  await expect.poll(() => page.evaluate(() => window.__vvMock.looks().length)).toBe(looksBefore + 1);
  await expect(page.getByRole("button", { name: /Rendering…/ })).toBeVisible();
});

test("UT2: a reply that changed nothing has no render action", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await sendChat(page, "What do you think?");
  await expect(page.getByRole("button", { name: "Render this change" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Ready to see it/ })).toHaveCount(0);
});
