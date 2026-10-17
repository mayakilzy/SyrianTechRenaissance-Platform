import { defineConfig, devices } from "@playwright/test";

/**
 * STR Platform — Playwright config
 * Verifies real browser behavior for both Arabic (RTL) and English (LTR).
 * Screenshots are saved to tests/e2e/screenshots/ as G01 acceptance evidence.
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
  // The dev server is managed externally by the sandbox (see fullstack-dev skill).
  // For CI, Playwright starts its own web server with NODE_ENV=test so that
  // the /api/test/last-email route is enabled for E2E token extraction.
  // In production builds, that route is gated and returns 404 (verified by
  // the security-negative.spec.ts test).
  webServer: process.env.CI
    ? {
        command: "STR_TEST_MODE=1 bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : undefined,
});
