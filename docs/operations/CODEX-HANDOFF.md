# STR Platform — CODEX Session Handoff

> **Document type:** Session handoff (read-only reference for the next engineering agent).
> **Source agent:** GLM (Engineering Agent) — session closed after this commit.
> **Target agent:** Codex.
> **Baseline SHA:** `635abbae2dd88ca8e27e2582d079b1de6c541e13` (G10-04A merge commit on `main`).
> **Handoff SHA:** the SHA of this commit (see `git log -1` after merge).
> **Date:** 2026-10-21.

This document is a concise orientation for the next agent. It does **not**
replace the operational runbooks already in `docs/operations/` — those are
the authoritative source for procedures. This document is a navigation map.

---

## 1. Project Identity and Purpose

**Project name:** Syrian Tech Renaissance — STR Platform (v1.0).
**Repository:** `mayakilzy/SyrianTechRenaissance-Platform` (private).
**Purpose:** An institutional platform for engineers, volunteers,
organizations, and partnerships to collaborate on proposals, projects,
deliverables, integrations, and impact tracking — with bilingual
(Arabic / English) UI and accessibility as first-class concerns.

**Current phase:** Engineering foundation complete (G01–G10-04A).
Staging deployment is the next operational milestone.

---

## 2. Authoritative Git SHA

| Item | Value |
|------|-------|
| Authoritative `main` HEAD | `635abbae2dd88ca8e27e2582d079b1de6c541e13` |
| Merge commit subject | `G10-04A: Server Discovery & Deployment Blueprint (#5)` |
| Merge date | 2026-10-21 06:20:59 UTC |
| Verified post-merge CI | STR Platform CI #274 — SUCCESS (Typecheck/Lint/Unit + Playwright E2E RTL+LTR) |
| Verified by | GLM (engineering agent) + MASTER (independent GitHub review) |

All work for G01–G10-04A is merged. No open PRs. No unpushed commits.

---

## 3. Application Architecture and Stack

### 3.1 Stack (from ADR-01)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Bun 1.3 (dev) + Node 20+ (prod standalone) | Bun for installs + worker; Node for Next.js standalone |
| Framework | Next.js 16.1.3 (App Router) | `output: "standalone"` enabled |
| Language | TypeScript 5 | strict mode |
| Database | PostgreSQL 17 | Prisma ORM v6.11 |
| Auth | NextAuth.js v4 + Argon2 | Google OAuth scaffolded, not yet wired |
| UI | React 19 + shadcn/ui (Radix) + Tailwind CSS 4 | RTL + LTR supported |
| i18n | next-intl v4 | Arabic + English, default `ar` |
| Logging | Custom structured JSON logger | `reqId` correlation |
| Tests | Vitest (unit) + Playwright (E2E) | RTL + LTR suites |
| Container | Docker multi-stage (dev / build / prod) | Single image for web + worker |

### 3.2 Architecture pattern (from ADR-02)

**Modular monolith** with an **outbox worker**:

- **Web app** (`node server.js`) — Next.js standalone server. Handles HTTP
  requests, runs API routes, renders pages. Stateless except for session
  cookies (NextAuth).
- **Worker** (`bun run src/worker/index.ts`) — background dispatcher. Polls
  the `OutboxEvent` table, claims `IntegrationJob` rows via a lease
  mechanism (60s threshold), executes them via adapters, marks results
  conditionally. Graceful shutdown via `AbortSignal` + `cancellableSleep`.
- **Database** — PostgreSQL 17. Single source of truth. Both web and
  worker connect via Prisma.

### 3.3 Domain modules (`src/modules/`)

11 modules, each with `service.ts` and `__tests__/`:

| Module | Purpose |
|--------|---------|
| `identity` | users, sessions, password, rate limiter, OAuth linking, email service |
| `profiles` | user profile CRUD |
| `proposals` | proposal lifecycle (draft → submit → review → approve) |
| `teams` | team invitations, accept/decline |
| `projects` | project execution, deliverables, milestones, tasks, threads, files |
| `opportunities` | opportunity posting, applications, reviews |
| `talent` | talent search and visibility |
| `organizations` | org verification, representatives, suspend/reactivate |
| `partnerships` | partnership lifecycle, agreement management |
| `moderation` | complaints and decisions |
| `communications` | threads, messages |
| `notifications` | in-app notifications |
| `impact` | impact records |
| `admin` | dashboard, audit, grants, suspensions |
| `integrations` | provider registry, connections, jobs, outbox, adapters, secret crypto |
| `governance` | authorize helpers (project + policy) |

