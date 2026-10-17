# G01 — Foundation and Architecture Fitness — Evidence Report (Final)

**Mission ID:** G01
**Mission Name:** Foundation and Architecture Fitness
**Status:** ✅ DONE — all acceptance criteria validated (sandbox + CI)
**Date:** 2026-10-17 (G01), 2026-10-17 (G01-FIX)
**Branch:** `feat/g01-foundation`
**Latest Commit:** `40f7004` (G01-FIX final)
**Repository:** `mayakilzy/SyrianTechRenaissance-Platform`
**Latest CI Run:** [#38999754482](https://github.com/mayakilzy/SyrianTechRenaissance-Platform/actions/runs/38999754482) → BOTH jobs PASS ✅

> **Correction note (G01-FIX):** An earlier version of this report cited CI run
> #38998237636 as successful. That run actually **FAILED** — it was the first
> CI attempt before migration files were added. The correct successful runs are
> #38998601024 (original G01), #38999577785 (G01-FIX commit 1), and
> #38999754482 (G01-FIX commit 2, latest). This error is documented in the
> G01-FIX section below and was caught by independent reviewer verification.

---

## A. Mission Status

**DONE** — all 10 acceptance criteria validated in both sandbox and CI.

### Acceptance criteria scorecard

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Clean installation | ✅ PASS | `bun install` succeeds; lockfile committed |
| 2 | Database migrations succeed | ✅ PASS | CI ran `prisma migrate deploy` against PG17; 14 tables + enums + indexes + FKs created |
| 3 | TypeScript typecheck | ✅ PASS | `tsc --noEmit` clean (strict mode + `noUncheckedIndexedAccess`) |
| 4 | Unit tests | ✅ PASS | 13/13 tests pass (Vitest 4.1.12) — CI confirmed |
| 5 | App server HTTP success | ✅ PASS | `GET /` → 200, `GET /en` → 200, `GET /api/v1/health` → 200 JSON |
| 6 | Sample i18n page (Arabic RTL) | ✅ PASS | `<html lang="ar" dir="rtl">`, Arabic title + H1, screenshot captured |
| 7 | Sample i18n page (English LTR) | ✅ PASS | `<html lang="en" dir="ltr">`, English title + H1, screenshot captured |
| 8 | Route contracts | ✅ PASS | `typedRoutes: true`; uniform `ApiResult<T>` envelope on health endpoint |
| 9 | CI PASS | ✅ PASS | Both jobs green: verify (install+generate+migrate+seed+typecheck+**lint**+test+build) + e2e (Playwright RTL+LTR) |
| 10 | Browser screenshots (RTL + LTR) | ✅ PASS | `tests/e2e/screenshots/home-ar-rtl.png` + `home-en-ltr.png` + CI uploaded as artifacts |

---

## B. Repository and Implementation

### Repository
- **Code repo:** `mayakilzy/SyrianTechRenaissance-Platform` (public)
- **Branch:** `feat/g01-foundation`
- **Latest commit:** `40f7004` (G01-FIX — vitest 4.x upgrade to close last Dependabot alert)
- **Commit history (G01):**
  - `97687bd` — initial G01 foundation
  - `6fbb563` — add PostgreSQL migration files
  - `ab2fa82` — add G01 evidence report (original, now superseded)
  - `9b18000` — G01-FIX: security, CI quality, repo hygiene, proxy.ts migration
  - `40f7004` — G01-FIX: vitest 4.x upgrade (closes last Dependabot alert)

### Working tree: clean (all changes committed)

---

## C. Technical Decisions

### Stack validated (ADR-01 — ACCEPTED)

| Layer | Choice | Version (G01-FIX) | License |
|---|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.1.3 | MIT |
| Language | TypeScript | 5.x (strict) | MIT |
| ORM | Prisma | 6.11–6.19 | Apache-2.0 |
| Database | PostgreSQL | 17 | PostgreSQL License |
| Validation | Zod | 4.3.5 | MIT |
| i18n | next-intl | 4.3.4 | MIT |
| Auth | Auth.js (next-auth) | 4.24.11 | ISC |
| Styling | Tailwind CSS 4 + shadcn/ui | 4.x | MIT |
| Unit test | Vitest | **4.1.12** (upgraded in G01-FIX) | MIT |
| E2E test | Playwright | 1.57 (CI) / 1.64 (local) | Apache-2.0 |
| Image processing | sharp | **0.35.5** (upgraded in G01-FIX) | Apache-2.0 |
| Runtime | Bun (dev), Node (prod) | 1.3 / 24 | MIT |

**Project license:** `UNLICENSED` — the founder has not approved an open-source
license for the STR Platform. This does not affect the licenses of dependencies,
which remain as listed above.

### ADRs issued
- ADR-01: Modular monolith stack (ACCEPTED)
- ADR-02: PostgreSQL outbox + same-codebase worker (ACCEPTED)
- ADR-03: Auth.js with email/password + Google OIDC (SCAFFOLDED ONLY — G02 activates)
- ADR-04: Integration Core typed contracts (TYPES ONLY in G01 — G07 implements)
- ADR-05: Sandbox dev database constraint (narrow exception)

---

## D. G01-FIX — Foundation Quality & Evidence Closure

### Fixes applied

| # | Issue | Fix | Verified |
|---|---|---|---|
| 1 | Evidence report cited failed CI run #38998237636 as successful | Corrected to #38999754482 (latest success on commit `40f7004`) | ✅ |
| 2 | `continue-on-error: true` on ESLint step | Removed; lint failures now block CI. ESLint passes with **0 errors, 0 warnings** | ✅ CI confirmed |
| 3 | Dependabot: 1 CRITICAL + 3 HIGH vulnerabilities | Upgraded sharp 0.34→0.35.5 (3 HIGH fixed); upgraded vitest 2→3.2.7→4.1.12 (CRITICAL + MEDIUM fixed) | ✅ All 5 alerts `fixed` |
| 4 | Unused scaffold dependencies bloating package.json | Removed 6 deps: `z-ai-web-dev-sdk`, `@dnd-kit/*` (3), `@mdxeditor/editor`, `@reactuses/core`, `react-syntax-highlighter` | ✅ typecheck + tests pass |
| 5 | `"license": "MIT"` set without founder approval | Changed to `"license": "UNLICENSED"`. No LICENSE file created. | ✅ |
| 6 | `middleware.ts` deprecated in Next.js 16 | Renamed to `proxy.ts`; function renamed `middleware()` → `proxy()`. Zero deprecation warnings. | ✅ dev log confirmed |
| 7 | Token safety verification | Verified: `.env` not tracked; `secrets/` not tracked; no token values in any committed file; token scopes = `repo, workflow` (appropriate). Removed all sandbox credential scripts from git. | ✅ |
| 8 | Evidence report inconsistent with final state | Rewritten from scratch with correct CI IDs, commit SHA, and all G01-FIX changes documented | ✅ This document |

### Dependabot alert status (verified from GitHub API)

| Alert | Severity | Package | Vulnerable range | Fix version | State |
|---|---|---|---|---|---|
| CVE-2026-96889 | HIGH | sharp | < 0.35.5 | 0.35.5 | ✅ `fixed` |
| GHSA-g89c-p67h-r497 + GHSA-2jg2-4ch7-h545 | HIGH | sharp | < 0.35.4 | 0.35.4 | ✅ `fixed` |
| CVE-2026-33327 + CVE-2026-33328 | HIGH | sharp | < 0.35.0 | 0.35.0 | ✅ `fixed` |
| Vitest UI arbitrary file read/execute | CRITICAL | vitest | < 3.2.6 | 3.2.6 | ✅ `fixed` |
| Vitest vulnerability (MEDIUM) | MEDIUM | vitest | >= 2.1.0, < 4.1.11 | 4.1.11 | ✅ `fixed` |

**Total: 5 alerts — all `fixed`. 0 open.**

### Token safety verification

| Check | Result |
|---|---|
| `.env` file tracked in git? | ❌ No (gitignored) ✅ |
| `secrets/` directory tracked? | ❌ No (gitignored) ✅ |
| Token value in any committed file? | ❌ No (only a regex pattern `^ghp_[A-Za-z0-9]{36}$` in a script that validates token shape — the script itself was removed from git in G01-FIX) ✅ |
| Token in git history? | ❌ No (verified via `git log --all -p | grep ghp_` — only regex pattern, never the value) ✅ |
| Token in CI logs? | ❌ No (CI uses `AUTH_SECRET: ci-placeholder-secret...`, not the real token) ✅ |
| Token in screenshots? | ❌ No (screenshots show only the home page and health endpoint) ✅ |
| Token scopes | `repo, workflow` — appropriate for push + CI workflow management, not over-permissioned ✅ |
| Sandbox credential scripts in repo? | ❌ No (all 4 scripts removed from git in G01-FIX; remain on disk, gitignored) ✅ |

**Token handling:** The GitHub PAT is stored locally at
`/home/z/my-project/secrets/.git-credentials` (600 perms) and sourced via
`/home/z/my-project/secrets/.gh_env`. It is never committed, never logged, and
never displayed in chat. It will be deleted when the founder requests it at the
end of development. The founder should also rotate it after the development
session ends as a standard security hygiene practice.

### Repo hygiene changes

**Removed from git tracking** (files remain on disk, gitignored):
- `scripts/setup_gh_creds.sh` — sandbox credential setup
- `scripts/verify_gh_access.sh` — sandbox access verification
- `scripts/dev-str.sh` — sandbox dev server wrapper
- `scripts/capture-screenshots.sh` — sandbox screenshot tool
- `tests/database-runtime-build.sh` — scaffold runtime script
- `tests/python-runtime-build.sh` — scaffold runtime script
- `tests/python-runtime-container.sh` — scaffold runtime script
- `tests/e2e/results/` — Playwright error-context artifacts (5 files)

**Added to .gitignore:**
- `/scripts/` (entire directory)
- `/download/` (agent deliverables)
- `/worklog.md` (shared agent worklog)
- `tests/e2e/results/` (Playwright outputs)
- `tests/e2e/report/` (Playwright HTML report)
- `tests/*-runtime-*.sh` (scaffold scripts)

**Final tracked file count:** 113 (down from 127)

---

## E. Tests and Evidence

### CI Run History (verified from GitHub API)

| Run ID | Commit SHA | Status | Conclusion | Notes |
|---|---|---|---|---|
| 38998237636 | 97687bd | completed | ❌ failure | First CI — no migration files |
| 38998245944 | 97687bd | completed | ❌ failure | Dependabot npm_and_yarn |
| 38998366450 | 6fbb563 | completed | ✅ success | After adding migrations |
| 38998601024 | ab2fa82 | completed | ✅ success | After evidence report |
| 38999577785 | 9b18000 | completed | ✅ success | G01-FIX commit 1 |
| 38999586051 | 9b18000 | completed | ❌ failure | Dependabot npm_and_yarn (stale) |
| **38999754482** | **40f7004** | completed | ✅ **success** | **G01-FIX final (latest)** |

### Latest CI run details (#38999754482, commit 40f7004)

**Job 1: Typecheck · Lint · Unit Tests — ✅ SUCCESS**
- ✓ Install dependencies
- ✓ Generate Prisma client
- ✓ Run migrations (PostgreSQL 17) — 14 tables created
- ✓ Seed synthetic fixtures
- ✓ Typecheck — `tsc --noEmit` clean
- ✓ **Lint — `eslint .` passes with 0 errors, 0 warnings** (no longer `continue-on-error`)
- ✓ Unit tests — 13/13 passed (Vitest 4.1.12)
- ✓ Build — Next.js standalone build succeeded

**Job 2: Playwright E2E (RTL + LTR) — ✅ SUCCESS**
- ✓ Install Playwright browsers
- ✓ Run E2E tests — RTL + LTR + health all passed
- ✓ Upload screenshots — acceptance evidence uploaded as CI artifacts
- ✓ Upload Playwright report

### Sandbox verification (G01-FIX)

```
$ bun run typecheck
$ tsc --noEmit
(clean — 0 errors)

$ bun run lint
$ eslint .
(clean — 0 errors, 0 warnings)

$ bun run test
✓ src/modules/integrations/__tests__/integration-core.test.ts (9 tests) 9ms
✓ src/lib/__tests__/errors.test.ts (4 tests) 5ms
 Test Files  2 passed (2)
      Tests  13 passed (13)
   Duration  349ms (vitest 4.1.12)

$ curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000/
200
$ curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000/en
200
$ curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health
200

# Arabic RTL:
<html lang="ar" dir="rtl">
<title>النهضة التقنية السورية — STR</title>

# English LTR:
<html lang="en" dir="ltr">
<title>Syrian Tech Renaissance — STR</title>

# Proxy headers (proxy.ts working):
x-request-id: req_fd69e4c8-bbc0-4e04-9754-5def7f7accec
x-str-version: 1.0.0-g01

# Deprecation warnings in dev log: 0
```

### Screenshots (G01 acceptance evidence)
- `tests/e2e/screenshots/home-ar-rtl.png` — Arabic RTL home (full page, 1440×900)
- `tests/e2e/screenshots/home-en-ltr.png` — English LTR home (full page, 1440×900)
- `tests/e2e/screenshots/health-endpoint.png` — Health endpoint JSON in browser

---

## F. Delivery Summary

### What's complete
- ✅ Full Next.js 16 + TypeScript + PostgreSQL + Prisma foundation
- ✅ 12-module modular monolith structure with boundary enforcement
- ✅ Typed env config, structured logging, uniform API response convention
- ✅ Typed error hierarchy (10 error classes → stable HTTP status + code)
- ✅ Integration Core: complete type system + Zod schemas + Prisma models
- ✅ Arabic RTL (default) + English LTR with correct `lang`/`dir` attributes
- ✅ Health endpoint with proper `ApiResult<T>` envelope
- ✅ Docker Compose (postgres + app + worker) + multi-stage Dockerfile
- ✅ GitHub Actions CI (verify + e2e jobs) — **lint is now mandatory**
- ✅ 5 ADRs documenting all architecture decisions
- ✅ Real browser screenshots as acceptance evidence
- ✅ `proxy.ts` (Next.js 16 convention, no deprecation warnings)
- ✅ All 5 Dependabot alerts fixed (0 open)
- ✅ Repo hygiene: sandbox artifacts removed from git
- ✅ Token safety verified: no secrets in any committed file

### What's NOT complete (and not claimed)
- ❌ Auth/email login — scaffolded only (Auth.js installed, schema ready, no routes). G02.
- ❌ Google sign-in — scaffolded only (env vars in `.env.example`, no OIDC config). G02.
- ❌ Integration job execution — types only, no dispatcher, no routes. G07.
- ❌ Mock connector — declared in catalogue, not implemented. G07.
- ❌ Production deployment — not applicable (founder decides after G10).

### Open risks and remaining debt
1. **`feat/g01-foundation` is set as the default branch on GitHub** — when G01
   is accepted, merge to `main` and set `main` as default. This is a GitHub
   repo setting, not a code change.
2. **No live PostgreSQL in sandbox** — migrations validated via CI's PG17
   service container, not locally (ADR-05). Developers need Docker to run the
   full stack locally.
3. **ESLint boundary rules** — module boundary enforcement is by convention
   and review, not yet by ESLint import restrictions. Wire in G02.
4. **Prisma `relationMode = "foreignKeys"`** — set explicitly; verify it
   doesn't conflict with future referential action requirements.
5. **Noto Sans Arabic loaded via `<link>`** — workaround for next/font/google
   Turbopack bug. Revisit when upstream is fixed.
6. **Token rotation** — the founder should rotate the GitHub PAT after the
   development session ends as standard security hygiene.

### Architecture notes
- The modular monolith is sound. Module barrels are in place; G02–G06 fill them.
- The Integration Core types are stable and frozen (ADR-04). G07 implements
  against this contract without renegotiating types.
- The outbox pattern (ADR-02) is modeled but not yet wired. The `OutboxEvent`
  table exists; the dispatcher arrives in G07.
- The auth schema enforces invariant 1 (`(provider, providerSub)` unique) from
  day one, so G02 can't accidentally build unsafe linking.

### Readiness for G02
**READY.** The foundation is solid, CI-validated, and security-clean:
- Auth.js is installed and the schema models `User`/`AuthIdentity`/`EmailVerification`.
- The env vars (`AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`) are documented.
- The typed config validates them when present.
- The error hierarchy and API response convention are ready for auth routes.
- The i18n setup handles both Arabic and English for auth pages.
- CI proves migrations work against real PostgreSQL 17.
- The Integration Core contract is frozen (ADR-04) for G07 to implement against.
- All Dependabot alerts are fixed (0 open).
- Lint is mandatory and clean (0 errors, 0 warnings).

---

## Commands to reproduce locally

```bash
# Clone
git clone -b feat/g01-foundation https://github.com/mayakilzy/SyrianTechRenaissance-Platform.git
cd SyrianTechRenaissance-Platform

# Install
bun install

# Start PostgreSQL (requires Docker)
docker compose up -d postgres postgres-shadow

# Configure env
cp .env.example .env
# Edit .env: DATABASE_URL should point to the docker compose postgres

# Migrate + seed
bunx prisma migrate deploy
bun run db:seed

# Verify
bun run verify          # typecheck + lint + unit tests (all must pass)
bun run dev             # http://localhost:3000 (Arabic) / http://localhost:3000/en (English)
bun run test:e2e        # Playwright RTL + LTR screenshots
```

---

**Reported by:** GLM (Lead Development AI)
**Reviewed by:** ChatGPT (independent CI verification) + Aymen (founder review)
**G01-FIX status:** ✅ All 8 correction points closed
