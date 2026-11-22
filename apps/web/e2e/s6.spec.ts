import { expect, test } from "@playwright/test";

import { openStudio, proof, settled } from "./helpers";

// S6 (docs/onboarding-and-mobile.md): completing setup (choose defaults) sets `setup_completed_at`; `/` then shows
// the landing; the header chip says ready; Studio pickers default to the chosen backends and list only ready ones.

test("S6: choosing defaults finishes setup, and the app then uses them", async ({ page }) => {
  await page.goto("/?vvScenario=ready");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("link", { name: /Set up AI/ })).toHaveAttribute("href", "/setup");

  const defaults = page.getByRole("region", { name: "Choose your defaults" });
  const brains = defaults.getByRole("radiogroup", { name: "Default brain" });
  const engines = defaults.getByRole("radiogroup", { name: "Default image engine" });
  // Only ready tools are offered; the recommended one is preselected.
  await expect(brains.getByRole("radio")).toHaveCount(2);
  await expect(brains.getByRole("radio", { name: /Claude Code/ })).toBeChecked();
  await expect(brains.getByRole("radio", { name: /Copilot/ })).not.toBeChecked();
  await expect(brains.getByRole("radio", { name: /Kimi/ })).toHaveCount(0);
  await expect(brains.getByRole("radio", { name: /Codex/ })).toHaveCount(0);
  await expect(engines.getByRole("radio")).toHaveCount(2);
  await expect(engines.getByRole("radio", { name: /Copilot/ })).toBeChecked();
  await expect(defaults.getByText("Recommended").first()).toBeVisible();

  await brains.getByRole("radio", { name: /Copilot/ }).click();
  await engines.getByRole("radio", { name: /Local FLUX/ }).click();
  await defaults.getByRole("switch", { name: /web research/i }).click();
  await settled(page);
  await defaults.screenshot({ path: proof("S6-defaults.png") });
  await defaults.getByRole("button", { name: "Finish setup" }).click();

  const tryIt = page.getByRole("region", { name: "Try it" });
  await expect(tryIt.getByRole("link", { name: /Open the demo venue/ })).toBeVisible();
  await expect(tryIt.getByRole("link", { name: "Add my venue" })).toHaveAttribute("href", "/venues/new");
  const saved = await page.evaluate(() => window.__vvMock.settings());
  expect(saved.setup_completed_at).not.toBeNull();
  expect(saved).toMatchObject({ default_brain: "copilot", default_engine: "mflux", allow_web_research: false });

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const chip = page.getByRole("link", { name: /AI ready/ });
  await expect(chip).toContainText("Copilot + Local FLUX");
  await expect(chip).toHaveAttribute("href", "/setup");
  await settled(page);
  await page.screenshot({ path: proof("S6-landing-ready-chip.png") });

  await openStudio(page, "space-ballroom");
  await expect(page.getByRole("combobox", { name: "Brain" })).toContainText("Copilot");
  const engine = page.getByRole("combobox", { name: "Engine" });
  await expect(engine).toContainText("Local FLUX");
  await engine.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option", { name: /Codex/ })).toHaveCount(0);
  await settled(page);
  await page.screenshot({ path: proof("S6-studio-ready-pickers.png") });
  await page.keyboard.press("Escape");
});

test("S6: a chosen engine that stops working is explained, with a link to setup", async ({ page }) => {
  await page.goto("/setup?vvScenario=ready");
  const defaults = page.getByRole("region", { name: "Choose your defaults" });
  await defaults.getByRole("radiogroup", { name: "Default image engine" }).getByRole("radio", { name: /Local FLUX/ }).click();
  await defaults.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("region", { name: "Try it" }).getByRole("link", { name: /Open the demo venue/ })).toBeVisible();

  await page.evaluate(() => window.__vvMock.install("mflux", "missing"));
  await openStudio(page, "space-ballroom");
  const notice = page.getByRole("status").filter({ hasText: /Local FLUX \(mflux\) isn.t ready/ });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "Open setup" })).toHaveAttribute("href", "/setup");
  // Renders still go to a ready engine instead of failing with a raw error.
  await expect(page.getByRole("combobox", { name: "Engine" })).toContainText("Copilot image");
  await settled(page);
  await page.screenshot({ path: proof("S6-engine-unavailable.png") });
});
