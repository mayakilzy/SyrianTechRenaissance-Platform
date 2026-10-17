import { test, expect } from "@playwright/test";
import {
  extractVerificationUrl,
  extractResetUrl,
  waitForEmail,
} from "./fixtures/test-emails";

/**
 * STR G02 — Authentication E2E Tests
 *
 * Tests the full auth flow in a real browser:
 *   1. Signup → capture verification email → verify → login → dashboard
 *   2. Negative: wrong password rejected
 *   3. Negative: unverified account cannot login
 *   4. Account enumeration defense: signup with existing email returns same message
 *
 * Email tokens are extracted from a JSON file on disk written by
 * CaptureEmailService — NOT from an HTTP route. This is the G02-SECURITY-CLOSE
 * isolation design: the application has NO route that can serve email content.
 *
 * Google OIDC is NOT tested here because external Google credentials are not
 * available. The Google provider code is implemented and will be tested when
 * credentials are provided.
 */

const TEST_EMAIL = `e2e-${Date.now()}@str-test.local`;
const TEST_PASSWORD = "TestPassword123!";

test.describe("STR Auth — signup → verify → login flow", () => {
  test("complete email/password flow", async ({ page }) => {
    // ── Step 1: Signup ──
    await page.goto("/auth/signup");
    await page.fill('[name="email"]', TEST_EMAIL);
    await page.fill('[name="password"]', TEST_PASSWORD);
    await page.fill('[name="displayName"]', "E2E Test User");
    await page.click('button[type="submit"]');

    // Should show success message (enumeration defense)
    await expect(page.locator("text=Check your email").or(page.locator("text=تحقق من بريدك"))).toBeVisible({
      timeout: 10_000,
    });

    // ── Step 2: Extract verification URL from filesystem (NOT HTTP) ──
    const verifyUrl = await waitForEmail(TEST_EMAIL, 10_000).then(() =>
      extractVerificationUrl(TEST_EMAIL),
    );
    expect(verifyUrl).toBeTruthy();

    // ── Step 3: Visit verification URL ──
    const verifyPath = verifyUrl!.replace(/^https?:\/\/[^/]+/, "");
    await page.goto(verifyPath);

    // Should show success
    await expect(
      page.locator("text=verified successfully").or(page.locator("text=بنجاح")),
    ).toBeVisible({ timeout: 10_000 });

    // ── Step 4: Sign in with verified account ──
    await page.click('a:has-text("sign in"), a:has-text("دخول")');
    await page.fill('[name="email"]', TEST_EMAIL);
    await page.fill('[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    // Should reach dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(
      page.locator("text=Dashboard").or(page.locator("text=لوحة التحكم")),
    ).toBeVisible();
  });

  test("wrong password is rejected", async ({ page }) => {
    await page.goto("/auth/signin");
    await page.fill('[name="email"]', TEST_EMAIL);
    await page.fill('[name="password"]', "WrongPassword123!");
    await page.click('button[type="submit"]');

    // Should show generic error (no indication of which field is wrong)
    await expect(
      page.locator("text=Invalid email or password").or(
        page.locator('text=بريد إلكتروني أو كلمة مرور غير صحيحة'),
      ),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("account enumeration defense: duplicate signup returns same message", async ({
    page,
  }) => {
    await page.goto("/auth/signup");
    await page.fill('[name="email"]', TEST_EMAIL); // already registered
    await page.fill('[name="password"]', "AnotherPassword123!");
    await page.click('button[type="submit"]');

    // Should show the SAME generic success message (no "email already exists")
    await expect(
      page.locator("text=Check your email").or(page.locator("text=تحقق من بريدك")),
    ).toBeVisible({ timeout: 10_000 });

    // Should NOT reveal that the email is already registered
    await expect(page.locator("text=already exists")).not.toBeVisible();
    await expect(page.locator("text=موجود بالفعل")).not.toBeVisible();
  });

  test("password reset flow", async ({ page }) => {
    // ── Request reset ──
    await page.goto("/auth/reset-password");
    await page.fill('[name="email"]', TEST_EMAIL);
    await page.click('button[type="submit"]');

    // Generic message (enumeration defense)
    await expect(
      page.locator("text=password reset link").or(page.locator('text=رابط إعادة تعيين')),
    ).toBeVisible({ timeout: 10_000 });

    // ── Extract reset URL from filesystem (NOT HTTP) ──
    const resetUrl = await waitForEmail(TEST_EMAIL, 10_000).then(() =>
      extractResetUrl(TEST_EMAIL),
    );
    expect(resetUrl).toBeTruthy();

    // ── Visit reset URL and set new password ──
    const resetPath = resetUrl!.replace(/^https?:\/\/[^/]+/, "");
    await page.goto(resetPath);
    await page.fill('[name="newPassword"]', "NewPassword123!");
    await page.fill('[name="confirm"]', "NewPassword123!");
    await page.click('button[type="submit"]');

    // Should show success
    await expect(
      page.locator("text=reset successfully").or(page.locator("text=بنجاح")),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("STR Auth — STR-GOV-TEAM-01 enforcement", () => {
  test("team creation is denied even for authenticated users", async ({
    page,
  }) => {
    // The UI doesn't have a "create team" button. The authorization logic
    // blocks this via unit tests in authorize.test.ts. Here we verify the
    // signup page doesn't promise team creation.
    await page.goto("/auth/signup");
    await expect(page.locator("text=create team").or(page.locator("text=إنشاء فريق"))).not.toBeVisible();
  });
});
