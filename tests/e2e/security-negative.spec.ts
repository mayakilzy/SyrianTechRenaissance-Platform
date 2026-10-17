import { test, expect } from "@playwright/test";

/**
 * STR G02-SECURITY-CLOSE — Security Negative Tests
 *
 * Verifies that:
 *   1. There is NO HTTP route for extracting email tokens in the application
 *   2. STR-GOV-TEAM-01 is enforced (no team creation UI)
 *
 * The test-emails fixture reads from the filesystem (NOT an HTTP route), so
 * there is no /api/test/last-email endpoint to leak tokens. This test
 * confirms the route returns 404 even when STR_TEST_MODE=1 is set, proving
 * the route does not exist in the application.
 *
 * See G02-SECURITY-CLOSE §6 (negative test for route absence).
 */

test.describe("Security — no email-token extraction route in the app", () => {
  test("/api/test/last-email does not exist (returns 404)", async ({
    request,
  }) => {
    // Even with STR_TEST_MODE=1 set in the CI environment, this route
    // must NOT exist. The application has no HTTP route for email tokens.
    const res = await request.get("/api/test/last-email", {
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(404);

    // CRITICAL: no email content should be in the response body.
    const body = await res.text();
    expect(body).not.toContain("tokenUrl");
    expect(body).not.toContain("textBody");
    expect(body).not.toContain("verification");
  });

  test("/api/test/ does not exist as a route prefix", async ({
    request,
  }) => {
    // The entire /api/test/ directory was removed. Any path under it
    // should return 404.
    const res = await request.get("/api/test/anything", {
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Security — STR-GOV-TEAM-01 enforcement (UI)", () => {
  test("signup page does not advertise team creation", async ({ page }) => {
    await page.goto("/auth/signup");
    await expect(page.locator("text=create team")).not.toBeVisible();
    await expect(page.locator("text=إنشاء فريق")).not.toBeVisible();
  });

  test("signin page does not advertise team creation", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page.locator("text=create team")).not.toBeVisible();
    await expect(page.locator("text=إنشاء فريق")).not.toBeVisible();
  });
});
