# Syrian Tech Renaissance — STR Platform v1.0

> مبادرة سورية المنشأ والرسالة، عالمية الانفتاح والتعاون.
> *Syrian in origin and mission, global in openness and collaboration.*

**Status:** G01 — Foundation and Architecture Fitness (in progress)

The STR Platform is the institutional backbone of the Syrian Tech Renaissance
initiative: a modular monolith that manages identity, talent, project
governance, opportunities, partnerships, contributions, and a real
integration core. This is **v1.0 only** — the STR Academy and STR Engineering
Ecosystem are separate future projects.

---

## What's in this repository

This is the **code repository** (`SyrianTechRenaissance-Platform`). The
authoritative specifications, architecture, and mission definitions live in a
separate docs repository at
`mayakilzy/repo-info/SyrianTechRenaissance/Platform/`. See `docs/adr/` here
for architecture decisions validated during G01.

### Stack (locked in G01 — see ADR-01)

- **Next.js 16** (App Router, Turbopack, standalone output)
- **TypeScript 5** (strict mode)
- **PostgreSQL 17** + **Prisma 6.11** ORM
- **Auth.js** (scaffolded; activated in G02)
- **next-intl** (Arabic RTL default + English LTR)
- **Tailwind CSS 4** + **shadcn/ui**
- **Zod 4** for all input validation
- **Vitest** + **Playwright** for testing
- **Docker Compose** for the local stack

### Module structure (ADR-01 — modular monolith)

```
src/modules/
  identity/        — users, credentials, email verification, sessions
  profiles/        — professional profiles, skills, portfolio
  proposals/       — project charters, revisions, review
  teams/           — approved-team governance (STR-GOV-TEAM-01)
  opportunities/   — lifecycle, applications, reviews
  projects/        — milestones, tasks, deliverables
  organizations/   — partners, representatives, partnerships
  contributions/   — contribution attribution, rights metadata
  communications/  — contextual threads, notifications
  governance/      — moderation, approvals, audit, resource grants
  impact/          — evidence-backed impact measurement
  integrations/    — registry, capabilities, connections, jobs, events
```

G01 implements the `integrations` module's **types and contracts only**
(ADR-04). The other modules are scaffolded as empty barrels; their
implementations land in G02–G06.

---

## Quick start

### Prerequisites

- Node.js 24+ and Bun 1.3+
- Docker (for PostgreSQL) — OR a reachable PostgreSQL 17 instance

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL to your PostgreSQL connection string.
# AUTH_SECRET is only required to activate Auth.js (G02+); leave blank for G01.
```

### 3. Start PostgreSQL + the app (recommended)

```bash
docker compose up -d postgres postgres-shadow
bunx prisma migrate dev --name g01_init
bun run db:seed
bun run dev
# → http://localhost:3000  (Arabic RTL home)
# → http://localhost:3000/en  (English LTR home)
```

### 3b. Sandbox / no Docker

The G01 home pages render without a database connection (ADR-05). You can
run `bun run dev` and view the home page even without PostgreSQL. DB-backed
routes require a running Postgres (CI validates these automatically).

### 4. Verify

```bash
bun run verify          # typecheck + lint + unit tests
bun run test:e2e        # Playwright browser tests (RTL + LTR screenshots)
```

---

## Project layout

```
.
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── [locale]/          # i18n segment (ar = default, en = /en)
│   │   │   ├── layout.tsx     # root layout with <html lang/dir>
│   │   │   ├── page.tsx       # STR home
│   │   │   ├── not-found.tsx
│   │   │   └── error.tsx
│   │   ├── api/v1/health/     # health endpoint (JSON)
│   │   ├── not-found.tsx      # global 404
│   │   └── globals.css        # design tokens, RTL font rules
│   ├── modules/               # domain modules (see above)
│   ├── lib/                   # config, logger, errors, api-response, db
│   ├── i18n/                  # next-intl config + ar/en message catalogs
│   ├── worker/                # outbox dispatcher (G07; keepalive stub in G01)
│   └── middleware.ts          # request id + next-intl locale routing
├── prisma/
│   ├── schema.prisma          # PostgreSQL schema (identity + integrations)
│   └── seed.ts                # synthetic fixtures
├── tests/e2e/                 # Playwright (RTL/LTR acceptance evidence)
├── docs/adr/                  # Architecture Decision Records
├── docker-compose.yml         # postgres + postgres-shadow + app + worker
├── Dockerfile                 # multi-stage: dev + prod standalone
├── .github/workflows/ci.yml   # typecheck + migrate + test + build + e2e
└── .env.example               # all env vars with documentation
```

---

## G01 acceptance evidence

| Criterion | Where it's proven |
|---|---|
| Clean installation | `bun install` + CI green |
| Database migrations succeed | CI `prisma migrate deploy` against PG17 |
| TypeScript typecheck passes | `bun run typecheck` + CI |
| Unit tests pass | `bun run test` + CI |
| App server HTTP success | `GET /` returns 200; `GET /api/v1/health` returns 200 JSON |
| Sample i18n page (Arabic RTL) | `/` renders `lang="ar" dir="rtl"` |
| Sample i18n page (English LTR) | `/en` renders `lang="en" dir="ltr"` |
| Route contracts intact | `experimental.typedRoutes` + Vitest route checks |
| CI passes | `.github/workflows/ci.yml` (verify + e2e jobs) |
| Browser screenshots (RTL + LTR) | `tests/e2e/screenshots/home-{ar-rtl,en-ltr}.png` |

## What G01 does NOT claim

- ❌ Auth/email login is NOT active (scaffolded; G02).
- ❌ Google sign-in is NOT active (scaffolded; G02).
- ❌ Integration jobs do NOT execute (types only; G07).
- ❌ No production deployment (founder decides go-live after G10).

---

## License

MIT. See `package.json`.

## Governance

This project is politically, religiously, sectarianly, and party-neutral
(STR-01). Operational teams exist only through approved project charters
(STR-GOV-TEAM-01). See the docs repository for the full Decision Register.
