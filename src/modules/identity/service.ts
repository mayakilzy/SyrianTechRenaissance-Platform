/**
 * STR Identity — Identity Service
 * --------------------------------
 * Core business logic for email/password registration, email verification,
 * password reset, and Google OIDC account linking.
 *
 * Security invariants enforced:
 *   1. (provider, providerSub) globally unique (DB constraint).
 *   2. Email normalized (lowercase + trim) but NEVER trusted as sole identity key.
 *   3. Password hashed with Argon2id before storage.
 *   4. Verification/reset tokens stored as SHA-256 hash; raw token sent via email.
 *   5. No auto-merge by email — Google sign-in that collides with an existing
 *      email is BLOCKED and requires explicit linking flow.
 *   6. Account enumeration defenses: signup and reset always return generic
 *      success messages regardless of whether the email exists.
 *
 * See ADR-03, 03-Data-and-Permissions §invariant 1, STR-GOV-TEAM-01.
 */

import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "./password";
import { generateToken, hashToken } from "./tokens";
import { getEmailService } from "./email-service";
import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  ConflictError,
  ValidationError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  UnprocessableEntityError,
} from "@/lib/errors";

// ---------------------------------------------------------------------------
// Email normalization
// ---------------------------------------------------------------------------

/** Normalize an email: lowercase + trim. Never trust it as identity key. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Signup (email + password)
// ---------------------------------------------------------------------------

export interface SignupInput {
  email: string;
  password: string;
  displayName?: string;
  locale?: string;
}

export interface SignupResult {
  userId: string;
  email: string;
  status: "unverified";
  message: string; // generic — does not reveal if email already exists
}

/**
 * Register a new user with email + password.
 *
 * Account enumeration defense: if the email is already registered, we do NOT
 * return an error. Instead, we return the same generic success message and
 * silently skip creating a duplicate. The user is told "check your email"
 * regardless. This prevents an attacker from probing which emails are registered.
 *
 * Rate limiting is enforced by the caller (API route) via the rate limiter.
 */
