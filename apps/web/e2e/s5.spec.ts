import { expect, test, type Locator, type Page } from "@playwright/test";

import { holdMock, mockReady, proof, settled } from "./helpers";

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

  // Installing restarts nothing; skip the 10 s per-backend cooldown the failed test started.
  await page.evaluate(() => {
    window.__vvMock.install("copilot");
    window.__vvMock.clearTests();
  });
  await copilot.getByRole("button", { name: "Test chat" }).click();
  await expect(copilot.getByTestId("test-result")).toContainText(/Passed in [\d.]+ s/);
  await expect(pill(copilot)).toHaveText("Chat: Ready · Images: Likely");
});

test("S5: image tests ask before using credits; free engines test straight away", async ({ page }) => {
  const imagePosts: string[] = [];
  await page.route("**/api/system/backends/engine/*/test", async (route) => {
    if (route.request().method() === "POST") imagePosts.push(route.request().url());
    await route.continue();
  });
  await page.goto("/setup?vvScenario=ready");
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.clearTests());
  await page.reload();
  await mockReady(page);
  // This suite uses the in-browser API mock, so watch its test calls as well as real POSTs.
  const testCall = await holdMock(page, "testBackend");
  const copilot = card(page, "GitHub Copilot");
  await expect(pill(copilot)).toHaveText("Unknown");

  await copilot.getByRole("button", { name: "Test images" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(/credits/i);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(copilot.getByTestId("test-result")).toHaveCount(0);
  expect(await page.evaluate(() => window.__vvMock.waiting("testBackend"))).toBe(0);
  expect(imagePosts).toEqual([]);

  await copilot.getByRole("button", { name: "Test images" }).click();
  await settled(page);
  await page.screenshot({ path: proof("S5-credit-warning.png") });
  await confirm.getByRole("button", { name: "Use credits and test" }).click();
  await testCall.reached();
  await testCall.release();
  await expect(copilot.getByTestId("test-result")).toContainText(/Passed in [\d.]+ s/);
  await expect(copilot.getByRole("img", { name: /test image/i })).toBeVisible();

  const flux = card(page, "Local FLUX (mflux)");
  await flux.getByRole("button", { name: "Test images" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(flux.getByTestId("test-result")).toContainText(/Passed in [\d.]+ s/);
});

test("RV7: a passing chat test does not mark images ready at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/setup?vvScenario=signed-out");
  const copilot = card(page, "GitHub Copilot");
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.install("copilot"));
  await copilot.getByRole("button", { name: "Test chat" }).click();
  await expect(copilot.getByTestId("test-result")).toContainText("Chat test: Passed");
  await expect(pill(copilot)).toHaveText("Chat: Ready · Images: Likely");
  expect(await copilot.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(375);
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

test("S5: rate-limited tests say when to try again, and Test waits until then", async ({ page }) => {
  await page.goto("/setup?vvScenario=ready");
  const copilot = card(page, "GitHub Copilot");
  const chat = copilot.getByRole("button", { name: "Test chat" });
  const images = copilot.getByRole("button", { name: "Test images" });
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.clearTests());
  await page.reload();
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.rateLimitTests(4));
  await chat.click();

  const wait = copilot.getByTestId("retry-after");
  await expect(wait).toContainText(/Try again in \d+ s/);
  const secondsLeft = async () => Number(/Try again in (\d+) s/.exec((await wait.textContent()) ?? "")?.[1] ?? NaN);
  const first = await secondsLeft();
  expect(first).toBeGreaterThanOrEqual(1);
  expect(first).toBeLessThanOrEqual(4);
  await expect(chat).toBeDisabled();
  await expect(images).toBeDisabled();
  await expect(copilot.getByTestId("test-result")).toHaveCount(0);
  await settled(page);
  await copilot.screenshot({ path: proof("S5-test-rate-limited.png") });

  // It counts down, then Test works again.
  await expect.poll(secondsLeft).toBeLessThan(first);
  await expect(chat).toBeEnabled();
  await expect(wait).toHaveCount(0);
  await chat.click();
  await expect(copilot.getByTestId("test-result")).toContainText(/Passed in [\d.]+ s/);
});

test("S5: phone access is off by default: no toggle, just the restart command and why pairing is needed", async ({ page }) => {
  await page.goto("/setup");
  const phone = page.getByRole("region", { name: "Open on your phone" });
  await expect(phone).toContainText(/Phone access is off/);
  await expect(phone.getByRole("switch")).toHaveCount(0);
  await expect(phone.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText(/Allow phones on this Wi.?Fi/i)).toHaveCount(0);
  await expect(phone).toContainText(/anyone on the same Wi.?Fi could try to connect/i);
  await expect(phone).toContainText(/pairing code/i);
  await expect(phone.getByTestId("lan-command")).toHaveText("make dev-lan");
  await phone.getByRole("button", { name: "Copy start command" }).click();
  await expect(phone.getByRole("button", { name: "Copied start command" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("make dev-lan");
  await expect(phone.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  await expect(phone.getByTestId("pairing-code")).toHaveCount(0);
  await expect(phone.getByRole("region", { name: "Paired phones" })).toContainText(/No phones are paired/);
  expect((await page.evaluate(() => window.__vvMock.settings())).lan.enabled).toBe(false);
  await settled(page);
  await phone.screenshot({ path: proof("S5-phone-access-off.png") });
});

test("S5: Open on your phone shows the QR code, address and a one-time code; New code replaces it; /pair accepts only the newest", async ({ page }) => {
  await page.goto("/setup");
  await mockReady(page);
  // Like restarting the app with `make dev-lan`.
  await page.evaluate(() => window.__vvMock.setLan(true));
  await page.reload();
  const phone = page.getByRole("region", { name: "Open on your phone" });
  await expect(phone.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expect(phone.getByRole("switch")).toHaveCount(0);
  await expect(phone.getByTestId("lan-url")).toHaveText(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+/);
  await expect(phone).toContainText(/works once/i);
  await expect(phone.getByTestId("pairing-expiry")).toHaveText(/^Expires in (10:00|9:[0-5]\d)$/);
  await expect(phone).toContainText(/anyone on the same Wi.?Fi could try to connect/i);
  const pairingCode = async () => (await phone.getByTestId("pairing-code").textContent())?.replace(/\s/g, "") ?? "";
  const old = await pairingCode();
  expect(old).toMatch(/^\d{6}$/);

  await phone.getByRole("button", { name: "New code" }).click();
  await expect.poll(pairingCode).not.toBe(old);
  const code = await pairingCode();
  expect(code).toMatch(/^\d{6}$/);
  await settled(page);
  await phone.screenshot({ path: proof("S5-open-on-phone.png") });

  await page.goto("/pair");
  const input = page.getByLabel("Pairing code");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  // Scoped to main: Next's route announcer is also role=alert.
  const alert = page.getByRole("main").getByRole("alert");
  // The code New code replaced no longer works.
  await input.fill(old);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(alert).toContainText(/Incorrect pairing code/i);
  await input.fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(/paired/i);
  await expect(page.getByRole("link", { name: "Open Venue Visualizer" })).toHaveAttribute("href", "/");

  // One-time: the same code can't pair a second phone.
  await page.goto("/pair");
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(alert).toContainText(/No pairing code is active/i);
});

test("S5: paired phones are listed and can be forgotten one by one or all at once", async ({ page }) => {
  await page.goto("/setup");
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.setLan(true));
  await page.reload();
  const phone = page.getByRole("region", { name: "Open on your phone" });
  const paired = phone.getByRole("region", { name: "Paired phones" });
  await expect(paired).toContainText(/No phones are paired/);
  await expect(paired.getByRole("button", { name: "Forget all phones" })).toHaveCount(0);

  // Pair two phones through /pair, each with the code the computer shows at that moment.
  for (let i = 0; i < 2; i++) {
    await page.goto("/setup");
    await expect(phone.getByTestId("pairing-code")).toBeVisible();
    const code = (await phone.getByTestId("pairing-code").textContent())?.replace(/\s/g, "") ?? "";
    expect(code).toMatch(/^\d{6}$/);
    await page.goto("/pair");
    await page.getByLabel("Pairing code").fill(code);
    await page.getByRole("button", { name: "Pair" }).click();
    await expect(page.getByRole("main").getByRole("status")).toContainText(/paired/i);
  }

  await page.goto("/setup");
  const items = paired.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText(/Paired/);
  await expect(items.first()).toContainText(/Last seen/);
  await settled(page);
  await phone.screenshot({ path: proof("S5-paired-phones.png") });

  await items.first().getByRole("button", { name: /^Forget/ }).click();
  await expect(items).toHaveCount(1);

  // Forget all asks first.
  await paired.getByRole("button", { name: "Forget all phones" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(/new pairing code/i);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(items).toHaveCount(1);
  await paired.getByRole("button", { name: "Forget all phones" }).click();
  await settled(page);
  await page.screenshot({ path: proof("S5-forget-all-confirm.png") });
  await confirm.getByRole("button", { name: "Forget all" }).click();
  await expect(paired).toContainText(/No phones are paired/);
  await expect(items).toHaveCount(0);
  expect(await page.evaluate(() => window.__vvMock.lanDevices())).toEqual([]);
});
