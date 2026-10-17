# STR Platform — Production Readiness Security Notes

**Status:** Living document — updated as each mission completes
**Last updated:** 2026-10-17 (after G02 merge to `main`)

This document tracks security and operational requirements that MUST be
addressed before production deployment. These are NOT optional — they are
hard blockers for go-live. Each item lists the mission that introduced it,
the current state, and the target mission for resolution.

---

## G02 — Identity, Profiles and Roles

### 1. Test email file permissions and path privacy
**Introduced by:** G02-SECURITY-CLOSE
**Current state:** `CaptureEmailService` writes to `/tmp/str-test-emails.json`
(or `STR_TEST_EMAIL_FILE`). The `/tmp` directory is world-readable on most
Linux systems. While the file only exists when `STR_TEST_MODE=1` (never in
production), the path should be hardened for defense-in-depth.
**Target:** G10 (Deployment and Operational Handoff)
**Required action before go-live:**
- Set `STR_TEST_EMAIL_FILE` to a path under a dedicated test directory with
  `0700` permissions (e.g., `/var/lib/str-test/emails.json`).
- Ensure the CI runner's test directory is not shared between builds.
- Add a CI step that asserts the file is deleted after the test run.

### 2. Prevent STR_TEST_MODE activation in production
**Introduced by:** G02-SECURITY-CLOSE
**Current state:** `CaptureEmailService` is only instantiated when
`STR_TEST_MODE === "1"`. There is no guard that prevents this env var from
being set in a production deployment.
**Target:** G10 (Deployment and Operational Handoff)
**Required action before go-live:**
- Add a startup assertion in `src/lib/config.ts` that throws if
  `STR_TEST_MODE === "1"` AND `NODE_ENV === "production"`.
- Add a CI test that builds with `NODE_ENV=production` and asserts
  `STR_TEST_MODE` is not set in the build environment.
- Document in the deployment runbook that `STR_TEST_MODE` must NEVER be
  set in production environment variables.

### 3. Real email delivery service
**Introduced by:** G02 (identity module)
**Current state:** `LogEmailService` is the default in dev/prod. It writes
redacted metadata to structured logs but does NOT deliver emails. Users
cannot verify their email or reset passwords without a real email service.
**Target:** G10 (Deployment and Operational Handoff)
**Required action before go-live:**
- Implement `SmtpEmailService` (or use a transactional email provider like
  Postmark, SendGrid, or AWS SES).
- Configure SPF, DKIM, and DMARC for the sending domain.
- Add email bounce/complaint handling.
- Test the full verification + reset flows against a real inbox.

### 4. Distributed rate limiter (multi-instance)
**Introduced by:** G02-SECURITY-CLOSE (documented in `rate-limiter.ts`)
**Current state:** `RateLimiter` uses an in-memory `Map`. It is
single-instance only. With N app replicas, an attacker can make
N × maxAttempts requests per window — defeating the brute-force protection.
**Target:** G10 (Deployment and Operational Handoff)
**Required action before go-live:**
- Implement `RedisRateLimiter` with the same `check(key, action)` interface.
- Wire it in `getRateLimiter()` based on an env flag
  (e.g., `RATE_LIMIT_BACKEND=redis`).
- Test with multiple app instances hitting a shared Redis.
- Document the Redis connection requirements in the deployment runbook.

### 5. Google OIDC credentials and redirect configuration
**Introduced by:** G02 (auth module)
**Current state:** Google OIDC is implemented in code (next-auth
GoogleProvider) with safe linking rules. The "Continue with Google" button
is hidden when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are not configured.
External connection test has NOT been performed.
**Target:** G02 follow-up (when founder provides credentials) or G10.
**Required action before go-live:**
- Founder provisions Google OAuth credentials in Google Cloud Console.
- Configure authorized redirect URIs
  (e.g., `https://str.platform/api/auth/callback/google`).
- Test the full Google sign-in + account linking flow in staging.
- Verify safe linking: Google email collision with existing account must
  BLOCK (not auto-merge).

---

## G01 — Foundation (all addressed, no production blockers)

All G01 items were resolved during G01 and G01-FIX. No outstanding
production-readiness items from G01.

---

## Summary

| # | Item | Introduced by | Target mission | Blocks go-live? |
|---|---|---|---|---|
| 1 | Test email file permissions | G02-SECURITY-CLOSE | G10 | Yes (if test mode used in prod) |
| 2 | Prevent STR_TEST_MODE in production | G02-SECURITY-CLOSE | G10 | Yes |
| 3 | Real email delivery | G02 | G10 | Yes |
| 4 | Distributed rate limiter | G02-SECURITY-CLOSE | G10 | Yes (multi-instance) |
| 5 | Google OIDC credentials + test | G02 | G02-followup / G10 | Yes (for Google sign-in) |

**All 5 items target G10 (Deployment and Operational Handoff) for final
resolution.** They do NOT block development of G03–G09, but they MUST be
closed before production go-live.
