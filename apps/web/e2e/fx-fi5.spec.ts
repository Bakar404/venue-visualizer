import { expect, test, type Page } from "@playwright/test";

import { mockReady, proof, settled } from "./helpers";

// FX-FI5: one readiness rule. A tool that is installed but whose sign-in is unknown is "likely", never "ready":
// the setup summary says it will probably work and asks for a test; only a passed test makes it ready.

const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("FX-FI5: setup never calls a likely tool ready, and says to run Test", async ({ page }) => {
  await page.goto("/setup?vvScenario=fresh");
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.install("copilot"));
  const copilot = card(page, "GitHub Copilot");
  await copilot.getByRole("button", { name: "Check again" }).click();
  await expect(copilot.getByTestId("status-pill")).toHaveText("Unknown");

  const summary = page.getByTestId("setup-summary");
  await expect(summary).toContainText("Still needed: a brain and an image engine.");
  await expect(summary).toContainText("Copilot will probably work. Run Test to be sure.");
  await expect(summary).not.toContainText(/ready brain/);
  await settled(page);
  await summary.screenshot({ path: proof("FX-FI5-likely.png") });

  await copilot.getByRole("button", { name: "Test chat" }).click();
  await expect(copilot.getByTestId("test-result")).toContainText("Passed");
  await expect(summary).toContainText("Still needed: an image engine.");
  await copilot.getByRole("button", { name: "Test images" }).click();
  await page.getByRole("button", { name: "Use credits and test" }).click();
  await expect(copilot.getByTestId("test-result")).toContainText("Passed");
  await expect(summary).toHaveText("You have a ready brain and a ready image engine.");
  await settled(page);
  await summary.screenshot({ path: proof("FX-FI5-ready.png") });
});
