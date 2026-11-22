import { expect, test, type Page } from "@playwright/test";

import { mockReady, openStudio, proof, settled } from "./helpers";

// S7 (docs/onboarding-and-mobile.md) @mobile: every route at 390×844 has no horizontal overflow, every visible
// interactive element is at least 44 px in one dimension and 24 px in the other, and primary touch targets (buttons
// and tabs) are at least 44×44 px. One screenshot per route.

type Route = { name: string; path: string; ready?: (page: Page) => Promise<void> };

const tab = (name: string) => async (page: Page) => {
  await page.getByRole("tab", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
};
const dialog = (button: string, before?: (page: Page) => Promise<void>) => async (page: Page) => {
  await before?.(page);
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

const ROUTES: Route[] = [
  { name: "home", path: "/" },
  { name: "setup", path: "/setup" },
  {
    name: "setup-advanced",
    path: "/setup",
    ready: async (page) => {
      await mockReady(page);
      await page.evaluate(() => {
        window.__vvMock.setLan(true);
        window.__vvMock.pairPhone("iPhone (Safari)");
      });
      await page.reload();
      await page.getByRole("region", { name: "Claude Code", exact: true }).getByRole("button", { name: "Advanced" }).click();
      await expect(page.getByTestId("pairing-code")).toBeVisible();
      await expect(page.getByRole("region", { name: "Paired phones" }).getByRole("listitem")).toHaveCount(1);
    },
  },
  {
    name: "setup-forget-all-dialog",
    path: "/setup",
    ready: async (page) => {
      await mockReady(page);
      await page.evaluate(() => window.__vvMock.pairPhone("Pixel 9 (Chrome)"));
      await page.reload();
      await page.getByRole("button", { name: "Forget all phones" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "setup-rate-limited",
    path: "/setup?vvScenario=ready",
    ready: async (page) => {
      await mockReady(page);
      await page.evaluate(() => window.__vvMock.rateLimitTests(60));
      await page.getByRole("region", { name: "Claude Code", exact: true }).getByRole("button", { name: "Test chat" }).click();
      await expect(page.getByTestId("retry-after")).toBeVisible();
    },
  },
  {
    name: "setup-credit-dialog",
    path: "/setup",
    ready: async (page) => {
      await page.getByRole("region", { name: "GitHub Copilot", exact: true }).getByRole("button", { name: "Test images" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  { name: "pair", path: "/pair" },
  { name: "venues", path: "/venues" },
  { name: "venues-new-find", path: "/venues/new?tab=find" },
  { name: "venues-new-upload", path: "/venues/new?tab=upload" },
  { name: "venues-new-video", path: "/venues/new?tab=video" },
  { name: "venues-new-describe", path: "/venues/new?tab=describe" },
  { name: "venue", path: "/venues/venue-larkspur" },
  { name: "venue-edit-dialog", path: "/venues/venue-larkspur", ready: dialog("Edit venue") },
  { name: "venue-add-room-dialog", path: "/venues/venue-larkspur", ready: dialog("Add a room") },
  { name: "studio-photos", path: "/spaces/space-ballroom", ready: tab("Photos") },
  { name: "studio-preview", path: "/spaces/space-ballroom", ready: tab("Preview") },
  { name: "studio-chat", path: "/spaces/space-ballroom", ready: tab("Chat") },
  { name: "studio-plan", path: "/spaces/space-ballroom", ready: tab("Plan") },
  { name: "studio-save-look-dialog", path: "/spaces/space-ballroom", ready: dialog("Save as Look", tab("Plan")) },
  { name: "studio-variation-dialog", path: "/spaces/space-ballroom", ready: dialog("Make a variation", tab("Plan")) },
  { name: "studio-describe", path: "/spaces/space-wren-long-room", ready: tab("Photos") },
  { name: "looks", path: "/spaces/space-ballroom/looks" },
  { name: "compare", path: "/compare?a=look-blush&b=look-evergreen" },
  { name: "command-palette", path: "/", ready: dialog("Open command palette") },
];

const INTERACTIVE = [
  "a[href]",
  "button",
  "[role=button]",
  "[role=tab]",
  "[role=switch]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=slider]",
  "[role=combobox]",
  "[role=menuitem]",
  "[role=option]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
].join(",");

async function audit(page: Page) {
  return page.evaluate((selector) => {
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const { width, height } = el.getBoundingClientRect();
      // Visually hidden controls (sr-only file inputs and native inputs behind custom controls) aren't touched.
      if (width <= 1 || height <= 1) continue;
      const big = Math.max(width, height);
      const small = Math.min(width, height);
      const primary = el.matches("button, [role=button], [role=tab]");
      if (big >= 44 - 0.01 && small >= (primary ? 44 : 24) - 0.01) continue;
      const role = el.getAttribute("role");
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("placeholder") ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
      offenders.push(`${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""} "${name}" ${width.toFixed(1)}×${height.toFixed(1)}`);
    }
    return {
      offenders,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  }, INTERACTIVE);
}

for (const route of ROUTES) {
  test(`S7: ${route.name} fits a phone @mobile`, async ({ page }) => {
    if (route.path.startsWith("/spaces/") && !route.path.endsWith("/looks")) await openStudio(page, route.path.slice("/spaces/".length));
    else {
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
    }
    await expect(page.locator("main")).toBeVisible();
    await route.ready?.(page);
    await page.waitForLoadState("networkidle");
    await settled(page);

    const result = await audit(page);
    await page.screenshot({ path: proof(`S7-${route.name}.png`), fullPage: true });
    expect(result.scrollWidth, `${route.name}: no horizontal overflow`).toBeLessThanOrEqual(result.innerWidth);
    expect(result.offenders, `${route.name}: touch targets under 44×24 px (44×44 for buttons and tabs):\n${result.offenders.join("\n")}`).toEqual([]);
  });
}
