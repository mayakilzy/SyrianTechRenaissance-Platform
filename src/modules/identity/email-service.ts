/**
 * STR Identity — Email Service
 * ----------------------------
 * Abstraction over email delivery. Implementations:
 *   - LogEmailService    (dev/prod): writes redacted metadata to structured log
 *   - CaptureEmailService (test-only): writes full emails to a JSON file on disk
 *     so Playwright tests can read them WITHOUT any HTTP route in the app
 *
 * G02 does NOT claim external email delivery. LogEmailService is the default
 * in dev/prod; tests use CaptureEmailService. Production email is deferred
 * until SMTP is configured (G10).
 *
 * SECURITY: LogEmailService MUST NOT log sensitive content (tokens, URLs,
 * passwords). See G02-SECURITY-CLOSE §4.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  metadata?: {
    type: "verification" | "password_reset" | "welcome";
    tokenPreview?: string;
  };
}

export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}

// Patterns to redact from logs: verification/reset URLs, token values, passwords.
const TOKEN_URL_RE = /https?:\/\/[^\s]*?(?:token=|reset-password\/)[^\s&]*/gi;
const TOKEN_VALUE_RE = /\btoken=[^\s&]+/gi;
const PASSWORD_RE = /\bpassword[=:]\s*[^\s]+/gi;

function redactForLog(text: string): string {
  return text
    .replace(TOKEN_URL_RE, "[REDACTED_URL]")
    .replace(TOKEN_VALUE_RE, "token=[REDACTED]")
    .replace(PASSWORD_RE, "password=[REDACTED]");
}

/**
 * Dev/prod implementation: logs redacted metadata ONLY.
 * NEVER logs full email body, tokens, or verification URLs.
 */
export class LogEmailService implements EmailService {
  async send(message: EmailMessage): Promise<void> {
    logger.info("email.sent", {
      to: message.to,
      subject: redactForLog(message.subject),
      type: message.metadata?.type,
      // DO NOT log: textBody, htmlBody, tokenPreview, or any URL.
      bodyLength: message.textBody.length,
      hasTokenUrl: TOKEN_URL_RE.test(message.textBody),
    });
  }
}

/**
 * Test-only implementation: writes full emails to a JSON file on disk.
 * Playwright tests read this file DIRECTLY — NO HTTP route is needed.
 * This is the G02-SECURITY-CLOSE isolation design: tests read from the
 * filesystem, not from the application.
 *
 * SECURITY: Only instantiated when STR_TEST_MODE=1. The app's production
 * code never imports this class — it's loaded via getEmailService() only
 * when the env var is set.
 */
export class CaptureEmailService implements EmailService {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath =
      filePath ??
      join(process.env.STR_TEST_EMAIL_FILE ?? "/tmp", "str-test-emails.json");
  }

  async send(message: EmailMessage): Promise<void> {
    const emails = this.readAll();
    const filtered = emails.filter((e) => e.to !== message.to);
    filtered.push(message);
    this.writeAll(filtered);
  }

  private readAll(): EmailMessage[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as EmailMessage[];
    } catch {
      return [];
    }
  }

  private writeAll(emails: EmailMessage[]): void {
    const dir = this.filePath.substring(0, this.filePath.lastIndexOf("/"));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(emails, null, 2), "utf-8");
  }

  /** Clear the email file. Called by Playwright globalSetup before each run. */
  clear(): void {
    if (existsSync(this.filePath)) {
      unlinkSync(this.filePath);
    }
  }

  /** Find the last email sent to a given address. */
  lastTo(address: string): EmailMessage | undefined {
    const emails = this.readAll();
    for (let i = emails.length - 1; i >= 0; i--) {
      const email = emails[i];
      if (email && email.to === address) return email;
    }
    return undefined;
  }
}

/**
 * Factory: returns the right email service for the environment.
 * - STR_TEST_MODE=1: CaptureEmailService (disk-based, for Playwright)
 * - otherwise: LogEmailService (redacted logging only)
 *
 * Production never sets STR_TEST_MODE, so it always gets LogEmailService.
 */
let captureService: CaptureEmailService | null = null;

export function getEmailService(): EmailService {
  if (process.env.STR_TEST_MODE === "1") {
    if (!captureService) captureService = new CaptureEmailService();
    return captureService;
  }
  return new LogEmailService();
}

/**
 * Test-only accessor. Throws if called outside test mode — production
 * code can never access captured emails.
 */
export function getCaptureEmailService(): CaptureEmailService {
  if (process.env.STR_TEST_MODE !== "1") {
    throw new Error("CaptureEmailService is only available in test mode (STR_TEST_MODE=1)");
  }
  if (!captureService) captureService = new CaptureEmailService();
  return captureService;
}
