/**
 * STR Platform — Request Context Helper for API Routes
 * ----------------------------------------------------
 * G09-P2 Gap 1: propagate the inbound request id (reqId) from the
 * HTTP layer down to the service layer so AuditEvents can be correlated
 * with structured logs.
 *
 * WHY: previously `runWithContext` existed but was never called, so
 * `getRequestContext()` always returned undefined and audit writes had
 * `reqId: null`. This broke forensic correlation between audit events
 * and application logs.
 *
 * HOW: API route handlers wrap their work in `withRequestContext(req, fn)`.
 * The helper reads the inbound request-id header (configurable via
 * REQUEST_ID_HEADER, default "x-request-id"), validates it, and stores
 * it in AsyncLocalStorage for the duration of `fn`. The service layer
 * reads it via `getRequestContext()?.reqId`.
 *
 * HEADER VALIDATION: the inbound header is only trusted if it matches
 * `/^[A-Za-z0-9_-]{8,128}$/`. Otherwise a fresh id is minted via Web
 * Crypto. This prevents header injection of arbitrary strings (e.g.,
 * log-injection payloads).
 *
 * BACKGROUND WORKER: when a service function is called from the outbox
 * worker (no inbound HTTP request), `getRequestContext()` returns
 * undefined, and audit writes correctly leave `reqId: null`. This is
 * the documented behavior for worker-originated operations.
 *
 * EDGE MIDDLEWARE: this module is Node-only (uses `node:async_hooks`).
 * Edge Middleware should use `resolveRequestId` from `@/lib/request-id`
 * instead (Web Crypto, no AsyncLocalStorage).
 */
import { NextRequest } from "next/server";
import { env } from "@/lib/config";
import { runWithContext, type RequestContext } from "@/lib/request-context";
import { resolveRequestId } from "@/lib/request-id";

/**
 * Wrap an API route handler with a request context that propagates reqId.
 * Reads the inbound header, validates it, and stores it in AsyncLocalStorage.
 *
 * Usage:
 *   export async function POST(req: NextRequest) {
 *     return withRequestContext(req, async () => {
 *       // ... existing handler logic ...
 *       // service layer can now call getRequestContext()?.reqId
 *     });
 *   }
 */
export function withRequestContext<T>(
  req: NextRequest,
  fn: () => Promise<T>,
): Promise<T> {
  const headerName = env.REQUEST_ID_HEADER;
  const headerValue = req.headers.get(headerName);
  const reqId = resolveRequestId(headerValue);
  const ctx: RequestContext = {
    reqId,
    startedAt: Date.now(),
  };
  return runWithContext(ctx, fn);
}
