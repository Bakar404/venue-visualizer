import { expect, test, type Page } from "@playwright/test";

import { mockReady, openStudio, proof, settled } from "./helpers";

// FX-R2: defaults and the Studio pickers offer only READY tools. Likely ones are shown, disabled, with
// "Run Test first"; a tool whose test failed is never offered.

const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("FX-R2: the defaults step offers only ready tools", async ({ page }) => {
  await page.goto("/setup?vvScenario=fresh");
  await mockReady(page);
  await page.evaluate(() => {
    window.__vvMock.install("copilot");
    window.__vvMock.install("mflux");
    window.__vvMock.install("kimi", "signed-out");
  });
  await card(page, "GitHub Copilot").getByRole("button", { name: "Check again" }).click();
  const kimi = card(page, "Kimi Code");
  await expect(kimi.getByTestId("status-pill")).toHaveText("Unknown");
  await kimi.getByRole("button", { name: "Test chat" }).click();
  await expect(kimi.getByTestId("test-result")).toContainText("Failed");

  const brains = page.getByRole("radiogroup", { name: "Default brain" });
  const engines = page.getByRole("radiogroup", { name: "Default image engine" });
  // Copilot is installed but untested: shown, not choosable.
  const copilotBrain = brains.getByRole("radio", { name: /Copilot/ });
  await expect(copilotBrain).toBeDisabled();
  await expect(copilotBrain).toContainText("Run Test first");
  await expect(engines.getByRole("radio", { name: /Copilot/ })).toBeDisabled();
  // Kimi failed its test: not offered at all.
  await expect(brains.getByRole("radio", { name: /Kimi/ })).toHaveCount(0);
  // mflux reports it's ready: the only choice, and recommended.
  const mflux = engines.getByRole("radio", { name: /mflux/ });
  await expect(mflux).toBeEnabled();
  await expect(mflux).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Finish setup" })).toBeDisabled();
  await settled(page);
  await page.getByTestId("defaults-step").screenshot({ path: proof("FX-R2-defaults.png") });
});

test("FX-R2: the Studio brain picker shows a likely brain disabled with Run Test first", async ({ page }) => {
  await page.goto("/setup?vvScenario=ready");
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.install("kimi"));
  await card(page, "Kimi Code").getByRole("button", { name: "Check again" }).click();
  await expect(card(page, "Kimi Code").getByTestId("status-pill")).toHaveText("Unknown");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("link", { name: "Open the demo venue" })).toBeVisible();

  await openStudio(page, "space-ballroom");
  await page.getByRole("combobox", { name: "Brain" }).click();
  const kimi = page.getByRole("option", { name: /Kimi Code/ });
  await expect(kimi).toHaveAttribute("aria-disabled", "true");
  await expect(kimi).toContainText("Run Test first");
  await expect(page.getByRole("option", { name: /Claude Code/ })).not.toHaveAttribute("aria-disabled", "true");
  await settled(page);
  await page.screenshot({ path: proof("FX-R2-studio-picker.png") });
});
