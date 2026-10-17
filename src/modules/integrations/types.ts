/**
 * STR Integrations Core — Domain Types
 * ------------------------------------
 * The authoritative type system for the integration subsystem. These types are
 * the contract every future connector must implement. G01 ships ONLY these
 * types and the provider registration schema — there are no fake routes, no
 * mock job execution, no pretend connections. Functional vertical slice lands
 * in G07 (see missions/G07-...).
 *
 * Source of truth: 04-Integrations-Contracts.md
 * Related ADR: ADR-04 (capability/connector registry + jobs + events, mock).
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Stable, human-readable provider id, e.g. "str.mock.v1". */
export type ProviderId = string & { readonly __brand: "ProviderId" };

/** Capability code namespaced by provider domain, e.g. "application.test". */
export type CapabilityCode = string & { readonly __brand: "CapabilityCode" };

/** Opaque connection id; only meaningful server-side. */
export type ConnectionId = string & { readonly __brand: "ConnectionId" };

/** Job id assigned by the dispatcher; unique and immutable. */
export type IntegrationJobId = string & { readonly __brand: "IntegrationJobId" };

/** Provider-assigned event id used for idempotent ingestion. */
export type ProviderEventId = string & { readonly __brand: "ProviderEventId" };

/** Reference to a stored credential; the secret itself never lives in memory here. */
export type CredentialReferenceId = string & { readonly __brand: "CredentialReferenceId" };

// ---------------------------------------------------------------------------
// Trust & lifecycle enums
// ---------------------------------------------------------------------------

export type ProviderTrustStatus =
  | "registered" // submitted, awaiting review
  | "approved" // governance approved the provider
  | "enabled" // active and callable
  | "suspended" // temporarily disabled
  | "revoked"; // permanently removed; new jobs blocked

export type ConnectionStatus =
  | "pending" // consent initiated, not yet completed
  | "active" // usable
  | "revoked" // user/governance revoked; new jobs blocked
  | "error"; // last operation failed; needs attention

export type IntegrationJobStatus =
  | "queued" // accepted by dispatcher, not yet running
  | "running" // handed to a worker
  | "succeeded" // final success — result attached
  | "failed" // final failure — failure category attached
  | "cancelled"; // explicitly cancelled or timed out

export type ExecutionMode =
  | "sync" // provider resolves within the request (rare)
  | "async"; // dispatcher enqueues; result arrives via polling or webhook

export type RiskClass = "low" | "medium" | "high" | "critical";

// ---------------------------------------------------------------------------
// Provider & capability definitions
// ---------------------------------------------------------------------------

/**
 * A registered integration provider. Providers go through governance review
 * before they can be enabled. The base origin is allowlisted for outbound calls
 * (SSRF defense — see 04-Integrations-Contracts §"Auth and safeguards").
 */
