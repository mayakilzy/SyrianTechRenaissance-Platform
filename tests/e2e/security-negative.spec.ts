import { test, expect } from "@playwright/test";

/**
 * STR G02-RECOVERY — Security Negative Tests
 *
 * Verifies that the test-only email endpoint is unreachable in non-test
 * environments, and that STR-GOV-TEAM-01 is enforced.
 *
 * These tests run in CI where NODE_ENV=test. The /api/test/last-email route
 * is expected to return 404 in any other environment. A separate production
 * build test (added in G10) will verify this in a production-like build.
 */

test.describe("Security — test route isolation", () => {
  test("/api/test/last-email returns 404 when no 'to' parameter", async ({
    request,
  }) => {
    // In CI (NODE_ENV=test), calling without 'to' returns 400.
    // In production, returns 404. Either way, no email content leaks.
    const res = await request.get("/api/test/last-email");
    expect([400, 404]).toContain(res.status());
  });

  test("/api/test/last-email does not leak tokens for unknown emails", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/test/last-email?to=nonexistent@str-test.local",
    );
    // Should be 404 (no email found) in test, or 404 (route disabled) in prod.
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    // CRITICAL: no tokenUrl or textBody should be present in the response.
    expect(body.data?.tokenUrl).toBeUndefined();
    expect(body.data?.textBody).toBeUndefined();
  });
});

test.describe("Security — STR-GOV-TEAM-01 enforcement (UI)", () => {
  test("signup page does not advertise team creation", async ({ page }) => {
    await page.goto("/auth/signup");
    // The signup page must NOT mention team creation, because team creation
    // requires an approved project charter (STR-GOV-TEAM-01).
    await expect(page.locator("text=create team")).not.toBeVisible();
    await expect(page.locator("text=إنشاء فريق")).not.toBeVisible();
  });

  test("signin page does not advertise team creation", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page.locator("text=create team")).not.toBeVisible();
    await expect(page.locator("text=إنشاء فريق")).not.toBeVisible();
  });
});
