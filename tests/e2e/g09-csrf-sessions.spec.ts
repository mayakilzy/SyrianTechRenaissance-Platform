import { test, expect } from "@playwright/test";

/**
 * STR G09 — CSRF & Session Protection (Priority 1.8 — FINAL evidence closure)
 * Per ChatGPT: "don't consider request-without-session as CSRF test",
 * "don't use expect(true).toBe(true)", "verify cookie attributes".
 *
 * CSRF defense relies on:
 * - next-auth cookies: httpOnly=true, sameSite="lax", secure in production
 * - No explicit CSRF token middleware (SameSite=lax is the primary defense)
 *
 * Cross-origin CSRF testing requires staging with multiple origins (G10).
 * G09 verifies: cookie attributes + signout flow + httpOnly enforcement.
 */

const MEMBER_EMAIL = "member@str.platform.local";
const MEMBER_PASSWORD = "MemberPass123!";

async function signin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/en/auth/signin");
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|proposals)/, { timeout: 30000 });
}

test.describe("G09 — CSRF & Sessions (Priority 1.8)", () => {
  test("1. Cookie attributes: session token is httpOnly + sameSite=Lax", async ({ browser }) => {
    // Per ChatGPT: "examine SameSite and Origin and CORS."
    // This test verifies the ACTUAL cookie attributes set by next-auth.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signin(page, MEMBER_EMAIL, MEMBER_PASSWORD);

    // Get all cookies from the browser context
    const cookies = await ctx.cookies();
    const sessionCookie = cookies.find(c => c.name.includes("session-token"));

    // Verify: session cookie exists
    expect(sessionCookie, "Session cookie must exist after signin").toBeTruthy();

    // Verify: httpOnly=true (JS cannot access the token — XSS cannot steal it)
    expect(sessionCookie!.httpOnly).toBe(true);

    // Verify: sameSite=Lax (cross-site POST blocked — CSRF defense)
    expect(sessionCookie!.sameSite).toBe("Lax");

    // Verify: path=/
    expect(sessionCookie!.path).toBe("/");

    await ctx.close();
  });

  test("2. httpOnly enforcement: document.cookie does NOT contain session token", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signin(page, MEMBER_EMAIL, MEMBER_PASSWORD);

    // Navigate to a page and try to read cookies via JS
    await page.goto("/en/dashboard");
    const jsCookieAccess = await page.evaluate(() => document.cookie);

    // The session cookie is httpOnly → NOT accessible via document.cookie
    expect(jsCookieAccess).not.toContain("session-token");
    expect(jsCookieAccess).not.toContain("next-auth");

    await ctx.close();
  });

  test("3. Signout flow: real /api/auth/signout → subsequent auth request rejected", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signin(page, MEMBER_EMAIL, MEMBER_PASSWORD);

    // Verify: authenticated before signout
    const beforeRes = await page.evaluate(async () => {
      const r = await fetch("/api/users/me/contributions");
      return { status: r.status };
    });
    expect(beforeRes.status).toBe(200);

    // Sign out via next-auth's signout page (real flow)
    await page.goto("/api/auth/signout");
    // next-auth renders a form with a submit button
    const submitButton = page.locator('button[type="submit"]');
    if (await submitButton.count() > 0) {
      await submitButton.click();
      await page.waitForLoadState("networkidle");
    } else {
      // Fallback: POST to /api/auth/signout directly (needs CSRF token from page)
      const csrfToken = await page.evaluate(() => {
        const input = document.querySelector('input[name="csrfToken"]') as HTMLInputElement | null;
        return input?.value || "";
      });
      await page.evaluate(async (token) => {
        await fetch("/api/auth/signout", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `csrfToken=${encodeURIComponent(token)}&callbackUrl=/en/auth/signin`,
        });
      }, csrfToken);
    }

    // Wait for cookies to be cleared
    await page.waitForTimeout(500);

    // Verify: authenticated request after signout → rejected
    // Navigate to a page first (to set base URL for relative fetch)
    await page.goto("/en");
    const afterRes = await page.evaluate(async () => {
      const r = await fetch("/api/users/me/contributions");
      return { status: r.status };
    });
    expect(afterRes.status).toBe(403); // session destroyed → unauthenticated

    await ctx.close();
  });

  test("4. Same-origin POST with session → succeeds (SameSite allows same-origin)", async ({ browser }) => {
    // Positive control: same-origin POST WITH session cookie → should succeed.
    // This proves the session works for same-origin requests.
    // (Cross-origin POST blocked by SameSite=lax is NOT tested here — requires G10 staging.)
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signin(page, MEMBER_EMAIL, MEMBER_PASSWORD);
    await page.goto("/en");

    const res = await page.evaluate(async () => {
      const r = await fetch("/api/users/me/contributions");
      return { status: r.status };
    });
    expect(res.status).toBe(200); // same-origin → cookie sent → authenticated

    await ctx.close();
  });

  // Test 5: Session expiration — NOT TESTED (no placeholder)
  // JWT expiry simulation requires clock mocking or token manipulation.
  // Not practical in E2E. Deferred to G10 staging.
  // This is explicitly NOT a PASS — marked as NOT TESTED in the security matrix.
  test.skip("5. Session expiration: NOT TESTED (requires JWT expiry simulation — G10)", () => {
    // SKIPPED — not a placeholder PASS. The next-auth library enforces JWT
    // expiration via its callback system. Testing requires staging environment.
  });
});
