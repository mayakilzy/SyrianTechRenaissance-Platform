# ADR-04: Integration Core — Typed Contracts First, Functional Slice in G07

- **Status:** ✅ ACCEPTED for the contract shape; ⏳ TYPES ONLY in G01
- **Date:** 2026-10-17
- **Related:** Decision Register ADR-04, STR-05; 04-Integrations-Contracts; 02-Architecture §6

## Context

04-Integrations-Contracts specifies a registry, capabilities, connections,
jobs, events, and a mock connector. The temptation is to ship a few API routes
that look like they work. The Playbook explicitly forbids this: "No fake
integrations/placeholder buttons advertised as live."

The real value of G01 for the integration core is to **lock the contract** so
G02–G06 can build against it, and G07 can implement the functional vertical
slice without renegotiating types.

## Decision

**G01 ships the integration core as types + schema + catalogue only. No
runtime dispatcher. No API routes for jobs/connections. No mock connector
implementation.**

Concretely, G01 delivers:
1. `src/modules/integrations/types.ts` — the full domain type system
   (`ProviderDefinition`, `CapabilityDefinition`, `Connection`,
   `IntegrationJob`, `IntegrationEvent`, `ConnectorV1`, all enums and branded
   ids).
2. `src/modules/integrations/capabilities.ts` — the capability catalogue
   (static in G01, moves to DB in G07) with `MOCK_PROVIDER_ID` and the
   `application.test` capability declaration.
3. `src/modules/integrations/registry-schema.ts` — the Zod schema for
   provider registration submissions, with SSRF/HTTPS/risk validation.
4. Prisma models for `IntegrationProvider`, `IntegrationCapability`,
   `IntegrationConnection`, `ConsentRecord`, `IntegrationJob`,
   `IntegrationEvent`, `CredentialReference`, `OutboxEvent`.
5. Unit tests proving the schema rejects invalid submissions and the risk
   policy escalates correctly.

G01 does NOT deliver:
- Any `/api/v1/integrations/*` route (those land in G07).
- Any runtime job dispatcher (G07).
- Any mock connector implementation (G07).
- Any provider approval workflow UI (G07 + governance mission).

## Alternatives considered

1. **Ship a `/api/v1/integrations/providers` GET route returning the static
   catalogue.** Tempting but premature — it implies the registry is queryable
   at runtime, which would invite clients to depend on a shape that G07 will
   change (pagination, auth, filtering). The types are enough for G01.
2. **Skip the Prisma models until G07.** Rejected — the schema is the
   contract's persistence layer; defining it now lets G02–G06 reference it
   and lets CI validate migrations from day one.
3. **Implement the mock connector in G01.** Rejected — G07 is explicitly
   scoped for the functional vertical slice. Doing it now would either be
   rushed or would expand G01's scope past its mandate.

## Consequences

- ✅ The contract is stable and type-checked. G07 implements against a frozen
  surface, not a moving target.
- ✅ The schema validates against PostgreSQL in CI; migrations are real.
- ✅ No fake routes, no placeholder buttons, no false claims.
- ⚠️ A reader of the codebase in the G01 state will see types but no running
  integration. This is by design and documented here, not hidden.
- ⚠️ The capability catalogue is static in G01; G07 must migrate it to the
  `IntegrationCapability` table without breaking the type.
