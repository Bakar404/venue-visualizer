import { expect, test } from "@playwright/test";

import { mockReady } from "./helpers";

// CI-race: on a slow machine `__vvMock` exists before the app has dropped `?vvScenario=` from the URL, so a test
// that changes the mock and reloads gets the scenario re-applied. `mockReady` must wait for both.

test("CI-race: mockReady returns only once ?vvScenario= is gone, even on a slow CPU", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CPU throttling needs Chromium");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  await page.goto("/setup?vvScenario=ready");
  await mockReady(page);
  const search = await page.evaluate(() => window.location.search);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  expect(search).not.toContain("vvScenario");
});
