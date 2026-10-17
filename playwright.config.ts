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
  // The CI job-level env (in .github/workflows/ci.yml) sets STR_TEST_MODE=1,
  // so the web server inherits it. We don't prefix the command here to avoid
  // shell-quoting issues. The dev server reads STR_TEST_MODE from process.env.
  webServer: process.env.CI
    ? {
        command: "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : undefined,
});
