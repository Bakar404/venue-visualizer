import { expect, test, type Page } from "@playwright/test";

import { assistantReplies, openStudio, proof, sendChat, waitForReply } from "./helpers";

const LONG = (i: number) =>
  `Message ${i + 1}: I keep thinking about how the room should feel when guests walk in. Maybe softer light near the windows, ` +
  `a few more candles on the long tables and something tall in the middle so it doesn't feel empty from the doorway.`;

async function fillChat(page: Page) {
  for (let i = 0; i < 12; i++) await sendChat(page, LONG(i));
}

async function expectPinnedLayout(page: Page) {
  const { scrollHeight, innerHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(scrollHeight, "the page itself must not scroll").toBeLessThanOrEqual(innerHeight);
  const log = page.getByRole("log", { name: "Conversation" });
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight), "the chat history scrolls on its own").toBe(true);
  await expect(page.locator("#chat-input")).toBeInViewport();
  await expect(page.getByRole("button", { name: /Render all photos/ })).toBeInViewport();
}

async function expectNoJumpWhenScrolledUp(page: Page) {
  const log = page.getByRole("log", { name: "Conversation" });
  const before = await assistantReplies(page);
  const input = page.locator("#chat-input");
  await input.fill("Add a dance floor");
  await input.press("Enter");
  // While the brain is thinking, scroll up to read something older.
  await page.waitForTimeout(250);
  await log.evaluate((el) => el.scrollTo({ top: 120, behavior: "instant" }));
  const scrolledTo = await log.evaluate((el) => el.scrollTop);
  await waitForReply(page, before);
  await page.waitForTimeout(400);
  expect(await log.evaluate((el) => el.scrollTop), "a new reply must not move a reader who scrolled up").toBe(scrolledTo);
  await expect(page.getByRole("button", { name: /New message/ })).toBeVisible();
}

test("UT1: studio fills the viewport; chat scrolls inside a pinned layout", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await fillChat(page);
  await expectPinnedLayout(page);
  await page.screenshot({ path: proof("UT1-desktop-12-messages.png") });

  await expectNoJumpWhenScrolledUp(page);
  await page.screenshot({ path: proof("UT1-desktop-new-message-pill.png") });

  // The pill brings the reader back down.
  await page.getByRole("button", { name: /New message/ }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(80);
  await expect(page.getByRole("button", { name: /New message/ })).toBeHidden();
});

test("UT1: phone tabs use the same internal scroll @mobile", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await page.getByRole("tab", { name: "Plan" }).click();
  await fillChat(page);
  await expectPinnedLayout(page);
  await page.screenshot({ path: proof("UT1-mobile-plan-tab.png") });
  await expectNoJumpWhenScrolledUp(page);
});