### 3.4 CI workflows (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` (STR Platform CI) | push to main / feat/** / PR | Typecheck + Lint + Unit + Playwright E2E (RTL + LTR) |
| `docker-build.yml` (Docker Production Build) | push to feat/g10-runtime-foundation / PR | Build prod image + smoke test + worker imports |
| `g10-02-integration.yml` (G10-02 Runtime Integration) | push to feat/g10-02-runtime-integration / PR | Docker Compose integration test (postgres + web + worker, B1-B5 + C1-C4) |
| `g10-03-staging-validation.yml` (G10-03 Staging Compose Validation) | push to feat/g10-03-staging-hardening / PR | Empirical verification of the actual staging compose (C1-C7) |

---

## 4. Development and Test Commands

All commands assume Bun 1.3 is installed (or use `bunx` / `docker compose`).

### 4.1 Install dependencies

```bash
bun install --frozen-lockfile
```

### 4.2 Generate Prisma client

```bash
bunx prisma generate
```

### 4.3 Development server (hot reload)

```bash
bun run dev          # Next.js dev server on http://localhost:3000
# OR via Docker:
docker compose up -d   # brings up postgres + app + worker
```

### 4.4 Typecheck + lint + unit tests

```bash
bun run verify        # runs typecheck + lint + vitest
# OR individually:
bun run typecheck
bun run lint
bun run test          # vitest run (one-shot)
bun run test:watch    # vitest watch
bun run test:coverage # vitest with coverage
```

### 4.5 E2E tests (Playwright)

```bash
bun run test:e2e      # headless
bun run test:e2e:ui   # interactive UI mode
```

E2E tests cover G03–G09 flows including:
- auth-flow, proposal-flow, talent-opportunity-flow, project-execution-flow
- institutional-governance-flow, integration-flow, visual-accessibility
- anti-self, browser-interactive, cross-isolation, csrf-sessions
- injection-file-access, rbac-idor, webhook-http, rtl-ltr, security-negative

### 4.6 Database operations

```bash
bunx prisma migrate dev     # local dev: create + apply new migration
bunx prisma migrate deploy   # staging/prod: apply pending migrations only (idempotent)
bunx prisma migrate status   # check applied vs pending
bunx prisma migrate reset    # LOCAL DEV ONLY: drop + re-apply + re-seed
bun run db:seed               # load synthetic seed data
bun run db:seed-test          # load test-only fixtures
```

---

## 5. Docker and Non-Docker Startup Options

### 5.1 Non-Docker (local dev with Bun)

Requires: Bun 1.3+, PostgreSQL 17 reachable at `DATABASE_URL`.

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL, AUTH_SECRET, etc.

# 2. Install deps + generate Prisma client
bun install --frozen-lockfile
bunx prisma generate

# 3. Apply migrations (requires DATABASE_SHADOW_URL for dev migrations)
bunx prisma migrate dev

# 4. Seed (optional)
bun run db:seed

# 5. Start dev server
bun run dev
```

Web at http://localhost:3000.

### 5.2 Docker — local dev (`docker-compose.yml`)

Brings up PostgreSQL + dev app + worker with hot reload.

```bash
docker compose up -d                                   # full stack
docker compose up -d postgres postgres-shadow         # just DB
docker compose run --rm app bunx prisma migrate dev    # apply migrations
docker compose run --rm app bun run db:seed            # seed
```

### 5.3 Docker — staging (`docker-compose.staging.yml`)

Production-grade stack. Uses built prod image, no source mounts, `restart: always`.

```bash
# Build the prod image first
docker build --target prod -t str-platform:staging .

