import { defineConfig, devices } from "@playwright/test";

const PORT = 3300;

/** End-to-end tests run against the in-browser mock API (`NEXT_PUBLIC_VV_MOCK=1`), so no backend is needed. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      grepInvert: /@mobile/,
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      // Only the layout checks (UT1) have a phone variant, tagged `@mobile`.
      grep: /@mobile/,
    },
  ],
  webServer: {
    // `pnpm dev` loads the API attestation shim; the server listens on 127.0.0.1 only.
    command: `NEXT_PUBLIC_VV_MOCK=1 pnpm dev --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
