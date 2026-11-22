import { expect, test } from "@playwright/test";

import { openStudio, proof, settled } from "./helpers";

// FX-R6 @mobile: on a notched phone the Studio fits between the safe areas: its height subtracts the top inset (under
// the header) and the bottom inset (home indicator), so nothing is pushed off screen. Chromium reports zero insets,
// so the test overrides the variables the layout reads them from.

test("FX-R6: the Studio fits between the safe-area insets @mobile", async ({ page }) => {
  await openStudio(page, "space-ballroom");
  await page.addStyleTag({ content: ":root { --safe-top: 47px !important; --safe-bottom: 34px !important; }" });
  const box = await page.evaluate(() => {
    const header = document.querySelector("header")!.getBoundingClientRect();
    const studio = document.querySelector<HTMLElement>("[data-testid=studio]")!.getBoundingClientRect();
    const bar = document.querySelector<HTMLElement>("[data-testid=studio-tab-bar]")!.getBoundingClientRect();
    return { header: header.height, top: studio.top, bottom: studio.bottom, barBottom: bar.bottom, scroll: document.documentElement.scrollHeight, inner: window.innerHeight };
  });
  expect(box.header).toBe(56 + 1 + 47);
  expect(box.top).toBe(104);
  expect(box.bottom).toBe(844 - 34);
  expect(box.barBottom).toBe(844 - 34);
  expect(box.scroll).toBeLessThanOrEqual(box.inner);
  await settled(page);
  await page.screenshot({ path: proof("FX-R6-safe-area.png") });
});
