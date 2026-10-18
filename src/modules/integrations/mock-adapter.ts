/**
 * STR Integrations — Mock Adapter (G07)
 * --------------------------------------
 * Implements the IntegrationAdapter interface for testing purposes.
 * Simulates a real provider: returns typed results after a configurable delay.
 *
 * CRITICAL: This is clearly labeled as MOCK. It must NOT be presented
 * to users as a real integration. The UI tool directory must display
 * "MOCK" badge for this provider.
 *
 * The mock adapter simulates:
 * - Job execution with configurable delay + success/failure
 * - Webhook HMAC verification (valid/invalid/replay)
 * - Timeout handling (if delay > timeoutMs)
 *
 * No real external calls are made. No SSRF risk (predefined endpoints only).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  IntegrationAdapter,
  JobExecutionResult,
  JobExecutionParams,
  WebhookVerifyParams,
} from "./adapter";

const MOCK_PROVIDER_ID = "str.mock.v1";

// Configurable delays for different capabilities (simulates real provider latency)
const CAPABILITY_DELAYS: Record<string, number> = {
  "application.test": 100,        // 100ms — fast
  "application.slow": 5000,      // 5s — slow (used for timeout tests)
  "application.failing": 100,   // 100ms then fails
};

class MockAdapter implements IntegrationAdapter {
  readonly providerId = MOCK_PROVIDER_ID;
  readonly isMock = true;

  async executeJob(params: JobExecutionParams): Promise<JobExecutionResult> {
    const delay = CAPABILITY_DELAYS[params.capability] ?? 100;

    // Simulate timeout: if delay > timeoutMs, return timed_out
    if (delay > params.timeoutMs) {
      // Wait for the timeout duration, then return timed_out
      await new Promise((resolve) => setTimeout(resolve, params.timeoutMs));
      return {
        status: "timed_out",
        failureCategory: "timeout",
        failureMessage: `Job timed out after ${params.timeoutMs}ms`,
        retryable: true,
      };
    }

    // Simulate the job execution delay
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Simulate failure for "failing" capability
    if (params.capability === "application.failing") {
      return {
        status: "failed",
        failureCategory: "provider_error",
        failureMessage: "Mock provider returned a simulated failure",
        retryable: true,
      };
    }

    // Success — return a typed result
    return {
      status: "succeeded",
      result: {
        capability: params.capability,
        idempotencyKey: params.idempotencyKey,
        executedAt: new Date().toISOString(),
        mockProvider: true,
        output: {
          status: "ok",
          data: (params.payload as { input?: unknown })?.input ?? null,
        },
      },
    };
  }

  async verifyWebhook(params: WebhookVerifyParams): Promise<boolean> {
    // HMAC-SHA256 verification with constant-time comparison
    // CRITICAL: The signature covers timestamp + eventId + connectionId + body
    // This prevents an attacker from changing the timestamp while keeping a valid signature.
    const signature = params.headers["x-str-signature"] || params.headers["X-STR-Signature"];
    if (!signature) return false;

    // Compute expected signature over the canonical form:
    // timestamp\neventId\nconnectionId\nbody
    const canonicalString = `${params.timestamp}\n${params.eventId}\n${params.connectionId}\n${params.body}`;
    const expectedSignature = createHmac("sha256", params.secret)
      .update(canonicalString)
      .digest("hex");

    // Constant-time comparison to prevent timing attacks
    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expectedSignature);
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async onDisconnect(connectionId: string): Promise<void> {
    // Mock: no resources to clean up
    console.log(`[MockAdapter] Connection ${connectionId} disconnected`);
  }
}

// Register the mock adapter
let mockAdapterInstance: MockAdapter | null = null;

export function getMockAdapter(): MockAdapter {
  if (!mockAdapterInstance) {
    mockAdapterInstance = new MockAdapter();
  }
  return mockAdapterInstance;
}

export function registerMockAdapter(): void {
  const adapter = getMockAdapter();
  // Use dynamic import to avoid circular dependency
  import("./adapter").then(({ registerAdapter }) => {
    registerAdapter(adapter);
  });
}

export { MOCK_PROVIDER_ID };
