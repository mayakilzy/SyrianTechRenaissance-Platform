# ADR-05: Sandbox Development Database Constraint

- **Status:** ✅ ACCEPTED (narrow, sandbox-only exception)
- **Date:** 2026-10-17
- **Related:** ADR-01; Engineering Playbook §"local development"

## Context

The STR Platform sandbox environment used for G01 development does not
provide Docker, and the user account cannot install PostgreSQL system-wide
(no passwordless sudo). ADR-01 mandates PostgreSQL; running SQLite in
production is not an option.

This is a **development environment constraint**, not an architecture
decision. The production path (Docker Compose, CI service container, staging)
all use real PostgreSQL.

## Decision

**The sandbox runs the Next.js dev server without a live database connection.
Database-dependent work is validated in CI (PostgreSQL service container) and
locally via `docker compose up postgres`.**

Concretely:
1. The Prisma schema uses `provider = "postgresql"` unconditionally. There is
   no SQLite fallback in the schema.
2. The Prisma client is lazy-instantiated (`src/lib/db.ts`). Importing the
   module does NOT connect; only calling `db` does.
3. G01's user-visible pages (home RTL, home LTR, error pages) do NOT query the
   database. They render from i18n message catalogs.
4. The `/api/v1/health` endpoint does NOT probe the database; it reports
   `database: "not_checked"` so the probe stays green in the sandbox.
5. CI runs `prisma migrate deploy` + `prisma db seed` against a real
   PostgreSQL 17 service container — this is where migration correctness is
   proven.
6. `docker-compose.yml` is part of the deliverable so the founder can run the
   full stack locally with one command.

## Alternatives considered

1. **Use SQLite in the sandbox with `provider = "sqlite"`.** Rejected — would
   require a separate schema or conditional provider, and would not exercise
   PostgreSQL-specific features (arrays, enums, JSONB) used by the real
   schema. Hiding the real DB behind SQLite is exactly the kind of debt the
   Playbook tells us to avoid.
2. **Install PostgreSQL from source without sudo.** Fragile, slow, and not
   reproducible. Rejected.
3. **Use a remote managed PostgreSQL (Supabase/Neon).** Introduces an external
   dependency and credentials in the sandbox. Rejected for G01; can be
   reconsidered for staging in G10.

## Consequences

- ✅ One schema, one provider, one migration path. No SQLite/PostgreSQL drift.
- ✅ The sandbox home page is fast (no DB round-trip) and stays up even when
  no DB is configured.
- ✅ CI is the source of truth for "do migrations actually work?" — the
  sandbox is not.
- ⚠️ A developer running `bun run dev` in the sandbox without Docker cannot
  test DB-backed routes. They must run `docker compose up postgres` first.
  This is documented in the README.
- ⚠️ The `db:seed` script cannot run in the sandbox. It runs in CI and in the
  Docker Compose stack.
