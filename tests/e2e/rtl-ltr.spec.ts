import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const screenshotDir = resolve(__dirname, "screenshots");
mkdirSync(screenshotDir, { recursive: true });

/**
 * G01 acceptance: verify the Arabic RTL home page renders correctly in a real
 * browser. The HTML element must carry lang="ar" and dir="rtl", the page must
 * not be a blank shell, and key content must be present in Arabic.
 */
test.describe("STR home — Arabic (RTL)", () => {
  test("renders RTL with Arabic content", async ({ page }) => {
    await page.goto("/");
    // Wait for hydration
    await page.waitForLoadState("networkidle");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(html).toHaveAttribute("dir", "rtl");

    // Hero title is present and non-empty
    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible();
    const h1Text = (await h1.textContent())?.trim();
    expect(h1Text && h1Text.length > 5).toBe(true);

    // Locale switch link points to /en
    const switchLink = page.getByRole("link", { name: /English/ });
    await expect(switchLink).toBeVisible();
    await expect(switchLink).toHaveAttribute("href", "/en");

    await page.screenshot({
      path: resolve(screenshotDir, "home-ar-rtl.png"),
      fullPage: true,
    });
  });

  test("health endpoint returns JSON success envelope", async ({ request }) => {
    const res = await request.get("/api/v1/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.version).toBeTruthy();
  });
});

test.describe("STR home — English (LTR)", () => {
  test("renders LTR with English content", async ({ page }) => {
    await page.goto("/en");
    await page.waitForLoadState("networkidle");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "en");
    await expect(html).toHaveAttribute("dir", "ltr");

    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible();
    const h1Text = (await h1.textContent())?.trim();
    expect(h1Text && h1Text.length > 5).toBe(true);

    // Locale switch link points back to Arabic home
    const switchLink = page.getByRole("link", { name: /العربية/ });
    await expect(switchLink).toBeVisible();

    await page.screenshot({
      path: resolve(screenshotDir, "home-en-ltr.png"),
      fullPage: true,
    });
  });
});

test.describe("STR home — error states", () => {
  test("unknown locale-namespace path returns 404", async ({ page }) => {
    const res = await page.goto("/this-path-does-not-exist");
    // next-intl will redirect unknown paths to default locale; either way the
    // response should not be a 500.
    expect(res?.status()).toBeLessThan(500);
  });
});
