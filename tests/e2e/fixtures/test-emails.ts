/**
 * STR Playwright — Test Email Fixture
 * ------------------------------------
 * Provides isolated access to captured test emails WITHOUT any HTTP route
 * in the application. Playwright tests read the JSON file written by
 * CaptureEmailService directly from the filesystem.
 *
 * The file path is `/tmp/str-test-emails.json` (or STR_TEST_EMAIL_FILE if
 * set). The CI workflow sets STR_TEST_EMAIL_FILE to a known location.
 *
 * SECURITY: This fixture is ONLY imported by Playwright tests. It is never
 * part of the application build. The application has NO route that can
 * serve this data — the only way to read captured emails is from the
 * filesystem, which requires shell access to the test environment.
 *
 * See G02-SECURITY-CLOSE §2 (isolated test email infrastructure).
 */

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface TestEmail {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  metadata?: {
    type: "verification" | "password_reset" | "welcome";
    tokenPreview?: string;
  };
}

function getEmailFilePath(): string {
  return join(process.env.STR_TEST_EMAIL_FILE ?? "/tmp", "str-test-emails.json");
}

/** Clear all captured emails. Call in Playwright globalSetup. */
export function clearTestEmails(): void {
  const path = getEmailFilePath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

/** Read all captured emails from the filesystem. */
function readAllEmails(): TestEmail[] {
  const path = getEmailFilePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as TestEmail[];
  } catch {
    return [];
  }
}

/**
 * Find the last email sent to a given address.
 * Returns undefined if no email found.
 */
export function lastEmailTo(address: string): TestEmail | undefined {
  const emails = readAllEmails();
  for (let i = emails.length - 1; i >= 0; i--) {
    const email = emails[i];
    if (email && email.to === address) return email;
  }
  return undefined;
}

/**
 * Extract a verification token URL from the last email to a given address.
 * Returns the full URL (e.g., http://localhost:3000/auth/verify?token=abc...).
 */
export function extractVerificationUrl(address: string): string | undefined {
  const email = lastEmailTo(address);
  if (!email) return undefined;
  const match = email.textBody.match(/https?:\/\/[^\s]+token=[^\s&]+/);
  return match?.[0];
}

/**
 * Extract a password reset URL from the last email to a given address.
 * Reset URLs use a path segment (/auth/reset-password/<token>), not ?token=.
 */
export function extractResetUrl(address: string): string | undefined {
  const email = lastEmailTo(address);
  if (!email) return undefined;
  const match = email.textBody.match(/https?:\/\/[^\s]+\/auth\/reset-password\/[^\s]+/);
  return match?.[0];
}

/**
 * Wait for an email to arrive. Polls the filesystem up to `timeoutMs`.
 * Useful when the email is sent asynchronously.
 */
export async function waitForEmail(
  address: string,
  timeoutMs = 5000,
): Promise<TestEmail> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const email = lastEmailTo(address);
    if (email) return email;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email received for ${address} within ${timeoutMs}ms`);
}
