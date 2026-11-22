import { expect, test, type Page } from "@playwright/test";

import { assistantReplies, holdMock, openStudio, proof, sendChat, waitForReply } from "./helpers";

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

const conversation = (page: Page) => page.getByRole("log", { name: "Conversation" });
const STARTER = "Blush and gold for 120 guests on round tables";
const pill = (page: Page) => page.getByRole("button", { name: /New message/ });
const fromBottom = (page: Page) => conversation(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
/** Resolves after the browser has laid out and painted twice, so ResizeObservers and effects have run. */
const settledFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Sends `text` with the reply held; scrolls the history to `scrollTop` while waiting, then lets the reply in. */
async function replyWhileScrolledTo(page: Page, text: string, scrollTop: number) {
  const log = conversation(page);
  const before = await assistantReplies(page);
  const chat = await holdMock(page, "chat");
  const input = page.locator("#chat-input");
  await input.fill(text);
  await input.press("Enter");
  // While the brain is thinking, scroll up to read something older, and let the app see that scroll event.
  await chat.reached();
  await log.evaluate(
    (el, top) =>
      new Promise<void>((resolve) => {
        if (Math.round(el.scrollTop) === top) return resolve();
        el.addEventListener("scroll", () => resolve(), { once: true });
        el.scrollTo({ top, behavior: "instant" });
      }),
    scrollTop,
  );
  const scrolledTo = await log.evaluate((el) => el.scrollTop);
  await chat.release();
  await waitForReply(page, before);
  return scrolledTo;
}

async function expectNoJumpWhenScrolledUp(page: Page) {
  const scrolledTo = await replyWhileScrolledTo(page, "Add a dance floor", 120);
  await expect(pill(page)).toBeVisible();
  await settledFrames(page);
  expect(await conversation(page).evaluate((el) => el.scrollTop), "a new reply must not move a reader who scrolled up").toBe(scrolledTo);
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

test("UT1: a reader at the bottom keeps following a new reply", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await fillChat(page);
  const before = await assistantReplies(page);
  const chat = await holdMock(page, "chat");
  await page.locator("#chat-input").fill("Add a dance floor");
  await page.locator("#chat-input").press("Enter");
  await chat.reached();
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1);
  await chat.release();
  await waitForReply(page, before);
  await expect.poll(() => fromBottom(page), { message: "the reply is followed to the end" }).toBeLessThanOrEqual(1);
  await settledFrames(page);
  await expect(pill(page)).toBeHidden();
});

test("UT1: the first reply in a new conversation shows the pill if the reader scrolled up", async ({ page }) => {
  await openStudio(page, "space-terrace");
  await expect(page.getByRole("button", { name: STARTER })).toBeVisible();
  await expect(conversation(page).locator("ol > li")).toHaveCount(0);
  // One long first message, so the history scrolls before any reply exists.
  await replyWhileScrolledTo(page, Array.from({ length: 10 }, (_, i) => LONG(i)).join("\n\n"), 0);
  await expect(pill(page)).toBeVisible();
  expect(await conversation(page).evaluate((el) => el.scrollTop)).toBe(0);
});

test("UT1: a reader pinned to the end stays there when the panel gets shorter", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await fillChat(page);
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1);
  const { width, height } = page.viewportSize()!;
  const tall = await conversation(page).evaluate((el) => el.clientHeight);
  await page.setViewportSize({ width, height: height - 220 });
  await expect.poll(() => conversation(page).evaluate((el) => el.clientHeight)).toBeLessThan(tall);
  // ResizeObserver callbacks run before the next paint, so two frames later the log must already be pinned.
  await settledFrames(page);
  expect(await fromBottom(page), "still pinned after the log viewport shrank").toBeLessThanOrEqual(1);
});

test("UT1: the New message pill moves focus to the newest message", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await fillChat(page);
  await replyWhileScrolledTo(page, "Add a dance floor", 120);
  await pill(page).focus();
  await page.keyboard.press("Enter");
  const newest = conversation(page).locator("ol > li").last();
  await expect(newest).toContainText("Assistant:");
  await expect(newest).toBeFocused();
  await expect.poll(() => fromBottom(page)).toBeLessThan(80);
});
