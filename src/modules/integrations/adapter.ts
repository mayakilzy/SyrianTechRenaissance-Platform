/**
 * STR Integrations — Adapter Interface (G07)
 * ------------------------------------------
 * Defines the contract that all integration providers must implement.
 * The Mock Adapter (mock-adapter.ts) implements this interface and is
 * used for all G07 testing. Future real providers (e.g., GitHub, Slack)
 * will implement the same interface.
 *
 * CRITICAL: Mock adapters must be clearly labeled as MOCK. They must
 * NOT be presented to users as real integrations.
 */

/**
 * Result of a job execution. Either:
 * - succeeded: result is the typed output
 * - failed: failureCategory + failureMessage + retryable
 * - timed_out: special failure category for timeout
 */
export interface JobExecutionResult {
  status: "succeeded" | "failed" | "timed_out";
  result?: unknown;
  failureCategory?: string;
  failureMessage?: string;
  retryable?: boolean;
}

/**
 * Parameters for executing a job.
 */
export interface JobExecutionParams {
  capability: string;           // e.g., "application.test"
  payload: Record<string, unknown>;
  timeoutMs: number;           // from IntegrationCapability.timeoutMs
  idempotencyKey: string;
}

/**
 * Webhook verification parameters.
 */
export interface WebhookVerifyParams {
  body: string;                 // raw body (for HMAC)
  secret: string;              // the connection's signing secret (decrypted)
  // G07: HMAC must include timestamp + eventId + connectionId + body
  // to prevent timestamp tampering with a valid signature.
  timestamp: string;
  eventId: string;
  connectionId: string;
}

/**
 * The adapter interface that all providers implement.
 */
export interface IntegrationAdapter {
  /** Stable provider ID (e.g., "str.mock.v1") */
  readonly providerId: string;

  /** Whether this is a mock/dev adapter (must be clearly labeled) */
  readonly isMock: boolean;

  /**
   * Execute a job. Must respect the timeoutMs — if the execution
   * exceeds the timeout, return a timed_out result.
   */
  executeJob(params: JobExecutionParams): Promise<JobExecutionResult>;

  /**
   * Verify a webhook signature. Returns true if the signature is valid.
   * Uses constant-time comparison to prevent timing attacks.
   */
  verifyWebhook(params: WebhookVerifyParams): Promise<boolean>;

  /**
   * Called when a connection is revoked. Clean up any resources.
   */
  onDisconnect(connectionId: string): Promise<void>;
}

/**
 * Registry of adapters, keyed by providerId.
 * Populated at startup; the mock adapter is always registered.
 */
const adapterRegistry = new Map<string, IntegrationAdapter>();

export function registerAdapter(adapter: IntegrationAdapter): void {
  adapterRegistry.set(adapter.providerId, adapter);
}

export function getAdapter(providerId: string): IntegrationAdapter | null {
  return adapterRegistry.get(providerId) ?? null;
}

export function listRegisteredProviders(): string[] {
  return Array.from(adapterRegistry.keys());
}
