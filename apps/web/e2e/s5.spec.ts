import { expect, test, type Locator, type Page } from "@playwright/test";

import { proof, settled } from "./helpers";

// S5 (docs/onboarding-and-mobile.md): a fresh install is sent to /setup, sees "Not installed" with copyable
// commands, and Check again reflects a newly installed tool. Also covers the rest of Step 1 (Test, Advanced)
// and Setup → Advanced → Open on your phone.

const PROVIDERS = ["Claude Code", "Codex", "GitHub Copilot", "Kimi Code", "Local FLUX (mflux)"];
const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const pill = (c: Locator) => c.getByTestId("status-pill");

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("S5: a fresh install is sent to /setup and sees what to install, with copyable commands", async ({ page }) => {
  await page.goto("/?vvScenario=fresh");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up your AI tools");
  // Plain-English explanations of the two kinds of tool.
  await expect(page.getByText(/The brain is the AI you chat with/)).toBeVisible();
  await expect(page.getByText(/The image engine paints/)).toBeVisible();

  for (const name of PROVIDERS) {
    const c = card(page, name);
    await expect(pill(c), `${name} is reported as missing`).toHaveText("Not installed");
    await expect(c.getByRole("list", { name: "Used for" }).getByRole("listitem").first()).toBeVisible();
    await expect(c.getByTestId("cost-note")).not.toBeEmpty();
  }

  const claude = card(page, "Claude Code");
  for (const which of ["install", "sign-in"] as const) {
    const command = (await claude.getByTestId(`${which}-command`).textContent())?.trim() ?? "";
    expect(command, `the ${which} command`).toContain("claude");
    await claude.getByRole("button", { name: `Copy ${which} command` }).click();
    await expect(claude.getByRole("button", { name: `Copied ${which} command` })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  }
  await settled(page);
  await page.screenshot({ path: proof("S5-fresh-setup.png"), fullPage: true });

  // The user runs the install and sign-in commands in a terminal; nothing changes until the app re-detects.
  await page.evaluate(() => window.__vvMock.install("claude"));
  await expect(pill(claude)).toHaveText("Not installed");
  await claude.getByRole("button", { name: "Check again" }).click();
  await expect(pill(claude)).toHaveText("Ready");
  await expect(pill(card(page, "Codex"))).toHaveText("Not installed");
  await settled(page);
  await claude.screenshot({ path: proof("S5-check-again-ready.png") });
});

test("S5: unfinished setup redirects every app route, except setup, pairing and the render scene", async ({ page }) => {
  await page.goto("/venues?vvScenario=fresh");
  await expect(page).toHaveURL(/\/setup$/);
  await page.goto("/spaces/space-ballroom");
  await expect(page).toHaveURL(/\/setup$/);
  await page.goto("/pair");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pair this phone");
  await expect(page).toHaveURL(/\/pair$/);
  await page.goto("/render/scene");
  await expect(page).toHaveURL(/\/render\/scene$/);
  // The demo scenario counts as set up.
  await page.goto("/venues?vvScenario=demo");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Venues/);
  await expect(page).toHaveURL(/\/venues$/);
});

test("S5: installed but signed out shows the sign-in step; Test tells unknown from ready", async ({ page }) => {
  await page.goto("/setup?vvScenario=signed-out");
  const claude = card(page, "Claude Code");
  await expect(pill(claude)).toHaveText("Installed, not signed in");
  await expect(claude.getByTestId("sign-in-command")).toHaveText(/claude/);

  const copilot = card(page, "GitHub Copilot");
  await expect(pill(copilot)).toHaveText("Unknown");
  await expect(copilot).toContainText(/can.t tell/i);
  await copilot.getByRole("button", { name: "Test chat" }).click();
  await expect(copilot.getByTestId("test-result")).toContainText(/Failed/);
  await expect(copilot.getByTestId("test-result")).toContainText(/sign/i);

  await page.evaluate(() => window.__vvMock.install("copilot"));
  await copilot.getByRole("button", { name: "Test chat" }).click();
  await expect(copilot.getByTestId("test-result")).toContainText(/Passed in [\d.]+ s/);
  await expect(pill(copilot)).toHaveText("Ready");
});

test("S5: image tests ask before using credits; free engines test straight away", async ({ page }) => {
  await page.goto("/setup?vvScenario=ready");
  const copilot = card(page, "GitHub Copilot");
  await expect(pill(copilot)).toHaveText(/Ready|Unknown/);

  await copilot.getByRole("button", { name: "Test images" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(/credits/i);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(copilot.getByTestId("test-result")).toHaveCount(0);

  await copilot.getByRole("button", { name: "Test images" }).click();
  await settled(page);
  await page.screenshot({ path: proof("S5-credit-warning.png") });
  await confirm.getByRole("button", { name: "Use credits and test" }).click();
  await expect(copilot.getByTestId("test-result")).toContainText(/Passed in [\d.]+ s/);
  await expect(copilot.getByRole("img", { name: /test image/i })).toBeVisible();

  const flux = card(page, "Local FLUX (mflux)");
  await flux.getByRole("button", { name: "Test images" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(flux.getByTestId("test-result")).toContainText(/Passed in [\d.]+ s/);
});

test("S5: Advanced keeps per-provider options", async ({ page }) => {
  await page.goto("/setup?vvScenario=ready");
  const claude = card(page, "Claude Code");
  await claude.getByRole("button", { name: "Advanced" }).click();
  await claude.getByLabel("Claude config folder").fill("~/.claude-work");
  await claude.getByRole("button", { name: "Save" }).click();
  const copilot = card(page, "GitHub Copilot");
  await copilot.getByRole("button", { name: "Advanced" }).click();
  await copilot.getByLabel("Copilot chat model").fill("gpt-5");
  await copilot.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__vvMock.settings().providers))
    .toMatchObject({ claude: { config_dir: "~/.claude-work" }, copilot: { model: "gpt-5" } });
  await page.reload();
  await card(page, "Claude Code").getByRole("button", { name: "Advanced" }).click();
  await expect(card(page, "Claude Code").getByLabel("Claude config folder")).toHaveValue("~/.claude-work");
});

test("S5: Open on your phone shows the QR code, address and pairing code; /pair accepts only that code", async ({ page }) => {
  await page.goto("/setup");
  const phone = page.getByRole("region", { name: "Open on your phone" });
  await expect(phone).toContainText(/anyone on the same Wi.?Fi/i);
  await phone.getByRole("switch", { name: /Allow phones on this Wi.?Fi/i }).click();
  await expect(phone.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expect(phone.getByTestId("lan-url")).toHaveText(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+/);
  const code = (await phone.getByTestId("pairing-code").textContent())?.replace(/\s/g, "") ?? "";
  expect(code).toMatch(/^\d{6}$/);
  await settled(page);
  await phone.screenshot({ path: proof("S5-open-on-phone.png") });

  await page.goto("/pair");
  const input = page.getByLabel("Pairing code");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await input.fill(code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Pair" }).click();
  // Scoped to main: Next's route announcer is also role=alert.
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/didn.t match/i);
  await input.fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(/paired/i);
  await expect(page.getByRole("link", { name: "Open Venue Visualizer" })).toHaveAttribute("href", "/");
});
