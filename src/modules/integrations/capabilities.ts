/**
 * STR Integrations Core — Capability & Risk Catalogue
 * ---------------------------------------------------
 * G01 declares the capability catalogue as TYPES ONLY. No capability is
 * executable yet — the dispatcher and mock connector arrive in G07. This file
 * exists so the type system can be validated by tests and so future missions
 * have a stable surface to implement against.
 *
 * Risk classification follows 04-Integrations-Contracts §"Auth and safeguards":
 *   low      — read-only, no PII, no side effects
 *   medium   — read with scoped PII, or write to user-owned resource
 *   high     — write to shared resource, or read sensitive PII
 *   critical — irreversible side effects (deletion, financial, external comms)
 *
 * Adding a capability requires governance review (ADR-04). Do not declare new
 * capabilities ad hoc.
 */

import type { CapabilityCode, CapabilityDefinition, ProviderId, RiskClass } from "./types";

// Brand constructors (cheap; preserves nominal typing at compile time only).
export const asProviderId = (s: string) => s as ProviderId;
export const asCapabilityCode = (s: string) => s as CapabilityCode;

/**
 * The mock provider is the ONLY provider G01 knows about by id. It is declared
 * here so tests and the G07 implementation have a stable reference. It is NOT
 * registered, enabled, or callable in G01.
 */
export const MOCK_PROVIDER_ID: ProviderId = asProviderId("str.mock.v1");

/**
 * Catalogue of capability definitions. In G01 this is a static readonly list
 * to demonstrate the shape; G07 will move it to the database (ProviderCapability
 * table) with a migration and governance approval flow.
 */
export const CAPABILITY_CATALOGUE: readonly CapabilityDefinition[] = [
  {
    code: asCapabilityCode("application.test"),
    providerId: MOCK_PROVIDER_ID,
    summary:
      "Mock capability used by G07 to exercise the full registry → connection → job → event flow. Has no external side effects.",
    executionMode: "async",
    riskClass: "low",
    requiredScopes: ["mock:run"],
    inputSchemaRef: "str.mock.v1/application.test#input",
    outputSchemaRef: "str.mock.v1/application.test#output",
    idempotent: true,
    cancelable: true,
    timeoutMs: 30_000,
  },
];

/** Look up a capability by code. Returns undefined when not declared. */
export function findCapability(
  code: CapabilityCode,
): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOGUE.find((c) => c.code === code);
}

/** All capabilities offered by a given provider. */
export function capabilitiesForProvider(providerId: ProviderId): CapabilityDefinition[] {
  return CAPABILITY_CATALOGUE.filter((c) => c.providerId === providerId);
}

/** Human-readable risk policy summary; the dispatcher checks this before accepting a job. */
export function riskPolicy(risk: RiskClass): {
  requiresStewardApproval: boolean;
  requiresDualControl: boolean;
  maxRetries: number;
} {
  switch (risk) {
    case "low":
      return { requiresStewardApproval: false, requiresDualControl: false, maxRetries: 3 };
    case "medium":
      return { requiresStewardApproval: false, requiresDualControl: false, maxRetries: 2 };
    case "high":
      return { requiresStewardApproval: true, requiresDualControl: false, maxRetries: 1 };
    case "critical":
      return { requiresStewardApproval: true, requiresDualControl: true, maxRetries: 0 };
  }
}
