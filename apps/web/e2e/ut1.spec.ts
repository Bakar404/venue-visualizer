import { expect, test, type Page } from "@playwright/test";

import { assistantReplies, holdMock, openStudio, proof, sendChat, waitForReply } from "./helpers";

const LONG = (i: number) =>
  `Message ${i + 1}: I keep thinking about how the room should feel when guests walk in. Maybe softer light near the windows, ` +
  `a few more candles on the long tables and something tall in the middle so it doesn't feel empty from the doorway.`;
const OVERFLOWING_MESSAGE = Array.from({ length: 10 }, (_, i) => LONG(i)).join("\n\n");
const STARTER = "Blush and gold for 120 guests on round tables";
const conversation = (page: Page) => page.getByRole("log", { name: "Conversation" });
const pill = (page: Page) => page.getByRole("button", { name: /New message/ });
const thinking = (page: Page) => conversation(page).getByText("The brain is thinking", { exact: true });
const fromBottom = (page: Page) => conversation(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

async function fillChat(page: Page) {
  for (let i = 0; i < 12; i++) await sendChat(page, LONG(i));
  await expect(thinking(page)).toHaveCount(0);
  await expect.poll(() => fromBottom(page), { message: "the filled chat is pinned" }).toBeLessThanOrEqual(1);
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

/** Sends `text` with the reply held; scrolls the history to `scrollTop` while waiting, then lets the reply in. */
async function replyWhileScrolledTo(page: Page, text: string, scrollTop: number) {
  const log = conversation(page);
  const before = await assistantReplies(page);
  const chat = await holdMock(page, "chat");
  const input = page.locator("#chat-input");
  await input.fill(text);
  await input.press("Enter");
  // The request can reach the hold before React commits and follows the pending bubble.
  await chat.reached();
  await expect(log.locator("ol > li").last()).toHaveText(text);
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1);
  await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBeGreaterThan(scrollTop);
  await log.evaluate(
    (el, top) =>
      new Promise<void>((resolve) => {
        el.addEventListener("scroll", () => resolve(), { once: true });
        el.scrollTo({ top, behavior: "instant" });
      }),
    scrollTop,
  );
  const scrolledTo = await log.evaluate((el) => el.scrollTop);
  expect(scrolledTo).toBe(scrollTop);
  await chat.release();
  await waitForReply(page, before);
  await expect(thinking(page)).toHaveCount(0);
  return scrolledTo;
}

async function expectNoJumpWhenScrolledUp(page: Page) {
  const scrolledTo = await replyWhileScrolledTo(page, "Add a dance floor", 120);
  await expect(pill(page)).toBeVisible();
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
  await pill(page).click();
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1);
  await expect(pill(page)).toBeHidden();
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
  await expect(conversation(page).locator("ol > li").last()).toHaveText("Add a dance floor");
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1);
  await chat.release();
  await waitForReply(page, before);
  await expect(thinking(page)).toHaveCount(0);
  await expect.poll(() => fromBottom(page), { message: "the reply is followed to the end" }).toBeLessThanOrEqual(1);
  await expect(pill(page)).toBeHidden();
});

test("UT1: the first reply in a new conversation shows the pill if the reader scrolled up", async ({ page }) => {
  await openStudio(page, "space-terrace");
  await expect(page.getByRole("button", { name: STARTER })).toBeVisible();
  await expect(conversation(page).locator("ol > li")).toHaveCount(0);
  // One long first message, so the history scrolls before any reply exists.
  await replyWhileScrolledTo(page, OVERFLOWING_MESSAGE, 0);
  await expect(pill(page)).toBeVisible();
  expect(await conversation(page).evaluate((el) => el.scrollTop)).toBe(0);
});

test("UT1: a reader pinned to the end stays there when the panel gets shorter", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await fillChat(page);
  const { width, height } = page.viewportSize()!;
  const tall = await conversation(page).evaluate((el) => el.clientHeight);
  await page.setViewportSize({ width, height: height - 220 });
  await expect.poll(() => conversation(page).evaluate((el) => el.clientHeight)).toBeLessThan(tall);
  await expect.poll(() => fromBottom(page), { message: "still pinned after the log viewport shrank" }).toBeLessThanOrEqual(1);
});

test("UT1: a queued automatic scroll cannot unpin a growing conversation", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await sendChat(page, OVERFLOWING_MESSAGE);
  await expect(thinking(page)).toHaveCount(0);
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1);

  const { advance, gap } = await conversation(page).evaluate((el) => {
    const list = el.querySelector("ol");
    if (!list) throw new Error("Expected a conversation with messages");
    const start = el.scrollTop;
    return new Promise<{ advance: number; gap: number }>((resolve) => {
      // Widen the race: grow again as a real scroll from the first reflow is delivered to the app.
      el.addEventListener("scroll", () => {
        const advance = el.scrollTop - start;
        list.style.paddingBottom = "400px";
        resolve({ advance, gap: el.scrollHeight - el.scrollTop - el.clientHeight });
      }, { capture: true, once: true });
      list.style.paddingBottom = "200px";
    });
  });
  expect(advance, "the first reflow was followed without user input").toBeGreaterThan(0);
  expect(gap, "the old event is delivered against a larger scroll range").toBeGreaterThan(80);
  await expect.poll(() => fromBottom(page), { message: "still pinned after the automatic scroll event" }).toBeLessThanOrEqual(1);
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
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1);
});

test("UT1: a reader the layout brings back to the end is followed again (review R6)", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await fillChat(page);
  const log = conversation(page);
  const before = await assistantReplies(page);
  // A reply is on its way...
  const chat = await holdMock(page, "chat");
  await page.locator("#chat-input").fill("Add a dance floor");
  await page.locator("#chat-input").press("Enter");
  await chat.reached();
  await expect(log.locator("ol > li").last()).toHaveText("Add a dance floor");
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1);
  // ...the reader scrolls up ~150px to re-read (unpinned)...
  const bottom = await log.evaluate((el) => el.scrollHeight - el.clientHeight);
  await log.evaluate(
    (el, top) =>
      new Promise<void>((resolve) => {
        el.addEventListener("scroll", () => resolve(), { once: true });
        el.scrollTo({ top, behavior: "instant" });
      }),
    bottom - 150,
  );
  // ...then the panel grows (taller window) and the browser clamps them to the very end.
  const { width, height } = page.viewportSize()!;
  const tall = await log.evaluate((el) => el.clientHeight);
  await page.setViewportSize({ width, height: height + 400 });
  await expect.poll(() => log.evaluate((el) => el.clientHeight)).toBeGreaterThan(tall);
  await expect.poll(() => fromBottom(page), { message: "clamped to the end by the layout" }).toBeLessThanOrEqual(1);
  // Being at the end again means following again (the chat re-pins on the layout change).
  await expect(log).toHaveAttribute("data-pinned", "true");
  // The reply that lands now must be followed, with no "New message" pill: they are at the end.
  await chat.release();
  await waitForReply(page, before);
  await expect(thinking(page)).toHaveCount(0);
  await expect.poll(() => fromBottom(page), { message: "the reply is followed" }).toBeLessThanOrEqual(1);
  await expect(pill(page)).toBeHidden();
});
