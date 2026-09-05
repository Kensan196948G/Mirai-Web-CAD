import { defineConfig, devices } from "@playwright/test";

const accessHeaders =
  process.env.E2E_CF_ACCESS_CLIENT_ID && process.env.E2E_CF_ACCESS_CLIENT_SECRET
    ? {
        "CF-Access-Client-Id": process.env.E2E_CF_ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": process.env.E2E_CF_ACCESS_CLIENT_SECRET
      }
    : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: process.env.E2E_BASE_URL ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4174",
    extraHTTPHeaders: accessHeaders,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } }
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:4174/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000
      }
});
