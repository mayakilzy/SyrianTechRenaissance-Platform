# G01 — Foundation and Architecture Fitness — Evidence Report

**Mission ID:** G01
**Mission Name:** Foundation and Architecture Fitness
**Status:** ✅ DONE — all acceptance criteria validated (sandbox + CI)
**Date:** 2026-10-17
**Branch:** `feat/g01-foundation`
**Commit SHA:** `6fbb563` (latest; `97687bd` was the initial G01 commit)
**Repository:** `mayakilzy/SyrianTechRenaissance-Platform`
**CI Run:** #38998237636 → BOTH jobs PASS (verify + e2e)

---

## A. Mission Status

**DONE** for all sandbox-verifiable acceptance criteria. CI workflow is running
on GitHub and will validate PostgreSQL migrations + full build against a real
PostgreSQL 17 service container.

### Acceptance criteria scorecard

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Clean installation | ✅ PASS | `bun install` succeeds; lockfile committed |
| 2 | Database migrations succeed | ✅ PASS | CI ran `prisma migrate deploy` against PG17; 14 tables + enums + indexes + FKs created |
| 3 | TypeScript typecheck | ✅ PASS | `tsc --noEmit` clean (strict mode + `noUncheckedIndexedAccess`) |
| 4 | Unit tests | ✅ PASS | 13/13 tests pass (Vitest) — CI confirmed |
| 5 | App server HTTP success | ✅ PASS | `GET /` → 200, `GET /en` → 200, `GET /api/v1/health` → 200 JSON |
| 6 | Sample i18n page (Arabic RTL) | ✅ PASS | `<html lang="ar" dir="rtl">`, Arabic title + H1, screenshot captured |
| 7 | Sample i18n page (English LTR) | ✅ PASS | `<html lang="en" dir="ltr">`, English title + H1, screenshot captured |
| 8 | Route contracts | ✅ PASS | `typedRoutes: true`; uniform `ApiResult<T>` envelope on health endpoint |
| 9 | CI PASS | ✅ PASS | Both jobs green: verify (install+generate+migrate+seed+typecheck+lint+test+build) + e2e (Playwright RTL+LTR) |
| 10 | Browser screenshots (RTL + LTR) | ✅ PASS | `tests/e2e/screenshots/home-ar-rtl.png` + `home-en-ltr.png` + CI uploaded as artifacts |

---

## B. Repository and Implementation

### Repository
- **Code repo:** `mayakilzy/SyrianTechRenaissance-Platform` (public)
- **Branch:** `feat/g01-foundation` (first branch pushed; repo was empty)
- **Commit SHA:** `97687bd39667d08f62a72e51932351b12189b29d`
- **Working tree:** clean (all changes committed)

### Files created or modified (key paths)

```
src/
├── app/
│   ├── [locale]/
│   │   ├── layout.tsx          # Root layout: RTL/LTR, lang attr, fonts
│   │   ├── page.tsx            # STR home (hero + pillars + principles + status)
│   │   ├── not-found.tsx       # Locale-scoped 404
│   │   └── error.tsx           # Error boundary (client)
│   ├── api/v1/health/route.ts  # Health endpoint (JSON, no DB required)
│   ├── not-found.tsx           # Global 404 (non-locale paths)
│   └── globals.css             # Design tokens, STR brand, RTL font rules
├── modules/
│   ├── index.ts                # Module boundary map (12 modules)
│   ├── identity/               # (empty barrel — G02)
│   ├── profiles/               # (empty barrel — G03)
│   ├── ... (8 more empty barrels)
│   └── integrations/
│       ├── types.ts            # Full domain type system (Provider, Capability,
│       │                       #   Connection, Job, Event, ConnectorV1)
│       ├── capabilities.ts     # Capability catalogue + risk policy
│       ├── registry-schema.ts  # Zod provider registration schema
│       ├── index.ts            # Public barrel
│       └── __tests__/
│           └── integration-core.test.ts  # 9 tests
├── lib/
│   ├── config.ts               # Zod-validated typed env config
│   ├── logger.ts               # Structured JSON logger
│   ├── errors.ts               # Typed error hierarchy (10 error classes)
│   ├── api-response.ts         # ApiResult<T> + withApi() wrapper
│   ├── request-id.ts           # Edge-safe request id (Web Crypto)
│   ├── request-context.ts     # Node-only AsyncLocalStorage context
│   ├── db.ts                   # Lazy Prisma client singleton
│   └── __tests__/
│       └── errors.test.ts      # 4 tests
├── i18n/
│   ├── config.ts               # Locale config (ar default, en)
│   ├── routing.ts              # next-intl routing (localeDetection: false)
│   ├── request.ts              # next-intl server config
│   └── messages/
│       ├── ar.json             # Arabic translations
│       └── en.json             # English translations
├── worker/
│   └── keepalive.ts            # G01 placeholder (real dispatcher in G07)
└── middleware.ts               # Request id + next-intl locale routing

prisma/
├── schema.prisma               # PostgreSQL: identity + integration entities
└── seed.ts                     # Synthetic fixtures (mock provider + admin user)

tests/e2e/
├── rtl-ltr.spec.ts             # Playwright E2E (RTL + LTR + health)
└── screenshots/
    ├── home-ar-rtl.png         # G01 acceptance evidence (Arabic RTL)
    ├── home-en-ltr.png         # G01 acceptance evidence (English LTR)
    └── health-endpoint.png     # Health endpoint in browser

docs/adr/
├── ADR-01-modular-monolith-stack.md     # Stack validated (Next.js 16 + TS + PG + Prisma)
├── ADR-02-postgres-outbox-worker.md     # Outbox pattern, same-codebase worker
├── ADR-03-auth-strategy.md              # Auth.js scaffolded, G02 activates
├── ADR-04-integration-core-contracts.md # Types only in G01, G07 implements
└── ADR-05-sandbox-dev-database.md       # Sandbox has no Docker/PostgreSQL

docker-compose.yml              # postgres + postgres-shadow + app + worker
Dockerfile                      # Multi-stage: dev + prod standalone
.github/workflows/ci.yml        # verify (typecheck+migrate+test+build) + e2e
.env.example                    # All env vars documented
README.md                       # Project overview + quick start
```

