import { expect, test, type Page } from "@playwright/test";

import { openStudio, proof, settled } from "./helpers";

// S8 (docs/onboarding-and-mobile.md) @mobile: in the Studio, with the keyboard simulated (visualViewport resized),
// the composer stays visible; the slider drags by touch; Render is reachable from each tab.

const TABS = ["Photos", "Preview", "Chat", "Plan"] as const;

declare global {
  interface Window {
    __keyboard: (px: number) => void;
  }
}

/** iOS keeps the layout viewport when the keyboard opens and shrinks only `visualViewport`; this fakes that. */
async function fakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    let keyboard = 0;
    const fake = new EventTarget() as EventTarget & Record<string, unknown>;
    Object.defineProperties(fake, {
      width: { get: () => window.innerWidth },
      height: { get: () => window.innerHeight - keyboard },
      offsetTop: { get: () => 0 },
      offsetLeft: { get: () => 0 },
      pageTop: { get: () => window.scrollY },
      pageLeft: { get: () => window.scrollX },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
    window.__keyboard = (px: number) => {
      keyboard = px;
      fake.dispatchEvent(new Event("resize"));
    };
  });
}

async function bottomOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not rendered`);
  return box.y + box.height;
}

test("S8: the composer stays above the on-screen keyboard @mobile", async ({ page }) => {
  await fakeKeyboard(page);
  await openStudio(page, "space-ballroom");
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  const input = page.locator("#chat-input");
  await expect(input).toBeInViewport();
  await input.focus();

  const { height } = page.viewportSize()!;
  const keyboard = 336;
  await page.evaluate((px) => window.__keyboard(px), keyboard);
  await expect.poll(() => bottomOf(page, "#chat-input"), { message: "the composer sits above the keyboard" }).toBeLessThanOrEqual(height - keyboard);
  await expect(page.getByRole("button", { name: "Send" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight), "the page itself does not scroll").toBeLessThanOrEqual(height);
  await page.screenshot({ path: proof("S8-keyboard-open.png") });

  await page.evaluate(() => window.__keyboard(0));
  await expect.poll(() => bottomOf(page, "#chat-input")).toBeGreaterThan(height - keyboard);

  // Browsers that resize the layout viewport for the keyboard (Android Chrome).
  await page.setViewportSize({ width: 390, height: 520 });
  await expect.poll(() => bottomOf(page, "#chat-input")).toBeLessThanOrEqual(520);
  await expect(input).toBeInViewport();
});

test("S8: the before/after slider drags by touch @mobile", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const slider = page.getByRole("slider", { name: /Comparison split/ });
  await expect(slider).toHaveValue("50");
  const stage = slider.locator("..");
  const box = await stage.boundingBox();
  if (!box) throw new Error("No comparison stage");

  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const at = (f: number) => [{ x: box.x + box.width * f, y, id: 0 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0.8) });
  for (const f of [0.7, 0.55, 0.4, 0.3, 0.2]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(f) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => Number(await slider.inputValue()), { message: "the split follows the finger" }).toBeLessThanOrEqual(25);
  // A second finger landing mid-drag doesn't make the split jump.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0.3) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(0.6) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [...at(0.6), { x: box.x + box.width * 0.95, y: y + 20, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(80);
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThanOrEqual(50);
  await settled(page);
  await page.screenshot({ path: proof("S8-slider-touch.png") });
});

test("S8: Render is reachable from every Studio tab @mobile", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  const bar = page.getByRole("tablist", { name: "Studio" });
  const { height } = page.viewportSize()!;
  const barBox = await bar.boundingBox();
  expect(barBox && barBox.y + barBox.height, "the tab bar sits at the bottom").toBeGreaterThan(height - 100);
  await expect(bar.getByRole("tab")).toHaveText(TABS.map((t) => new RegExp(t)));

  for (const name of TABS) {
    await bar.getByRole("tab", { name, exact: true }).click();
    await expect(bar.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    const render = page.getByRole("button", { name: /Render all photos/ });
    await expect(render, `Render on the ${name} tab`).toBeInViewport();
    await expect(render).toBeEnabled();
    await settled(page);
    await page.screenshot({ path: proof(`S8-tab-${name.toLowerCase()}.png`) });
  }

  await bar.getByRole("tab", { name: "Photos", exact: true }).click();
  await page.getByRole("button", { name: /Render all photos/ }).click();
  await expect(page.getByRole("button", { name: /Render all photos|Rendering/ })).toHaveAttribute("aria-busy", "true");
});
