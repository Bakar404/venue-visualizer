/**
 * Regenerates the README screenshots from the demo data (no backend, AI-generated sample photos).
 * Run: SHOTS=1 pnpm --filter web exec playwright test e2e/readme-shots.spec.ts --project=chromium
 */
import path from "node:path";

import { expect, test } from "@playwright/test";

import { openStudio, sendChat, settled } from "./helpers";

const out = (name: string) => path.resolve(__dirname, "../../../docs/images", name);

test.skip(!process.env.SHOTS, "README screenshots are only taken with SHOTS=1");
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });

test.beforeEach(async ({ page }) => {
  // Hide the Next.js dev-mode indicator so screenshots look like the real app.
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.documentElement.appendChild(style);
  });
});

test("landing", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await settled(page);
  await page.screenshot({ path: out("landing.jpg"), quality: 85 });
});

test("find my venue", async ({ page }) => {
  await page.goto("/venues/new?tab=find");
  await page.getByLabel("Venue name, wing/room, city").fill("Larkspur House, Grand Ballroom");
  await expect(async () => {
    await page.getByRole("button", { name: "Find my venue" }).click();
    await expect(page.getByText("Finding your venue")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole("button", { name: "This is my venue" }).first().waitFor({ timeout: 20_000 });
  await settled(page);
  await page.screenshot({ path: out("find-my-venue.jpg"), quality: 85 });
  await page.getByRole("button", { name: "This is my venue" }).first().click();
  await expect(page.getByRole("heading", { name: "Review before importing" })).toBeVisible();
  await settled(page);
  await page.screenshot({ path: out("import-review.jpg"), quality: 85, fullPage: false });
});

test("studio chat and render", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await sendChat(page, "12 round tables of 8, sage linens, gold chiavari chairs, tall white roses, make it 7pm so it's dark out");
  await sendChat(page, "I want to see it");
  await settled(page);
  await page.screenshot({ path: out("studio.jpg"), quality: 85 });
});

test("looks gallery", async ({ page }) => {
  await page.goto("/spaces/space-ballroom/looks");
  await page.waitForLoadState("networkidle");
  await settled(page);
  await page.screenshot({ path: out("looks.jpg"), quality: 85 });
});

test("references-only space", async ({ page }) => {
  await page.goto("/spaces/space-wren-long-room");
  await page.waitForLoadState("networkidle");
  await settled(page);
  await page.screenshot({ path: out("reference-photos.jpg"), quality: 85 });
});
