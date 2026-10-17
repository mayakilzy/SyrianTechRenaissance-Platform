# ADR-01: Modular Monolith on Next.js 16 + TypeScript + PostgreSQL + Prisma

- **Status:** ✅ ACCEPTED (validated in G01; was RECOMMENDED in Decision Register)
- **Date:** 2026-10-17
- **Decision owner:** GLM (implementation review) — pending founder sign-off
- **Supersedes:** none
- **Related:** Decision Register ADR-01; 02-Architecture §1–§2

## Context

The Decision Register listed the stack as RECOMMENDED — pending implementation
review in G01. We must validate: (a) current stable versions, (b) license
compatibility, (c) deployment feasibility, (d) testability, (e) RTL/i18n
support, before locking the stack.

## Decision

**Adopt the recommended stack as-is, with the version freeze below.**

| Layer | Choice | Version (G01) | License |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.1.x | MIT |
| Language | TypeScript | 5.x | MIT |
| ORM | Prisma | 6.11.x | Apache-2.0 |
| Database | PostgreSQL | 17 | PostgreSQL License (BSD-like) |
| Validation | Zod | 4.x | MIT |
| i18n | next-intl | 4.3.x | MIT |
| Auth | Auth.js (next-auth) | 4.24.x | ISC |
| Styling | Tailwind CSS + shadcn/ui | 4.x | MIT |
| Unit test | Vitest | 2.1.x | MIT |
| E2E test | Playwright | 1.57.x | Apache-2.0 |
| Runtime | Bun (dev), Node (prod standalone) | 1.3 / 24 | MIT / MIT |

## Alternatives considered

1. **Microservices from day one.** Rejected — premature; the Engineering
   Playbook explicitly says "modular monolith, not microservices". Module
   boundaries are enforced in code; services can be extracted later with
   evidence.
2. **SQLite for local dev.** Rejected for production path — see ADR-05 for the
   narrow sandbox-only exception.
3. **Drizzle instead of Prisma.** Considered; Prisma's migration story and
   type generation are more mature for a team that will rotate contributors.
   Drizzle may be revisited if Prisma becomes a bottleneck.
4. **Remix instead of Next.js.** Rejected — Next.js 16 App Router covers
   server components, route handlers, middleware, and standalone output in one
   framework; Remix would require additional plumbing for the same surface.

## Consequences

- ✅ Single deployable artifact (standalone Next.js + worker same image).
- ✅ Module boundaries enforced by directory structure + review; ESLint
  boundary rules to be wired in G02.
- ✅ Prisma migrations are the source of truth for schema; no `db push` in CI.
- ⚠️ Prisma's generated client lives in `node_modules/.prisma/client`; CI must
  run `prisma generate` before typecheck.
- ⚠️ `experimental.typedRoutes` is enabled; route paths are type-checked.