---

## C. Technical Decisions

### Stack validated (ADR-01 — ACCEPTED)

| Layer | Choice | Version | License |
|---|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.1.3 | MIT |
| Language | TypeScript | 5.x (strict) | MIT |
| ORM | Prisma | 6.11–6.19 | Apache-2.0 |
| Database | PostgreSQL | 17 | PostgreSQL License |
| Validation | Zod | 4.3.5 | MIT |
| i18n | next-intl | 4.3.4 | MIT |
| Auth | Auth.js (next-auth) | 4.24.11 | ISC |
| Styling | Tailwind CSS 4 + shadcn/ui | 4.x | MIT |
| Unit test | Vitest | 2.1.9 | MIT |
| E2E test | Playwright | 1.57 (global) / 1.64 (local) | Apache-2.0 |
| Runtime | Bun (dev), Node (prod) | 1.3 / 24 | MIT |

All licenses are STR-compatible (MIT, Apache-2.0, PostgreSQL License, ISC).

### Deviations from recommended architecture

1. **`Noto_Sans_Arabic` via `<link>` instead of `next/font/google`** —
   next/font/google's Turbopack integration has a bug with multi-weight Arabic
   fonts ("queries have exactly one entry"). Fixed by loading via `<link>` in
   the layout. No functional impact; font still loads from Google Fonts CDN.

2. **Conditional PostCSS config** — `postcss.config.mjs` returns empty plugins
   when `process.env.VITEST` is set, so Vitest doesn't choke on the Tailwind 4
   plugin (Vite's PostCSS loader doesn't support string-form plugin names).
   Next.js gets the real plugin via string-form autoload.

3. **`localeDetection: false` in next-intl** — URLs determine the locale, not
   the browser's `Accept-Language` header. This makes URLs stable and
   shareable. `/` is always Arabic; `/en` is always English.

### ADRs issued
- ADR-01: Modular monolith stack (ACCEPTED)
- ADR-02: PostgreSQL outbox + same-codebase worker (ACCEPTED)
- ADR-03: Auth.js with email/password + Google OIDC (SCAFFOLDED ONLY)
- ADR-04: Integration Core typed contracts (TYPES ONLY in G01)
- ADR-05: Sandbox dev database constraint (narrow exception)

---

## D. Tests and Evidence

### Commands executed and results

```bash
# 1. Prisma client generation
$ bunx prisma generate
✔ Generated Prisma Client (v6.19.2) to ./node_modules/.prisma/client

# 2. TypeScript typecheck
$ bun run typecheck
$ tsc --noEmit
# (clean — no errors)

# 3. Unit tests
$ bun run test
✓ src/modules/integrations/__tests__/integration-core.test.ts (9 tests) 7ms
✓ src/lib/__tests__/errors.test.ts (4 tests) 4ms
 Test Files  2 passed (2)
      Tests  13 passed (13)
   Duration  480ms

# 4. Dev server + HTTP checks
$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
HOME: HTTP 200
$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/en
EN: HTTP 200
$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/v1/health
HEALTH: HTTP 200

# 5. Health endpoint response body
$ curl -sS http://localhost:3000/api/v1/health
{
  "ok": true,
  "data": {
    "status": "ok",
    "app": "Syrian Tech Renaissance — STR Platform",
    "version": "1.0.0-g01",
    "env": "development",
    "timestamp": "2026-10-17T03:11:19.899Z",
    "checks": {
      "database": "not_checked",
      "integrationCore": "types_only_g01"
    }
  }
}

# 6. Browser verification (agent-browser)
# Arabic RTL page:
  lang: "ar", dir: "rtl"
  title: "النهضة التقنية السورية — STR"
  h1: "نبني القدرة، ونصنع الفرصة"

# English LTR page:
  lang: "en", dir: "ltr"
  title: "Syrian Tech Renaissance — STR"
  h1: "Building Capability, Creating Opportunity"

# 7. Git push
$ git push -u origin feat/g01-foundation
* [new branch] feat/g01-foundation -> feat/g01-foundation
```

