/**
 * STR Integrations Core — Provider Registration Schema (Zod)
 * ----------------------------------------------------------
 * The schema governance uses to review a new provider submission. G01 ships
 * the SCHEMA only — there is no `/api/v1/integrations/providers` POST route
 * in G01. Governance onboarding flow is G07.
 *
 * The schema is intentionally strict: every field that can be validated
 * structurally is validated. Business validation (does this origin belong to
 * the claimed provider? is the risk class appropriate?) stays human-in-the-loop.
 */

import { z } from "zod/v4";

export const providerAuthModeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("oauth2_oidc"),
    issuer: z.string().url(),
    scopes: z.array(z.string().min(1)).min(1),
    pkce: z.literal(true),
  }),
  z.object({
    kind: z.literal("api_key"),
    headerName: z.string().min(1).max(64),
    scopes: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("mock"),
  }),
]);

export const webhookSigningSchema = z.object({
  algorithm: z.literal("hmac-sha256"),
  headerName: z.string().min(1).max(64),
  timestampHeader: z.string().min(1).max(64),
  replayWindowMs: z.number().int().positive().max(86_400_000), // <= 24h
});

/**
 * Schema for a provider registration submission. The `id` is derived from
 * `slug` + version by the registry; submitters do not choose it freely.
 */
export const providerRegistrationSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, "slug must be lowercase, kebab-case, start with a letter"),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "version must be semver MAJOR.MINOR.PATCH"),
  displayName: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  owner: z.string().min(1), // STR member id; verified by governance
  baseOrigin: z
    .string()
    .url()
    .refine((v) => v.startsWith("https://"), "baseOrigin must be HTTPS"),
  authMode: providerAuthModeSchema,
  webhookSigning: webhookSigningSchema.optional(),
  requestedCapabilities: z
    .array(
      z.object({
        code: z.string().min(1).max(120),
        summary: z.string().min(10).max(500),
        executionMode: z.enum(["sync", "async"]),
        riskClass: z.enum(["low", "medium", "high", "critical"]),
        requiredScopes: z.array(z.string().min(1)).min(1),
        idempotent: z.boolean(),
        cancelable: z.boolean(),
        timeoutMs: z.number().int().positive().max(3_600_000),
      }),
    )
    .min(1),
});

export type ProviderRegistration = z.infer<typeof providerRegistrationSchema>;

/**
 * Validate a registration submission. Returns a typed result; the registry
 * layer calls this before persisting. Governance approval is a separate step.
 */
export function validateProviderRegistration(input: unknown) {
  return providerRegistrationSchema.safeParse(input);
}
