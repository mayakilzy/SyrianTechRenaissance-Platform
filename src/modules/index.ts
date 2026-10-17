/**
 * STR Platform — Module Boundary Map
 * ----------------------------------
 * The platform is a modular monolith (ADR-01). Each module owns its data,
 * services, and route handlers. Cross-module access goes through the module's
 * exported service interface, never through direct table reads.
 *
 * This file is the canonical reference for module identity. Importing it is
 * the supported way to reference a module name (avoids string drift).
 *
 * See 02-Architecture §3 "Module boundaries" for the full rationale.
 */

export const MODULES = [
  "identity",
  "profiles",
  "proposals",
  "teams",
  "opportunities",
  "projects",
  "organizations",
  "contributions",
  "communications",
  "governance",
  "impact",
  "integrations",
] as const;

export type ModuleName = (typeof MODULES)[number];

/**
 * Convention: every module exports a barrel `index.ts` whose surface is
 * intentionally small. A module may export:
 *   - types    (domain & DTO shapes)
 *   - service  (functions other modules call)
 *   - schema   (Zod validators for its inputs)
 *   - routes   (Next.js route handlers under app/api/v1/<module>/...)
 *
 * A module MUST NOT import from another module's internal files. Only its
 * public barrel is fair game. This is enforced by review + ESLint boundary
 * rules (to be wired in G02).
 */