export async function signup(input: SignupInput): Promise<SignupResult> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) {
    throw new ValidationError("Invalid email format", { email: ["invalid"] });
  }
  if (input.password.length < 8) {
    throw new ValidationError("Password must be at least 8 characters", {
      password: ["too_short"],
    });
  }

  // Check if email already exists. We DON'T throw — we return generic success.
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    logger.info("identity.signup.duplicate_attempt", { email });
    return {
      userId: "",
      email,
      status: "unverified",
      message:
        "If this email is not already registered, you will receive a verification link shortly.",
    };
  }

  // Create user + password auth identity in a transaction.
  const passwordHash = await hashPassword(input.password);
  const user = await db.user.create({
    data: {
      email,
      displayName: input.displayName?.trim() || null,
      locale: input.locale || env.NEXT_PUBLIC_DEFAULT_LOCALE,
      status: "UNVERIFIED",
      authIdentities: {
        create: {
          provider: "password",
          providerSub: email,
          emailAtLink: email,
          passwordHash,
        },
      },
      // Create an empty profile so the user can fill it in later.
      profile: {
        create: {
          displayName: (input.displayName?.trim() || email.split("@")[0]) ?? "Member",
          visibility: { create: {} },
        },
      },
    },
    include: { authIdentities: true },
  });

  // Generate verification token + send email.
  const token = generateToken();
  const tokenHash = hashToken(token);
  await db.emailVerification.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });

  const baseUrl = env.APP_BASE_URL ?? "http://localhost:3000";
  const verifyUrl = `${baseUrl}/auth/verify?token=${token}`;
  const emailService = getEmailService();
  await emailService.send({
    to: email,
    subject: "Verify your STR Platform account",
    textBody: `Welcome to the Syrian Tech Renaissance.\n\nVerify your email by visiting:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    metadata: { type: "verification", tokenPreview: token.substring(0, 8) },
  });

  logger.info("identity.signup.success", { userId: user.id, email });
  return {
    userId: user.id,
    email,
    status: "unverified",
    message:
      "If this email is not already registered, you will receive a verification link shortly.",
  };
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export interface VerifyResult {
  success: boolean;
  message: string;
}

/** Verify an email using the token from the verification link. */
export async function verifyEmail(token: string): Promise<VerifyResult> {
  if (!token || token.length < 10) {
    throw new ValidationError("Invalid token");
  }

  const tokenHash = hashToken(token);
  const record = await db.emailVerification.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record) {
    throw new NotFoundError("Verification token not found");
  }
  if (record.consumedAt) {
    throw new ConflictError("Token already used");
  }
  if (record.expiresAt < new Date()) {
    throw new UnauthorizedError("Token expired");
  }

  // Consume token + activate user in a transaction.
  await db.$transaction([
    db.emailVerification.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    db.user.update({
      where: { id: record.userId },
      data: {
        status: "ACTIVE",
        emailVerified: new Date(),
      },
    }),
    db.roleGrant.upsert({
      where: {
        userId_role_scope: {
          userId: record.userId,
          role: "member",
          scope: "global",
        },
      },
      update: {},
      create: {
        userId: record.userId,
        role: "member",
        scope: "global",
      },
    }),
  ]);

  logger.info("identity.verify.success", { userId: record.userId });
  return {
    success: true,
    message: "Email verified successfully. You can now sign in.",
  };
}

// ---------------------------------------------------------------------------
// Login (email + password)
// ---------------------------------------------------------------------------

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  success: boolean;
  userId?: string;
  message: string;
}

/**
 * Verify email + password credentials for next-auth CredentialsProvider.
 * Returns the user if credentials are valid; null otherwise.
 *
 * Account enumeration defense: the error message is the same for "email not
 * found" and "wrong password". The response time is also normalized by
 * performing a dummy hash verification when the email doesn't exist.
 */
export async function verifyCredentials(
  input: LoginInput,
): Promise<{ id: string; email: string; displayName: string | null } | null> {
  const email = normalizeEmail(input.email);
  const user = await db.user.findUnique({
    where: { email },
    include: {
      authIdentities: {
        where: { provider: "password" },
        take: 1,
      },
    },
  });

  if (!user) {
    // Dummy verification to normalize timing. Prevents timing-based
    // account enumeration.
    await verifyPassword(input.password, DUMMY_HASH);
    return null;
  }

  if (user.status !== "ACTIVE") {
    // Don't reveal that the account exists but is unverified/suspended.
    await verifyPassword(input.password, DUMMY_HASH);
    return null;
  }

  const passwordIdentity = user.authIdentities[0];
  if (!passwordIdentity?.passwordHash) {
    await verifyPassword(input.password, DUMMY_HASH);
    return null;
  }

  const valid = await verifyPassword(input.password, passwordIdentity.passwordHash);
  if (!valid) return null;

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}

// Argon2id hash of "dummy" — used for timing normalization.
// Generated once; the actual password doesn't matter since it never matches.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$dGhpcyBpcyBhIGR1bW15IHNhbHQ$J8kQ8pKq8pKq8pKq8pKq8pKq8pKq8pKq8pKq8pKq8pK";

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export interface RequestResetInput {
  email: string;
}

/**
 * Request a password reset. Account enumeration defense: always returns the
 * same generic message regardless of whether the email exists.
 */
export async function requestPasswordReset(
  input: RequestResetInput,
): Promise<{ message: string }> {
  const email = normalizeEmail(input.email);
  const user = await db.user.findUnique({
    where: { email },
    include: {
      authIdentities: {
        where: { provider: "password" },
        take: 1,
      },
    },
  });

  if (!user || !user.authIdentities[0]?.passwordHash) {
    // Email doesn't exist or has no password identity. Return generic success.
    logger.info("identity.reset.unknown_email", { email });
    return {
      message:
        "If this email is registered, you will receive a password reset link shortly.",
    };
  }

  if (user.status !== "ACTIVE") {
    // Don't send reset for unverified/suspended accounts.
    return {
      message:
        "If this email is registered, you will receive a password reset link shortly.",
    };
  }

  // Generate reset token + send email.
  const token = generateToken();
  const tokenHash = hashToken(token);
  await db.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
    },
  });

  const baseUrl = env.APP_BASE_URL ?? "http://localhost:3000";
  const resetUrl = `${baseUrl}/auth/reset-password/${token}`;
  const emailService = getEmailService();
  await emailService.send({
    to: email,
    subject: "Reset your STR Platform password",
    textBody: `You requested a password reset.\n\nReset your password by visiting:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    metadata: { type: "password_reset", tokenPreview: token.substring(0, 8) },
  });

  logger.info("identity.reset.sent", { userId: user.id });
  return {
    message:
      "If this email is registered, you will receive a password reset link shortly.",
  };
}

export interface ConfirmResetInput {
  token: string;
  newPassword: string;
}

