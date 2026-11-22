import { expect, test } from "@playwright/test";

import { lastUserMessage, openStudio, proof, sendChat } from "./helpers";

test("UT3: a quick-reply chip sends only the option, never the question", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await sendChat(page, "Make it moodier");

  const chips = page.getByRole("group", { name: "Suggested replies" });
  await expect(chips).toBeVisible();
  await page.screenshot({ path: proof("UT3-question-and-options.png") });

  const chip = chips.getByRole("button").first();
  const option = (await chip.innerText()).trim();
  await chip.click();
  await expect.poll(() => page.evaluate(() => window.__vvMock.chat("space-ballroom").filter((m) => m.role === "user").length)).toBe(3);

  const sentToBrain = await page.evaluate(() => window.__vvMock.chat("space-ballroom").filter((m) => m.role === "user").at(-1)!.content);
  expect(sentToBrain, "the chip sends exactly its option").toBe(option);
  expect(sentToBrain, "the question is never sent as the user's message").not.toContain("?");
  await expect.poll(() => lastUserMessage(page)).toBe(option);
});

test("UT3: the question is shown as text above the option chips", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await sendChat(page, "Add flowers");
  const chips = page.getByRole("group", { name: "Suggested replies" });
  await expect(chips).toBeVisible();
  await expect(chips.getByRole("button", { name: /\?/ })).toHaveCount(0);
  await expect(chips.getByText("Which flowers would you like?")).toBeVisible();
  await expect(chips.getByRole("button")).toHaveText(["Garden roses", "Peonies", "Ranunculus"]);
});
