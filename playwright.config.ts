import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Base URL: E2E_BASE_URL (e.g. a deployed preview) or the local Vite dev server.
const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl || "http://localhost:5173";

// Browser: an explicit PW_CHROMIUM_PATH, else a preinstalled Chromium at /opt/pw-browsers/chromium,
// else whatever `npx playwright install chromium` put in the default cache.
const preinstalled = "/opt/pw-browsers/chromium";
const executablePath = process.env.PW_CHROMIUM_PATH || (existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} } },
  ],
  webServer: externalBaseUrl
    ? undefined
    : { command: "npm run dev", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