/** Confirm a password reset using the token from the reset link. */
export async function confirmPasswordReset(
  input: ConfirmResetInput,
): Promise<{ success: boolean; message: string }> {
  if (!input.token || input.token.length < 10) {
    throw new ValidationError("Invalid token");
  }
  if (input.newPassword.length < 8) {
    throw new ValidationError("Password must be at least 8 characters", {
      password: ["too_short"],
    });
  }

  const tokenHash = hashToken(input.token);
  const record = await db.passwordReset.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          authIdentities: { where: { provider: "password" }, take: 1 },
        },
      },
    },
  });

  if (!record) {
    throw new NotFoundError("Reset token not found");
  }
  if (record.consumedAt) {
    throw new ConflictError("Token already used");
  }
  if (record.expiresAt < new Date()) {
    throw new UnauthorizedError("Token expired");
  }

  const newPasswordHash = await hashPassword(input.newPassword);
  const identity = record.user.authIdentities[0];
  if (!identity) {
    throw new UnprocessableEntityError("No password identity found");
  }

  await db.$transaction([
    db.passwordReset.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    db.authIdentity.update({
      where: { id: identity.id },
      data: { passwordHash: newPasswordHash },
    }),
  ]);

  logger.info("identity.reset.confirmed", { userId: record.userId });
  return { success: true, message: "Password reset successfully. You can now sign in." };
}

// ---------------------------------------------------------------------------
// Google OIDC safe linking
// ---------------------------------------------------------------------------

export interface GoogleLinkInput {
  googleSub: string;
  googleEmail: string;
  googleName?: string;
  isExplicitLink: boolean; // true when user is already logged in and explicitly linking
  existingUserId?: string; // present when isExplicitLink = true
}

export interface GoogleLinkResult {
  action: "created" | "linked" | "blocked";
  userId?: string;
  message: string;
}

/**
 * Handle a Google OIDC sign-in attempt with safe linking rules.
 *
 * Rules (ADR-03 + 03-Data §invariant 1):
 *   1. If isExplicitLink and existingUserId: link Google to the existing user.
 *      This is the only safe auto-link path — the user proved ownership by
 *      being logged in.
 *   2. If Google `sub` already has an AuthIdentity: sign in as that user.
 *   3. If Google email matches an existing user but no Google AuthIdentity:
 *      BLOCK. The user must log in first and explicitly link their Google
 *      account. No auto-merge by email.
 *   4. If no existing user: create a new user with Google `sub` as identity.
 */
export async function handleGoogleLink(
  input: GoogleLinkInput,
): Promise<GoogleLinkResult> {
  const { googleSub, googleEmail, googleName, isExplicitLink, existingUserId } =
    input;
  const normalizedEmail = normalizeEmail(googleEmail);

  // Rule 1: Explicit linking (user is logged in).
  if (isExplicitLink && existingUserId) {
    // Check if this Google sub is already linked to a different user.
    const existingLink = await db.authIdentity.findUnique({
      where: {
        provider_providerSub: { provider: "google", providerSub: googleSub },
      },
    });
    if (existingLink && existingLink.userId !== existingUserId) {
      return {
        action: "blocked",
        message:
          "This Google account is already linked to a different STR account.",
      };
    }

    await db.authIdentity.create({
      data: {
        userId: existingUserId,
        provider: "google",
        providerSub: googleSub,
        emailAtLink: normalizedEmail,
      },
    });
    logger.info("identity.google.linked", { userId: existingUserId, googleSub });
    return {
      action: "linked",
      userId: existingUserId,
      message: "Google account linked successfully.",
    };
  }

  // Rule 2: Google sub already has an identity → sign in.
  const existingIdentity = await db.authIdentity.findUnique({
    where: {
      provider_providerSub: { provider: "google", providerSub: googleSub },
    },
    include: { user: true },
  });
  if (existingIdentity) {
    if (existingIdentity.user.status !== "ACTIVE") {
      return {
        action: "blocked",
        message: "Account is not active. Contact support.",
      };
    }
    return {
      action: "linked",
      userId: existingIdentity.userId,
      message: "Signed in with Google.",
    };
  }

  // Rule 3: Google email matches an existing user → BLOCK auto-merge.
  const emailMatch = await db.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (emailMatch) {
    logger.info("identity.google.email_collision_blocked", {
      userId: emailMatch.id,
      email: normalizedEmail,
    });
    return {
      action: "blocked",
      message:
        "An account with this email already exists. Sign in with your password first, then link your Google account from Settings.",
    };
  }

  // Rule 4: No existing user → create new account with Google identity.
  const newUser = await db.user.create({
    data: {
      email: normalizedEmail,
      emailVerified: new Date(), // Google verified the email
      displayName: (googleName || normalizedEmail.split("@")[0]) ?? "Member",
      locale: env.NEXT_PUBLIC_DEFAULT_LOCALE,
      status: "ACTIVE",
      authIdentities: {
        create: {
          provider: "google",
          providerSub: googleSub,
          emailAtLink: normalizedEmail,
        },
      },
      profile: {
        create: {
          displayName: (googleName || normalizedEmail.split("@")[0]) ?? "Member",
          visibility: { create: {} },
        },
      },
      roleGrants: {
        create: { role: "member", scope: "global" },
      },
    },
  });

  logger.info("identity.google.created", { userId: newUser.id, googleSub });
  return {
    action: "created",
    userId: newUser.id,
    message: "Account created with Google.",
  };
}