# CRITICAL: --env-file is required (compose uses ${POSTGRES_PASSWORD:?...} interpolation)
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d
```

See `docs/operations/staging-deployment.md` for the full 9-step deployment procedure.

### 5.4 Docker — integration test (`docker-compose.integration.yml`)

Disposable compose for CI / local reproduction of integration tests.

```bash
docker build --target prod -t str-platform:g10-02 .
docker compose -f docker-compose.integration.yml up -d postgres
docker compose -f docker-compose.integration.yml up migrate
docker compose -f docker-compose.integration.yml up seed
docker compose -f docker-compose.integration.yml up -d app worker
# Test against http://localhost:3001
docker compose -f docker-compose.integration.yml down -v   # cleanup
```

---

## 6. Database Migration Instructions

### 6.1 Migration history (11 migrations, all forward-only)

```
20261017000000_g01_init
20261017040000_g02_identity_profiles
20261017060000_g03_proposals_teams
20261017070000_g03_steward_history
20261017080000_g04_talent_opportunities
20261017090000_g04_notifications
20261018000000_g05_project_execution
20261019000000_g06a_organizations_partnerships_rights
20261019020000_g06b_threads_moderation_impact
20261019030000_g06_moderation_corrections
20261019040000_g07_integration_functional
```

Plus `migration_lock.toml` (`provider = "postgresql"`).

### 6.2 Applying migrations in staging

Use the `migrate` compose service (defined in `docker-compose.staging.yml`):

```bash
# Idempotent — applies pending migrations only, exits 0 if up-to-date
docker compose --env-file .env.staging -f docker-compose.staging.yml up migrate
```

App and worker depend on `migrate: service_completed_successfully` — they will
NOT start if migrations fail.

### 6.3 Rollback

Prisma migrations are forward-only. Rollback = restore from a pre-migration
backup. See `docs/operations/backup-restore.md` §4.3 for the procedure.

### 6.4 Creating a new migration (dev only)

```bash
# Edit prisma/schema.prisma to add/modify a model
bunx prisma migrate dev --name descriptive_name
# This creates a new migration file in prisma/migrations/ and applies it locally.
# Commit the new migration file. It will be applied in staging via migrate deploy.
```

---

## 7. Browser Preview Requirements

### 7.1 Local preview (no Docker)

After `bun run dev`:
- Open http://localhost:3000
- Default locale: Arabic (RTL layout).
- Switch to English via the language switcher in the header.

### 7.2 Local preview (Docker dev)

```bash
docker compose up -d
# Wait ~30s for hot-reload compilation
open http://localhost:3000
```

### 7.3 Staging preview (after G10-04B deployment)

Once staging is live at `https://<staging-domain>`:
- Liveness: `curl https://<domain>/api/v1/health`
- Readiness: `curl https://<domain>/api/v1/ready`
- Home: `https://<domain>/ar` (Arabic) or `https://<domain>/en` (English)

### 7.4 Production preview

Not yet authorized. Production launch blockers listed in §9 below.

---

## 8. Known Gaps and Deployment Blockers

### 8.1 Staging deployment blockers (require MASTER input)

These do NOT block engineering — they block the actual staging deployment
(G10-04B):

1. **Server discovery output** — MASTER must run
   `bash docs/operations/server-discovery.sh` on the staging server and
   share the output with the next agent.
2. **D1: Reverse proxy choice** — Caddy / NPM / existing Nginx / existing Traefik.
3. **D2: Topology** — #1 (proxy on host) or #2 (proxy in Docker container).
4. **D3: Staging subdomain** (BLOCKER) — e.g., `staging.str.platform`.
5. **D10: First admin user email** (BLOCKER for seed).

See `docs/operations/g10-04a-server-blueprint.md` Track C for the full
10-item MASTER-decision list (D1–D10).

### 8.2 Production launch blockers (do NOT block staging)

Carried from `docs/PRODUCTION-READINESS-NOTES.md` (G02) + G10-03
NOT_TESTED items:

1. Test email file permissions (only matters if `STR_TEST_MODE=1`, never in prod).
2. Prevent `STR_TEST_MODE` activation in production (startup assertion needed in `src/lib/config.ts`).
3. Real email delivery service (currently `LogEmailService`).
4. Distributed rate limiter (currently in-memory, single-instance only).
5. Google OIDC credentials + redirect test (requires founder OAuth app).
6. Interrupted worker recovery during mid-processing — per-adapter test
   before real adapters go live (staging-safe with mock adapter).

### 8.3 NOT_TESTED capabilities (do NOT block staging)

- Real S3 / object storage integration (placeholder `readUrl`).
- Real SMTP email service (`LogEmailService` default).
- Real Google OAuth flow (scaffolded, hidden when `GOOGLE_CLIENT_ID` not set).
- Backup/restore procedures end-to-end (DOCUMENTED in
  `docs/operations/backup-restore.md`, but not yet run on a real server).
- Migration rollback drill (procedure documented, not yet executed).

### 8.4 Staging acceptance tests (must run on real staging server before declaring "production-ready")

