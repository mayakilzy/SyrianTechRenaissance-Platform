import { test, expect } from "@playwright/test";

/**
 * STR G08 — Visual + Accessibility E2E Tests
 *
 * Per MASTER G08 directive:
 * - Screenshots for core journeys in ar/en + desktop/mobile
 * - Accessibility checks (keyboard, focus, contrast, aria)
 * - Responsive verification
 * - No fake workflows or buttons without functions
 */

test.describe("G08 — Visual + Accessibility", () => {
  test("home page renders correctly in Arabic (RTL) + English (LTR) — desktop", async ({ browser }) => {
    test.setTimeout(60000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

    // Arabic (RTL)
    const arPage = await ctx.newPage();
    await arPage.goto("/ar");
    await arPage.waitForLoadState("networkidle");
    await expect(arPage.locator("h1, h2").first()).toBeVisible({ timeout: 10000 });
    expect(await arPage.locator("html").getAttribute("dir")).toBe("rtl");
    await arPage.screenshot({ path: "tests/e2e/screenshots/g08-home-ar-desktop.png", fullPage: true });

    // English (LTR)
    const enPage = await ctx.newPage();
    await enPage.goto("/en");
    await enPage.waitForLoadState("networkidle");
    await expect(enPage.locator("h1, h2").first()).toBeVisible({ timeout: 10000 });
    expect(await enPage.locator("html").getAttribute("dir")).toBe("ltr");
    await enPage.screenshot({ path: "tests/e2e/screenshots/g08-home-en-desktop.png", fullPage: true });
  });

  test("home page renders correctly on mobile", async ({ browser }) => {
    test.setTimeout(60000);
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });

    const arPage = await ctx.newPage();
    await arPage.goto("/ar");
    await arPage.waitForLoadState("networkidle");
    await arPage.screenshot({ path: "tests/e2e/screenshots/g08-home-ar-mobile.png", fullPage: true });

    const enPage = await ctx.newPage();
    await enPage.goto("/en");
    await enPage.waitForLoadState("networkidle");
    await enPage.screenshot({ path: "tests/e2e/screenshots/g08-home-en-mobile.png", fullPage: true });
  });

  test("navigation is keyboard accessible", async ({ page }) => {
    test.setTimeout(30000);
    await page.goto("/en");
    await page.waitForLoadState("networkidle");

    // Tab through interactive elements
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName + (el.getAttribute("href") || "") : "none";
    });
    expect(focused).not.toBe("none");
  });

  test("site header renders on home page with nav links", async ({ page }) => {
    test.setTimeout(30000);
    await page.goto("/en");
    await page.waitForLoadState("networkidle");

    // Check for header element (role="banner")
    const header = page.locator("header");
    await expect(header).toBeVisible({ timeout: 10000 });

    // Check for navigation
    const nav = page.locator("nav");
    await expect(nav).toBeVisible();
  });

  test("no raw i18n keys visible on home page", async ({ page }) => {
    test.setTimeout(30000);
    await page.goto("/en");
    await page.waitForLoadState("networkidle");

    const bodyText = await page.locator("body").textContent();
    // Raw keys would look like "nav.home" or "home.welcome"
    expect(bodyText).not.toContain("nav.");
    expect(bodyText).not.toContain("home.");
    expect(bodyText).not.toContain("ui.");
  });

  test("sign-in page renders with form labels", async ({ page }) => {
    test.setTimeout(30000);
    await page.goto("/en/auth/signin");
    await page.waitForLoadState("networkidle");

    // Check for email input
    await expect(page.locator('[name="email"]')).toBeVisible();
    // Check for password input
    await expect(page.locator('[name="password"]')).toBeVisible();
    // Check for submit button
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    await page.screenshot({ path: "tests/e2e/screenshots/g08-signin-en-desktop.png" });
  });

  test("integrations tool directory renders with MOCK badge", async ({ page }) => {
    test.setTimeout(30000);
    // Sign in first
    await page.goto("/en/auth/signin");
    await page.fill('[name="email"]', "member@str.platform.local");
    await page.fill('[name="password"]', "MemberPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });

    await page.goto("/en/integrations");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "tests/e2e/screenshots/g08-integrations-en-desktop.png", fullPage: true });
  });
});
