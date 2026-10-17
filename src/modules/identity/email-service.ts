/**
 * STR Identity — Email Service
 * ----------------------------
 * Abstraction over email delivery. Three implementations:
 *   - LogEmailService    (dev): writes email content to the structured log
 *   - CaptureEmailService (test): stores emails in memory for test assertions
 *   - SmtpEmailService   (prod, future): real SMTP sending via nodemailer
 *
 * G02 does NOT claim external email delivery. The LogEmailService is the
 * default in development; tests use CaptureEmailService. Production email
 * is deferred until a real SMTP provider is configured (G10 deployment).
 *
 * See G02 acceptance: "do not claim email delivery if no real service is
 * available."
 */

export interface EmailMessage {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  metadata?: {
    type: "verification" | "password_reset" | "welcome";
    tokenPreview?: string; // first 8 chars, for log correlation only
  };
}

export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Dev implementation: logs the email as a structured JSON line so the
 * developer can find the verification/reset URL in the server output.
 */
export class LogEmailService implements EmailService {
  async send(message: EmailMessage): Promise<void> {
    // Dynamic import to avoid circular dependency at module load time.
    const { logger } = await import("@/lib/logger");
    logger.info("email.sent", {
      to: message.to,
      subject: message.subject,
      type: message.metadata?.type,
      // Log the text body so the verification link is visible in dev.
      // In production, this implementation is never used.
      preview: message.textBody.substring(0, 500),
    });
  }
}

/**
 * Test implementation: stores all sent emails in an array so tests can
 * extract tokens and verify delivery. Cleared between test runs.
 */
export class CaptureEmailService implements EmailService {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  clear(): void {
    this.sent.length = 0;
  }

  /** Find the last email sent to a given address. */
  lastTo(address: string): EmailMessage | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const email = this.sent[i];
      if (email && email.to === address) return email;
    }
    return undefined;
  }

  /** Extract a verification/reset URL from the last email to a given address. */
  extractTokenUrl(address: string): string | undefined {
    const email = this.lastTo(address);
    if (!email) return undefined;
    const match = email.textBody.match(/https?:\/\/[^\s]+token=[^\s&]+/);
    return match?.[0];
  }

  /** Extract any URL from the last email to a given address (for reset links). */
  extractUrl(address: string): string | undefined {
    const email = this.lastTo(address);
    if (!email) return undefined;
    const match = email.textBody.match(/https?:\/\/[^\s]+/);
    return match?.[0];
  }
}

/**
 * Factory: returns the right email service for the environment.
 * - test: CaptureEmailService (singleton, accessible from tests)
 * - development: LogEmailService
 * - production: would be SmtpEmailService (not yet implemented — G10)
 */
let captureService: CaptureEmailService | null = null;

export function getEmailService(): EmailService {
  if (process.env.NODE_ENV === "test") {
    if (!captureService) captureService = new CaptureEmailService();
    return captureService;
  }
  // dev and production both use LogEmailService until SMTP is wired in G10.
  // Production deployment is blocked until SmtpEmailService is implemented.
  return new LogEmailService();
}

/** Test-only accessor for the CaptureEmailService singleton. */
export function getCaptureEmailService(): CaptureEmailService {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("CaptureEmailService is only available in test environment");
  }
  if (!captureService) captureService = new CaptureEmailService();
  return captureService;
}