1. End-to-end deployment (Steps 1–8 in `staging-deployment.md`).
2. Backup-and-restore round trip (`backup-restore.md` §12.3 #1).
3. Reverse proxy verification — HTTPS works AND app NOT directly reachable on port 3000.
4. Migration rollback drill (`backup-restore.md` §12.3 #4).
5. Worker graceful shutdown on real server (`backup-restore.md` §12.3 #5).
6. Log inspection — structured JSON, `reqId` correlation, no secret leakage.

---

## 9. Mission History (condensed)

| Mission | Status | PR # | Merge SHA |
|---------|--------|------|-----------|
| G01 — Foundation | CLOSED | (early merge) | (historical) |
| G02 — Identity, Profiles, Roles | CLOSED | (early merge) | (historical) |
| G03 — Proposals, Teams | CLOSED | (early merge) | (historical) |
| G04 — Talent, Opportunities | CLOSED | (early merge) | (historical) |
| G05 — Project Execution | CLOSED | (early merge) | (historical) |
| G06 — Institutional Functions | CLOSED | (early merge) | (historical) |
| G07 — Integration Core | CLOSED | (early merge) | (historical) |
| G08 — UI/UX + Localization | CLOSED | (early merge) | (historical) |
| G09 — Security + Browser Verification | CLOSED | PR #1 | `c6897c52c5ef...` |
| G10-01 — Runtime Foundation | CLOSED | PR #2 | `4773ac439cd9...` |
| G10-02 — Runtime Integration Verification | CLOSED | PR #3 | `006f5f79ec1a...` |
| G10-03 — Staging Hardening + Operational Runbooks | CLOSED | PR #4 | `1fe0881f4ab1...` |
| G10-04A — Server Discovery & Deployment Blueprint | CLOSED | PR #5 | `635abbae2dd8...` |

The full chronological work log is preserved in the agent workspace at
`/home/z/my-project/worklog.md` (multi-agent shared log, 236+ lines,
covering all G10-02 → G10-04A-merge entries). This log is automatically
preserved across agent sessions — Codex can read it to understand context.

---

## 10. Key Documentation Files (where to look)

| File | Purpose |
|------|---------|
| `README.md` | Project overview + setup |
| `docs/adr/ADR-01-modular-monolith-stack.md` | Stack decision |
| `docs/adr/ADR-02-postgres-outbox-worker.md` | Outbox pattern |
| `docs/adr/ADR-03-auth-strategy.md` | Auth strategy |
| `docs/adr/ADR-04-integration-core-contracts.md` | Integration contracts |
| `docs/adr/ADR-05-sandbox-dev-database.md` | Dev database |
| `docs/PRODUCTION-READINESS-NOTES.md` | Production blockers list |
| `docs/G01-Evidence-Report.md` ... `G08_UI_COVERAGE_MATRIX.md` | Per-mission evidence |
| `docs/operations/startup.md` | How to start / stop / check / troubleshoot |
| `docs/operations/staging-deployment.md` | 9-step staging deployment runbook |
| `docs/operations/backup-restore.md` | Backup + restore + migration rollback runbook |
| `docs/operations/server-discovery.sh` | Read-only server probe script (Track A) |
| `docs/operations/g10-04a-server-blueprint.md` | Deployment architecture + prerequisites + execution plan |
| `docs/operations/CODEX-HANDOFF.md` | This file |

---

## 11. Next Mission: STR-G11-01

Per MASTER's stated next priority (after staging is live + verified):
**the team will move to UI/UX work** — designing the user-facing
experience on top of a live, verifiable staging deployment.

Before G11-01 can start, G10-04B (actual staging deployment) must complete
successfully. Before G10-04B can start, MASTER must:

1. Run the discovery script on the staging server.
2. Share the reviewed output with Codex.
3. Answer D1–D3 + D10 (see §8.1 above).
4. Authorize G10-04B (separate mission).

Suggested G11-01 scope (subject to MASTER approval):
- Audit existing UI components (`src/components/ui/`, `src/components/shared/`).
- Identify accessibility gaps (already partly covered by G08 + G09 E2E tests).
- Propose UX improvements for the main user journeys:
  - Auth (signup / signin / verify-email / reset-password).
  - Proposal creation + review.
  - Project workspace + deliverables + milestones.
  - Opportunities + applications.
  - Integrations page.
  - Admin dashboard.
- Bilingual (AR + EN) design polish.
- Mobile responsive review.

---

## 12. Boundaries for the Next Agent

Carry these forward from the G10-04A directive:

- No automatic merge — always create a PR and wait for MASTER authorization.
- No deployment or server changes without explicit MASTER mission.
- No DNS or firewall changes.
- No installation or removal of software on MASTER's server.
- No production data.
- No public launch.
- No unrelated feature development.
- No UI/UX redesign without explicit G11-01 authorization.
- No Academy or external tools integration.

---

## 13. Closing Note

The STR Platform engineering foundation is complete and verified. All
5 PRs (G09, G10-01, G10-02, G10-03, G10-04A) are merged to `main` with
all CI green. The platform builds, runs, migrates, serves health/readiness,
processes outbox jobs, and gracefully shuts down — all empirically
verified in CI.

The next operational step is **staging deployment** (G10-04B), which
requires MASTER's server-discovery output + strategic decisions. After
staging is live and verified, the team moves to **UI/UX work** (G11-01)
on top of a verifiable live deployment.

Handoff complete. Read `worklog.md` in the agent workspace for full
chronological context.

— GLM Engineering Agent
