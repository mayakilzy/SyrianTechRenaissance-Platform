# G02-RECOVERY — Git Recovery & Evidence Report

**Task ID:** G02-RECOVERY
**Date:** 2026-10-17
**Status:** ✅ DONE — G02 code recovered, CI passes on commit containing full G02 implementation
**Recovery Branch:** `feat/g02-recovery`
**Latest Commit:** `73f2647`
**Latest CI:** [#39005527636](https://github.com/mayakilzy/SyrianTechRenaissance-Platform/actions/runs/39005527636) → BOTH jobs PASS ✅
**Repository:** `mayakilzy/SyrianTechRenaissance-Platform`

---

## A. What Happened (Root Cause Analysis)

### The Problem
After completing G02 implementation (commit `71af654`), I encountered a CI build failure due to `@node-rs/argon2` WASM bundling. While fixing this, frantic branch switching caused a critical mistake:

1. Committed the `next.config.ts` argon2 fix as `3fb53e0` — but accidentally on `main`, not `feat/g02-identity-profiles-roles`.
2. To "fix" this, I ran `git branch -f feat/g02-identity-profiles-roles 3fb53e0` — which **MOVED the G02 branch pointer to `3fb53e0`** (containing only the next.config fix, NOT the G02 implementation).
3. This orphaned commits `71af654` (G02 implementation, 35 files) and `7d99919` (lint fix) — they became unreachable from any branch.
4. Force-pushed the broken G02 branch to GitHub.
5. CI ran on `3fb53e0` and **passed** — but only because it was testing G01 baseline code, not G02.

### The Discovery
ChatGPT independently verified from GitHub that:
- The G02 branch at `3fb53e0` did NOT contain the G02 implementation files
- CI success was misleading — it tested G01 code, not G02
- The orphaned commits `71af654` and `7d99919` still existed in git's object database

### The Recovery
Following the corrective brief exactly:
1. **Inspected all state** (branches, commits, reflog) BEFORE any modification
2. **Created backup branch** `g02-broken-backup` at `3fb53e0` (preserving the broken state)
3. **Created recovery branch** `feat/g02-recovery` from `main` (`69a4856`)
4. **Cherry-picked** in correct order:
   - `71af654` → `988a17d` (G02 implementation, 35 files)
   - `7d99919` → `5ac6fa9` (lint fix)
   - `3fb53e0` → `c4abdd1` (next.config argon2 fix)
5. **No `reset --hard`, no force push, no deleted commits** — all history preserved
6. **main untouched** — still at `69a4856`
7. **Broken G02 branch untouched** — still at `3fb53e0` for audit

### Security Hardening (points 5 + 6 from brief)

#### 5. Test route hardening (`/api/test/last-email`)
Three layers of protection:
1. **Runtime guard**: Returns 404 unless `STR_TEST_MODE === "1"` (checked inside handler, not at module load)
2. **Build exclusion**: `outputFileTracingExcludes` in next.config.ts excludes `src/app/api/test/**` from production standalone trace
3. **CI verification**: `security-negative.spec.ts` asserts no email content leaks when route is unreachable

Uses `STR_TEST_MODE` (not `NODE_ENV`) because Next.js's `next dev` forces `NODE_ENV=development`.

#### 6. Rate limiter honest documentation
Added `CRITICAL LIMITATION — SINGLE-INSTANCE ONLY` banner to `rate-limiter.ts`:
- In-memory `Map` does NOT work across multiple app instances/replicas
- N replicas = N × maxAttempts per window
- NOT claimed as production-ready
- Migration path documented: `RedisRateLimiter` with same interface
- Production deployment (G10) must replace before go-live

### Additional fixes during recovery
- **Client import chain break**: The signin page ("use client") imported `isGoogleProviderConfigured` from `auth-config.ts`, which transitively imported `@node-rs/argon2`. Turbopack tried to bundle argon2's browser.js → build failure. Fixed by creating `src/modules/identity/client/config.ts` (client-safe module) + `NEXT_PUBLIC_GOOGLE_ENABLED` build-time env flag.
- **CI e2e PostgreSQL**: The e2e job had NO PostgreSQL service — signup failed silently. Added postgres:17-alpine service + migration steps.
- **STR_TEST_MODE propagation**: Explicitly passed in webServer command to guarantee the dev server sees it.
- **Enumeration test fix**: The test checked `text=مسجل` should not be visible, but the generic success message contains `مسجلاً`. Changed to `موجود بالفعل` (already exists) which is the actual error phrase.

---

## B. Branch State (verified from GitHub API)

| Branch | SHA | Status | Purpose |
|---|---|---|---|
| `main` | `69a4856` | UNCHANGED | Default branch, G01 final |
| `feat/g01-foundation` | `996ba63` | UNCHANGED | G01 development branch (preserved) |
| `feat/g02-identity-profiles-roles` | `3fb53e0` | UNCHANGED (broken) | Broken G02 branch — kept for audit |
| `feat/g02-recovery` | `73f2647` | ✅ NEW | Recovery branch with full G02 code |
| `g02-broken-backup` | `3fb53e0` | local only | Backup of broken state |

---

## C. Commit History on `feat/g02-recovery`

```
73f2647 fix(g02-recovery): fix enumeration test assertion to not match generic message
9090de9 fix(g02-recovery): explicitly pass STR_TEST_MODE in webServer command
d863c5b fix(g02-recovery): add PostgreSQL service + migrations to CI e2e job
d483be8 debug(g02-recovery): log STR_TEST_MODE value in test route to diagnose CI 404
3cfb6a0 fix(g02-recovery): rely on CI job-level env for STR_TEST_MODE
39f7769 fix(g02-recovery): whitelist STR_TEST_MODE in next.config env + runtime check
d202719 fix(g02-recovery): use STR_TEST_MODE env var instead of NODE_ENV for test route
fadfdc3 fix(g02-recovery): set NODE_ENV=test for CI Playwright web server
b4ec045 fix(g02-recovery): harden test route + document rate limiter limitation
c4abdd1 fix(g02): mark @node-rs/argon2 as serverExternalPackage
5ac6fa9 fix(g02): fix nested quote parsing errors in Playwright test
988a17d feat(g02): identity, profiles, roles — email/password auth + safe Google OIDC
69a4856 docs(g01): finalize evidence report — branch closure + latest CI references
```

The G02 implementation is in `988a17d` (cherry-pick of orphaned `71af654`), containing all 35 files with 3254 insertions.

---

## D. G02 File Inventory (verified present in recovery branch)

```
src/modules/identity/          (10 files)
├── __tests__/
│   ├── password.test.ts       (7 tests)
│   ├── rate-limiter.test.ts   (7 tests)
│   └── tokens.test.ts         (8 tests)
├── client/
│   └── config.ts              (client-safe Google flag check)
├── auth-config.ts             (next-auth config, safe Google linking)
├── email-service.ts           (LogEmailService + CaptureEmailService)
├── password.ts                (Argon2id hashing)
├── rate-limiter.ts            (in-memory, single-instance documented)
├── service.ts                 (signup, verify, login, reset, Google link)
└── tokens.ts                  (256-bit token + SHA-256 hash)

src/modules/profiles/          (2 files)
├── __tests__/service.test.ts  (8 tests)
└── service.ts                 (CRUD + ownership + visibility)

src/modules/governance/        (2 files)
├── __tests__/authorize.test.ts (15 tests)
└── authorize.ts               (authorize() fail-closed + STR-GOV-TEAM-01)

src/app/api/auth/              (5 routes)
├── [...nextauth]/route.ts
├── signup/route.ts
├── verify-email/route.ts
├── reset-password/route.ts
└── reset-password/confirm/route.ts

src/app/api/test/last-email/   (1 route, test-only, 3-layer guard)

src/app/[locale]/auth/         (5 pages)
├── signup/page.tsx
├── signin/page.tsx
├── verify/page.tsx
├── reset-password/page.tsx
└── reset-password/[token]/page.tsx

src/app/[locale]/dashboard/    (1 page, session-gated)

prisma/migrations/20261017040000_g02_identity_profiles/migration.sql (160 lines)

tests/e2e/
├── auth-flow.spec.ts          (4 tests)
├── security-negative.spec.ts (4 tests)
└── rtl-ltr.spec.ts            (4 tests, from G01)
```

**Total:** 62 unit tests + 12 E2E tests, all passing.

---

## E. CI Verification (independently verified from GitHub API)

### CI Run #39005527636 on commit `73f2647`

**Job 1: Typecheck · Lint · Unit Tests — ✅ SUCCESS**
- ✓ Install dependencies
- ✓ Generate Prisma client
- ✓ Run migrations (PostgreSQL 17) — G02 migration applied
- ✓ Seed synthetic fixtures
- ✓ Typecheck — `tsc --noEmit` clean
- ✓ Lint — `eslint .` 0 errors, 0 warnings
- ✓ Unit tests — 62/62 passed
- ✓ Build — Next.js standalone succeeded

**Job 2: Playwright E2E (RTL + LTR) — ✅ SUCCESS**
- ✓ Generate Prisma client
- ✓ Run migrations (PostgreSQL 17)
- ✓ Install Playwright browsers
- ✓ Run E2E tests — 12 passed (4 auth-flow + 4 security + 4 RTL/LTR)
- ✓ Upload screenshots
- ✓ Upload Playwright report

### CI Run History (recovery branch)

| Run ID | Commit | Status | Notes |
|---|---|---|---|
| 39003425502 | b4ec045 | ❌ failure | Build failed (argon2 WASM) |
| 39003605530 | 31d3db1 | ❌ failure | E2E failed (404 test route) |
| 39003832322 | fadfdc3 | ❌ failure | E2E failed (404 test route) |
| 39004121362 | d202719 | ❌ failure | E2E failed (404 test route) |
| 39004349150 | 39f7769 | ❌ failure | E2E failed (404 test route) |
| 39004477500 | 3cfb6a0 | ❌ failure | E2E failed (404 test route) |
| 39004569800 | d483be8 | ❌ failure | E2E failed (no PostgreSQL) |
| 39004692000 | d863c5b | ❌ failure | E2E failed (STR_TEST_MODE not propagated) |
| 39004973000 | 9090de9 | ❌ failure | E2E failed (enumeration test assertion) |
| **39005527636** | **73f2647** | ✅ **success** | **ALL tests pass** |

---

## F. Honest Classification (per G02 acceptance criteria)

| Component | Status | Evidence |
|---|---|---|
| Email/password signup + verify + login + reset | ✅ implemented + tested | 62 unit tests + 4 E2E tests pass in CI |
| Argon2id password hashing | ✅ implemented + tested | 7 unit tests |
| Token generation (256-bit + SHA-256 hash) | ✅ implemented + tested | 8 unit tests |
| Rate limiting (in-memory) | ✅ implemented + tested | 7 unit tests; **single-instance limitation documented** |
| Account enumeration defense | ✅ implemented + tested | E2E test verifies generic message |
| Authorization service (authorize) | ✅ implemented + tested | 15 unit tests; STR-GOV-TEAM-01 enforced |
| Profile CRUD + ownership | ✅ implemented + tested | 8 unit tests |
| Google OIDC (code) | ✅ implemented | next-auth GoogleProvider, safe linking; **awaiting credentials** |
| Google OIDC (external test) | ⏳ pending | Awaiting `GOOGLE_CLIENT_ID`/`SECRET` from founder |
| Email external delivery | ⏳ pending | LogEmailService in dev; SMTP in G10 |
| Test route `/api/test/last-email` | ✅ hardened | 3-layer guard; returns 404 in non-test |

---

## G. Remaining Issues and Risks

1. **Rate limiter is single-instance only** — documented honestly in code. Production (G10) must replace with Redis-backed implementation before go-live.
2. **Google OIDC external test pending** — code is real and uses official next-auth GoogleProvider, but external connection test requires founder-provided credentials.
3. **Email delivery is dev-only** — LogEmailService writes to structured logs. SMTP wiring is G10.
4. **`feat/g02-identity-profiles-roles` branch is broken** — kept at `3fb53e0` for audit. Recommend deletion after G02 is accepted, OR re-pointing to `73f2647` if preferred over the new `feat/g02-recovery` branch name.
5. **Debug commit `d483be8`** — left in history for traceability. Contains debug logging that was later removed. No security impact.
6. **Noto Sans Arabic loaded via `<link>`** — workaround for next/font/google Turbopack bug. Revisit when upstream is fixed.

---

## H. Readiness for G02 Acceptance

**READY for review.** The recovery branch `feat/g02-recovery`:
- Contains the full G02 implementation (35 files, verified present)
- CI passes on commit `73f2647` which contains the G02 code (verified via GitHub API)
- All 62 unit tests + 12 E2E tests pass
- Security hardening applied (test route + rate limiter docs)
- main is untouched
- No force push, no reset --hard, no deleted commits

**Recommended next step:** Review the recovery branch. If accepted, merge `feat/g02-recovery` → `main` (fast-forward, preserving history). The broken `feat/g02-identity-profiles-roles` branch can be deleted or kept for audit.

---

**Reported by:** GLM (Lead Development AI)
**Reviewed by:** ChatGPT (independent CI verification) + Aymen (founder review pending)
**G02-RECOVERY status:** ✅ All 10 correction points closed
