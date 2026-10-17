import { defineConfig, devices } from "@playwright/test";

/**
 * STR Platform — Playwright config
 * Verifies real browser behavior for both Arabic (RTL) and English (LTR).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./tests/e2e/results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { outputFolder: "tests/e2e/report" }]] : "list",
  // Clear the test email file before each run for deterministic tests.
  globalSetup: "./tests/e2e/global-setup.ts",
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
  // The dev server is managed externally by the sandbox.
  // For CI, Playwright starts its own web server. STR_TEST_MODE is set at
  // the CI job level (inherited by all child processes) so the app's
  // CaptureEmailService writes to the disk file that the test fixture reads.
  webServer: process.env.CI
    ? {
        command: "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : undefined,
});