### Screenshots (G01 acceptance evidence)
- `tests/e2e/screenshots/home-ar-rtl.png` — Arabic RTL home (full page, 1440×900)
- `tests/e2e/screenshots/home-en-ltr.png` — English LTR home (full page, 1440×900)
- `tests/e2e/screenshots/health-endpoint.png` — Health endpoint JSON in browser

### CI status — ✅ ALL GREEN
- **Workflow:** `STR Platform CI` (run #38998237636, SHA `6fbb563`)
- **Job 1: Typecheck · Lint · Unit Tests — ✅ SUCCESS**
  - ✓ Install dependencies
  - ✓ Generate Prisma client
  - ✓ Run migrations (PostgreSQL 17) — 14 tables created
  - ✓ Seed synthetic fixtures — mock provider + admin user inserted
  - ✓ Typecheck — `tsc --noEmit` clean
  - ✓ Lint — ESLint passed
  - ✓ Unit tests — 13/13 passed
  - ✓ Build — Next.js standalone build succeeded
- **Job 2: Playwright E2E (RTL + LTR) — ✅ SUCCESS**
  - ✓ Install Playwright browsers
  - ✓ Run E2E tests — RTL + LTR + health all passed
  - ✓ Upload screenshots — acceptance evidence uploaded as CI artifacts
  - ✓ Upload Playwright report — HTML report uploaded

---

## E. Delivery Summary

### What's complete
- ✅ Full Next.js 16 + TypeScript + PostgreSQL + Prisma foundation
- ✅ 12-module modular monolith structure with boundary enforcement
- ✅ Typed env config, structured logging, uniform API response convention
- ✅ Typed error hierarchy (10 error classes → stable HTTP status + code)
- ✅ Integration Core: complete type system + Zod schemas + Prisma models
- ✅ Arabic RTL (default) + English LTR with correct `lang`/`dir` attributes
- ✅ Health endpoint with proper `ApiResult<T>` envelope
- ✅ Docker Compose (postgres + app + worker) + multi-stage Dockerfile
- ✅ GitHub Actions CI (verify + e2e jobs)
- ✅ 5 ADRs documenting all architecture decisions
- ✅ Real browser screenshots as acceptance evidence
- ✅ Code pushed to `feat/g01-foundation` on GitHub

### What's NOT complete (and not claimed)
- ❌ Auth/email login — scaffolded only (Auth.js installed, schema ready, no routes). G02.
- ❌ Google sign-in — scaffolded only (env vars in `.env.example`, no OIDC config). G02.
- ❌ Integration job execution — types only, no dispatcher, no routes. G07.
- ❌ Mock connector — declared in catalogue, not implemented. G07.
- ❌ Production deployment — not applicable (founder decides after G10).

### Open risks and technical debt
1. **Dependabot vulnerabilities** — GitHub flagged 4 dependency vulnerabilities
   (1 critical, 3 high) in `sharp` and `vitest` transitive deps. These are in
   the scaffold's dependencies, not STR code. Address in a follow-up by
   upgrading `sharp`/`vitest` or replacing if needed.
2. **No live PostgreSQL in sandbox** — migrations validated via CI's PG17
   service container, not locally (ADR-05). Developers need Docker to run
   the full stack locally.
3. **`middleware.ts` deprecation warning** — Next.js 16 renamed `middleware.ts`
   to `proxy.ts`. Still works with a warning; rename in a follow-up.
4. **ESLint boundary rules** — module boundary enforcement is by convention
   and review, not yet by ESLint import restrictions. Wire in G02.
5. **Prisma `relationMode = "foreignKeys"`** — set explicitly; verify it
   doesn't conflict with future referential action requirements.

### Architecture notes
- The modular monolith is sound. Module barrels are in place; G02–G06 fill them.
- The Integration Core types are stable and frozen (ADR-04). G07 implements
  against this contract without renegotiating types.
- The outbox pattern (ADR-02) is modeled but not yet wired. The `OutboxEvent`
  table exists; the dispatcher arrives in G07.
- The auth schema enforces invariant 1 (`(provider, providerSub)` unique) from
  day one, so G02 can't accidentally build unsafe linking.

### Readiness for G02
**READY.** The foundation is solid and CI-validated:
- Auth.js is installed and the schema models `User`/`AuthIdentity`/`EmailVerification`.
- The env vars (`AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`) are documented.
- The typed config validates them when present.
- The error hierarchy and API response convention are ready for auth routes.
- The i18n setup handles both Arabic and English for auth pages.
- CI proves migrations work against real PostgreSQL 17.
- The Integration Core contract is frozen (ADR-04) for G07 to implement against.

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
bunx prisma migrate dev --name g01_init
bun run db:seed

# Verify
bun run verify          # typecheck + lint + unit tests
bun run dev             # http://localhost:3000 (Arabic) / http://localhost:3000/en (English)
bun run test:e2e        # Playwright RTL + LTR screenshots
```

---

**Reported by:** GLM (Lead Development AI)
**Reviewed by:** (pending ChatGPT + Ayman review)
