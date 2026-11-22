import { expect, test } from "@playwright/test";

import { openStudio, proof, savedSpec, sendChat } from "./helpers";

const planSummary = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /Plan details/ });

test("UT4: the plan has a Time & windows section; picking Night shows in the summary", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await planSummary(page).click();
  await page.getByRole("button", { name: "Time & windows" }).click();

  const time = page.getByRole("radiogroup", { name: "Time of day" });
  const radios = time.getByRole("radio");
  await expect(radios).toHaveCount(5);
  for (const [i, name] of ["As photo", "Daylight", "Golden hour", "Evening", "Night"].entries()) {
    await expect(radios.nth(i)).toHaveAccessibleName(name);
  }
  // R4: with no time set, the plan keeps the photo's time of day.
  await expect(time.getByRole("radio", { name: "As photo" })).toBeChecked();
  await time.getByRole("radio", { name: "Night" }).click();
  await expect(time.getByRole("radio", { name: "Night" })).toBeChecked();

  await page.getByRole("combobox", { name: "Windows" }).click();
  await page.getByRole("option", { name: "Dark" }).click();
  await expect(page.getByRole("combobox", { name: "Windows" })).toHaveText(/Dark/);

  await expect(planSummary(page)).toContainText("Night");
  await page.getByRole("button", { name: "Time & windows" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: proof("UT4-time-and-windows.png") });
});

test("UT4: “make it 7pm so it's dark out” sets night in one turn", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await sendChat(page, "Make it 7pm so it's dark out");
  await expect(planSummary(page)).toContainText("Night");
  await page.screenshot({ path: proof("UT4-chat-night-summary.png") });
});

test("UT4: going back to “As photo” clears the time and keeps every later edit", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await planSummary(page).click();
  await page.getByRole("button", { name: "Time & windows" }).click();
  const time = page.getByRole("radiogroup", { name: "Time of day" });
  await time.getByRole("radio", { name: "Night" }).click();
  await expect.poll(async () => (await savedSpec(page, "space-ballroom"))?.scene).toMatchObject({ time_of_day: "night" });

  await time.getByRole("radio", { name: "As photo" }).click();
  await expect(time.getByRole("radio", { name: "As photo" })).toBeChecked();
  await page.getByLabel("Linen color").fill("sage green");

  await expect
    .poll(async () => {
      const spec = (await savedSpec(page, "space-ballroom")) as { scene?: { time_of_day?: unknown }; linens: { color: string } } | null;
      return { time_of_day: spec?.scene?.time_of_day, linens: spec?.linens.color };
    })
    .toEqual({ time_of_day: null, linens: "sage green" });
  await expect(planSummary(page)).not.toContainText("Night");
});
