import { test, expect } from "@playwright/test";

/**
 * STR G03-E2E-ROOT — Login Diagnostic Tests
 *
 * Independent tests that verify each institutional account can sign in.
 * If these fail, the root cause is clear (account doesn't exist or
 * password doesn't match). If these pass, the full E2E flow can proceed.
 *
 * Run: bunx playwright test g03-login-diagnostic
 */

const ACCOUNTS = [
  { email: "reviewer@str.platform.local", password: "ReviewerPass123!", name: "Reviewer" },
  { email: "steward@str.platform.local", password: "StewardPass123!", name: "Steward" },
  { email: "member@str.platform.local", password: "MemberPass123!", name: "Member" },
];

for (const account of ACCOUNTS) {
  test(`login diagnostic: ${account.name} can sign in`, async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/auth/signin");
    await page.fill('[name="email"]', account.email);
    await page.fill('[name="password"]', account.password);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard (30s timeout for CI).
    try {
      await page.waitForURL(/\/dashboard/, { timeout: 30000 });
      // Success — verify the dashboard page loaded.
      await expect(page.locator("body")).toBeVisible();
      console.log(`[DIAG] ${account.name} login: SUCCESS (URL: ${page.url()})`);
    } catch (e) {
      // Failure — capture diagnostic info.
      const url = page.url();
      const bodyText = await page.locator("body").textContent();
      console.error(`[DIAG] ${account.name} login: FAILED`);
      console.error(`[DIAG] Current URL: ${url}`);
      console.error(`[DIAG] Body text preview: ${bodyText?.substring(0, 500)}`);
      throw e;
    }
  });
}
