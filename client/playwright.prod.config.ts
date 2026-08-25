import { defineConfig, devices } from "@playwright/test";

/**
 * Config for the PRODUCTION purchase spec (tests-prod/). No local webServer —
 * it drives the deployed site directly.
 *
 *   cd client && npx playwright test --config playwright.prod.config.ts
 */

export default defineConfig({
  testDir: "./tests-prod",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PROD_URL ?? "https://18-227-229-244.sslip.io",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
