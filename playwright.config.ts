import { defineConfig, devices } from "@playwright/test";

/**
 * STR Platform — Playwright config
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./tests/e2e/results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { outputFolder: "tests/e2e/report" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Pass STR_TEST_MODE explicitly in the webServer command to guarantee
  // the dev server sees it. The CI job env should be inherited, but
  // explicit is better than implicit.
  webServer: process.env.CI
    ? {
        command: `STR_TEST_MODE=${process.env.STR_TEST_MODE ?? "0"} bun run dev`,
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : undefined,
});