export interface ProviderDefinition {
  id: ProviderId;
  displayName: string;
  description: string;
  owner: string; // STR member accountable for this provider
  baseOrigin: string; // HTTPS origin; outbound calls limited to this
  trustStatus: ProviderTrustStatus;
  version: string; // semver of the provider contract
  supportedCapabilities: CapabilityCode[];
  authMode: ProviderAuthMode;
  webhookSigning?: WebhookSigningSpec;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export type ProviderAuthMode =
  | { kind: "oauth2_oidc"; issuer: string; scopes: string[]; pkce: true }
  | { kind: "api_key"; headerName: string; scopes: string[] }
  | { kind: "mock" }; // in-process mock provider; no external calls

export interface WebhookSigningSpec {
  algorithm: "hmac-sha256";
  headerName: string;
  timestampHeader: string;
  replayWindowMs: number;
}

/**
 * A capability is a single callable operation a provider exposes. Input/output
 * are described as Zod schema references (the actual schemas live alongside the
 * provider). Required scopes and risk class drive authorization.
 */
export interface CapabilityDefinition {
  code: CapabilityCode;
  providerId: ProviderId;
  summary: string;
  executionMode: ExecutionMode;
  riskClass: RiskClass;
  requiredScopes: string[];
  inputSchemaRef: string; // path to a Zod schema, e.g. "str.mock.v1/application.test#input"
  outputSchemaRef: string;
  idempotent: boolean;
  cancelable: boolean;
  timeoutMs: number;
}

// ---------------------------------------------------------------------------
// Connections & credentials
// ---------------------------------------------------------------------------

/**
 * A connection binds a provider to an actor (user/project/org). The credential
 * is stored out-of-band under `credentialReferenceId`; this object never
 * contains the secret itself.
 */
export interface Connection {
  id: ConnectionId;
  providerId: ProviderId;
  subject: IntegrationSubject;
  credentialReferenceId: CredentialReferenceId;
  status: ConnectionStatus;
  scopes: string[];
  consentHistory: ConsentRecord[];
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface ConsentRecord {
  at: string;
  scopes: string[];
  grantedBy: string; // actor id
  evidence: "explicit_consent" | "governance_approval";
}

export interface CredentialReference {
  id: CredentialReferenceId;
  // Secret is stored encrypted at rest by a key-manager interface (ADR-04).
  // This type never exposes the plaintext; callers receive only the id.
  encryptionKeyId: string;
  cipherPreview: string; // non-sensitive preview for audit logs
  rotatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Jobs & events
// ---------------------------------------------------------------------------

/**
 * Subject of an integration job. Capability permissions are bound to the
 * subject's project membership / grants — never trust a caller-supplied id
 * without resolving it against authenticated context.
 */
export type IntegrationSubject =
  | { kind: "user"; id: string }
  | { kind: "project"; id: string }
  | { kind: "organization"; id: string };

/**
 * A submitted integration job. Status transitions are validated by the
 * dispatcher; `queued` is NOT evidence of success.
 */
export interface IntegrationJob {
  id: IntegrationJobId;
  connectionId: ConnectionId;
  capability: CapabilityCode;
  subject: IntegrationSubject;
  status: IntegrationJobStatus;
  idempotencyKey: string; // caller-supplied; dispatcher dedupes per connection
  payload: unknown; // validated against the capability input schema
  result?: IntegrationJobResult;
  failure?: IntegrationJobFailure;
  createdAt: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface IntegrationJobResult {
  summary: string;
  evidenceRefs: string[]; // signed URLs to artifacts, scoped to permissions
  rawPreview?: unknown; // redacted, size-limited
}

export interface IntegrationJobFailure {
  category:
    | "provider_unreachable"
    | "provider_rejected"
    | "auth_expired"
    | "scope_insufficient"
    | "timeout"
    | "cancelled"
    | "internal";
  message: string;
  retryable: boolean;
}

/**
 * An event delivered by a provider webhook. Deduplicated by
 * (providerId, eventId). Authenticated by HMAC signature or equivalent.
 */
export interface IntegrationEvent {
  id: string; // internal id
  providerId: ProviderId;
  providerEventId: ProviderEventId; // provider-supplied, dedupe key
  connectionId: ConnectionId | null; // null if not yet correlated
  jobId: IntegrationJobId | null;
  type: string; // provider-defined event type
  payload: unknown;
  receivedAt: string;
  signatureValid: boolean;
}

// ---------------------------------------------------------------------------
// Connector interface (the contract future adapters implement)
// ---------------------------------------------------------------------------

/**
 * The versioned connector interface. A real provider adapter (G07+) implements
 * this; the mock connector in G07 will exercise the same path. G01 ships ONLY
 * the type — no implementation, no registration of running adapters.
 */
export interface ConnectorV1 {
  readonly providerId: ProviderId;
  readonly version: "1";

  validateConfig(config: unknown): { ok: true; value: unknown } | { ok: false; errors: string[] };
  submitJob(input: ConnectorJobInput): Promise<ConnectorJobAccept>;
  checkStatus(jobId: IntegrationJobId): Promise<ConnectorJobStatusSnapshot>;
  normalizeResult(raw: unknown): IntegrationJobResult;
  revoke(connection: Connection): Promise<void>;
}

export interface ConnectorJobInput {
  connectionId: ConnectionId;
  capability: CapabilityCode;
  subject: IntegrationSubject;
  idempotencyKey: string;
  payload: unknown;
}

export interface ConnectorJobAccept {
  jobId: IntegrationJobId;
  accepted: true;
}

export interface ConnectorJobStatusSnapshot {
  status: IntegrationJobStatus;
  result?: IntegrationJobResult;
  failure?: IntegrationJobFailure;
}
